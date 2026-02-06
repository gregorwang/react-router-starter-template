import type { AppLoadContext } from "react-router";
import type { LLMMessage, LLMProvider, Usage } from "./types";

interface LLMStreamEvent {
	type: "delta" | "reasoning" | "usage" | "credits" | "meta" | "search" | "error";
	content?: string;
	usage?: Usage;
	credits?: number;
	meta?: { thinkingMs?: number };
	search?: {
		provider: "x" | "xai" | "claude";
		query?: string;
		results?: Array<{
			id?: string;
			author?: string;
			text?: string;
			title?: string;
			url?: string;
			createdAt?: string;
			pageAge?: string;
		}>;
		citations?: string[];
	};
}

// Server-side streaming response for LLM
export async function streamLLMFromServer(
	messages: LLMMessage[],
	provider: LLMProvider,
	model: string,
	context: AppLoadContext,
	options?: {
		reasoningEffort?: "low" | "medium" | "high";
		enableThinking?: boolean;
		thinkingBudget?: number;
		thinkingLevel?: "low" | "medium" | "high";
		outputTokens?: number;
		outputEffort?: "low" | "medium" | "high" | "max";
		webSearch?: boolean;
		enableTools?: boolean;
	},
): Promise<ReadableStream<Uint8Array>> {
	const env = context.cloudflare.env;

	const apiKeyMap: Record<LLMProvider, string | undefined> = {
		deepseek: env.DEEPSEEK_API_KEY,
		xai: env.XAI_API_KEY,
		poe: env.POE_API_KEY,
		"workers-ai": undefined,
		poloai: env.POLOAI_API_KEY,
		ark: env.ARK_API_KEY,
	};

	const apiKey = apiKeyMap[provider];
	if (provider !== "workers-ai" && !apiKey) {
		throw new Error(
			`API key for ${provider} not configured. Please set it using: wrangler secret put ${provider.toUpperCase()}_API_KEY`,
		);
	}

	const encoder = new TextEncoder();
	const stream = new TransformStream<LLMStreamEvent, Uint8Array>({
		transform(event, controller) {
			controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
		},
		flush(controller) {
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
		},
	});

	const writer = stream.writable.getWriter();
	const startedAt = Date.now();
	let sentThinkingMeta = false;

	const writeEvent = async (event: LLMStreamEvent) => {
		if (!sentThinkingMeta && (event.type === "delta" || event.type === "reasoning")) {
			sentThinkingMeta = true;
			await writer.write({
				type: "meta",
				meta: { thinkingMs: Date.now() - startedAt },
			});
		}
		await writer.write(event);
	};

	(async () => {
		try {
			let requestMessages = messages;
			let searchMeta: LLMStreamEvent["search"] | undefined;

			if (searchMeta) {
				await writeEvent({ type: "search", search: searchMeta });
			}

			switch (provider) {
				case "deepseek":
					await streamDeepSeekServer(requestMessages, model, apiKey!, writeEvent);
					break;
				case "xai":
					await streamXAIServer(requestMessages, model, apiKey!, writeEvent, {
						webSearch: options?.webSearch,
					});
					break;
				case "poe":
					await streamPoeServer(requestMessages, model, apiKey!, writeEvent, options);
					break;
				case "workers-ai":
					await streamWorkersAIServer(requestMessages, model, context, writeEvent);
					break;
				case "poloai":
					await streamPoloAIServer(requestMessages, model, apiKey!, writeEvent, {
						outputEffort: options?.outputEffort,
						webSearch: options?.webSearch,
						enableThinking: options?.enableThinking,
						thinkingBudget: options?.thinkingBudget,
						outputTokens: options?.outputTokens,
						enableTools: options?.enableTools,
					});
					break;
				case "ark":
					await streamArkServer(requestMessages, model, apiKey!, writeEvent, {
						enableThinking: options?.enableThinking,
					});
					break;
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("[LLM Server] Upstream error:", errorMessage);
			await writer.write({
				type: "error",
				content: formatUserFacingError(errorMessage),
			});
		} finally {
			await writer.close();
		}
	})();

	return stream.readable;
}

async function streamDeepSeekServer(
	messages: LLMMessage[],
	model: string,
	apiKey: string,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
): Promise<void> {
	const response = await fetch("https://api.deepseek.com/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages,
			stream: true,
			temperature: 0.7,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
	}

	await processSSEStream(response, async (parsed) => {
		const delta = parsed.choices?.[0]?.delta;
		const content = delta?.content;
		const reasoning =
			delta?.reasoning_content || delta?.reasoning || delta?.thinking || "";
		const usage = normalizeUsage(parsed.usage);

		if (content) {
			await writeEvent({ type: "delta", content });
		}
		if (reasoning) {
			await writeEvent({ type: "reasoning", content: reasoning });
		}
		if (usage) {
			await writeEvent({ type: "usage", usage });
		}
	});
}

async function streamXAIServer(
	messages: LLMMessage[],
	model: string,
	apiKey: string,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
	options?: { webSearch?: boolean },
): Promise<void> {
	const useResponsesApi = true;
	const input = messages.map((message) => ({
		role: message.role,
		content: message.content,
	}));

	if (useResponsesApi) {
		const body: Record<string, unknown> = {
			model,
			input,
			stream: true,
			temperature: 0,
		};

		if (options?.webSearch) {
			body.tools = [{ type: "x_search" }];
			body.tool_choice = "auto";
			body.include = ["inline_citations"];
		}

		let response = await fetch("https://api.x.ai/v1/responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok && options?.webSearch) {
			const fallbackBody = { ...body };
			delete fallbackBody.include;
			response = await fetch("https://api.x.ai/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(fallbackBody),
			});
			if (!response.ok) {
				const noToolsBody = { ...fallbackBody };
				delete noToolsBody.tools;
				delete noToolsBody.tool_choice;
				response = await fetch("https://api.x.ai/v1/responses", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(noToolsBody),
				});
			}
		}

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`xAI API error: ${response.status} - ${errorText}`);
		}

		const contentType = response.headers.get("Content-Type") || "";
		if (!contentType.includes("text/event-stream")) {
			const data = (await response.json()) as any;
			const content = extractXAIResponseText(data);
			const usage = normalizeUsage(data?.usage ?? data?.response?.usage);
			const credits = data?.credits ?? data?.usage?.credits;
			const citations = extractXAICitations(data?.response ?? data);

			if (citations?.length) {
				await writeEvent({
					type: "search",
					search: { provider: "xai", citations },
				});
			}
			if (content) {
				await writeEvent({ type: "delta", content });
			}
			if (usage) {
				await writeEvent({ type: "usage", usage });
			}
			if (credits) {
				await writeEvent({ type: "credits", credits });
			}
			return;
		}

		let sawDelta = false;
		await processSSEStream(response, async (parsed) => {
			const eventType = parsed?.type;

			if (eventType === "response.output_text.delta" && parsed.delta) {
				sawDelta = true;
				await writeEvent({ type: "delta", content: parsed.delta });
			}

			if (eventType === "response.completed" && parsed.response) {
				const citations = extractXAICitations(parsed.response);
				if (citations?.length) {
					await writeEvent({
						type: "search",
						search: { provider: "xai", citations },
					});
				}

				const usage = normalizeUsage(parsed.response?.usage);
				if (usage) {
					await writeEvent({ type: "usage", usage });
				}

				if (!sawDelta) {
					const content = extractXAIResponseText(parsed.response);
					if (content) {
						await writeEvent({ type: "delta", content });
					}
				}
			}

			const legacyDelta = parsed?.choices?.[0]?.delta?.content;
			if (legacyDelta) {
				sawDelta = true;
				await writeEvent({ type: "delta", content: legacyDelta });
			}

			const legacyUsage = normalizeUsage(parsed?.usage);
			if (legacyUsage) {
				await writeEvent({ type: "usage", usage: legacyUsage });
			}

			const legacyCredits = parsed?.credits ?? parsed?.usage?.credits;
			if (legacyCredits) {
				await writeEvent({ type: "credits", credits: legacyCredits });
			}
		});

		return;
	}

	const body: Record<string, unknown> = {
		messages: messages.map((message) => ({
			role: message.role,
			content: message.content,
		})),
		model,
		stream: true,
		temperature: 0,
	};

	if (options?.webSearch) {
		body.tools = [{ type: "x_search" }];
		body.tool_choice = "auto";
	}

	let response = await fetch("https://api.x.ai/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	});

	if (!response.ok && options?.webSearch) {
		const fallbackBody = { ...body };
		delete fallbackBody.tools;
		delete fallbackBody.tool_choice;
		response = await fetch("https://api.x.ai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(fallbackBody),
		});
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`xAI API error: ${response.status} - ${errorText}`);
	}

	await processSSEStream(response, async (parsed) => {
		const delta = parsed.choices?.[0]?.delta;
		const content = delta?.content;
		const usage = normalizeUsage(parsed.usage);
		const credits = parsed.credits ?? parsed.usage?.credits;

		if (content) {
			await writeEvent({ type: "delta", content });
		}
		if (usage) {
			await writeEvent({ type: "usage", usage });
		}
		if (credits) {
			await writeEvent({ type: "credits", credits });
		}
	});
}

async function streamPoeServer(
	messages: LLMMessage[],
	model: string,
	apiKey: string,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
	options?: {
		reasoningEffort?: "low" | "medium" | "high";
		enableThinking?: boolean;
		thinkingBudget?: number;
		thinkingLevel?: "low" | "medium" | "high";
		webSearch?: boolean;
	},
): Promise<void> {
	const response = await fetch("https://api.poe.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
			model,
			stream: true,
			extra_body: {
				...(model === "kimi-k2.5"
					? { enable_thinking: options?.enableThinking ?? true }
					: {}),
				...(model === "o3"
					? { reasoning_effort: options?.reasoningEffort || "high" }
					: {}),
				...(model === "claude-sonnet-4.5"
					? { thinking_budget: options?.thinkingBudget || 12288 }
					: {}),
				...(model === "gemini-3-pro"
					? {
							thinking_level: options?.thinkingLevel || "high",
							web_search: options?.webSearch ?? true,
						}
					: {}),
			},
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Poe API error: ${response.status} - ${errorText}`);
	}

	await processSSEStream(response, async (parsed) => {
		const delta = parsed.choices?.[0]?.delta;
		const content = delta?.content;
		const usage = normalizeUsage(parsed.usage);
		const credits = parsed.credits ?? parsed.usage?.credits;

		if (content) {
			await writeEvent({ type: "delta", content });
		}
		if (usage) {
			await writeEvent({ type: "usage", usage });
		}
		if (credits) {
			await writeEvent({ type: "credits", credits });
		}
	});
}

async function streamWorkersAIServer(
	messages: LLMMessage[],
	model: string,
	context: AppLoadContext,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
): Promise<void> {
	const env = context.cloudflare.env;
	if (!env.AI) {
		throw new Error("Workers AI binding not configured. Add AI binding in wrangler.json.");
	}

	const prompt = messages
		.map((message) => `${message.role.toUpperCase()}: ${message.content}`)
		.join("\n");

	const result = (await env.AI.run(model as any, { prompt } as any)) as {
		response?: string;
		usage?: Usage;
	};

	const content = result.response || "";
	if (content) {
		await writeEvent({ type: "delta", content });
	}
	if (result.usage) {
		await writeEvent({ type: "usage", usage: result.usage });
	}
}

async function streamPoloAIServer(
	messages: LLMMessage[],
	model: string,
	apiKey: string,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
	options?: {
		outputEffort?: "low" | "medium" | "high" | "max";
		webSearch?: boolean;
		enableThinking?: boolean;
		thinkingBudget?: number;
		outputTokens?: number;
		enableTools?: boolean;
	},
): Promise<void> {
	const webSearch = options?.webSearch ?? true;
	const enableThinking = options?.enableThinking ?? true;
	const rawThinkingBudget =
		typeof options?.thinkingBudget === "number" ? options.thinkingBudget : 12288;
	const thinkingBudget = Math.max(1024, Math.floor(rawThinkingBudget));
	const rawOutputTokens =
		typeof options?.outputTokens === "number" ? options.outputTokens : 2048;
	const outputTokens = Math.max(256, Math.floor(rawOutputTokens));
	const maxTokens = enableThinking ? thinkingBudget + outputTokens : outputTokens;
	const extraBody = model.startsWith("claude-opus")
		? { output_effort: options?.outputEffort ?? "max" }
		: undefined;
	const formattedMessages = buildPoloAIMessages(messages);
	const localToolsEnabled = options?.enableTools ?? true;
	const toolBundle = buildPoloAITools({ webSearch, enableTools: localToolsEnabled });
	const toolChoice = toolBundle.tools.length > 0 ? { type: "auto" } : undefined;

	const baseBody = {
		model,
		stream: true,
		max_tokens: maxTokens,
		...(enableThinking ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } } : {}),
		...(extraBody ? { extra_body: extraBody } : {}),
		...(toolBundle.tools.length > 0
			? { tools: toolBundle.tools, tool_choice: toolChoice }
			: {}),
	} as Record<string, unknown>;

	let currentMessages = formattedMessages;
	let rounds = 0;
	let aggregatedSearch: LLMStreamEvent["search"] | undefined;

	while (true) {
		const result = await runPoloAIStreamRequest({
			apiKey,
			messages: currentMessages,
			baseBody,
			localToolNames: toolBundle.localToolNames,
			writeEvent,
		});

		aggregatedSearch = mergeSearchMeta(aggregatedSearch, result.searchMeta);
		if (aggregatedSearch) {
			await writeEvent({ type: "search", search: aggregatedSearch });
		}

		if (result.toolUses.length === 0) {
			return;
		}

		rounds += 1;
		if (rounds > 2) {
			throw new Error("Tool call limit exceeded.");
		}

		const toolResults = await runPoloAITools(result.toolUses);
		const toolUseBlocks = result.toolUses.map((toolUse) => ({
			type: "tool_use",
			id: toolUse.id,
			name: toolUse.name,
			input: toolUse.input ?? {},
		}));
		const toolResultBlocks = toolResults.map((toolResult) => ({
			type: "tool_result",
			tool_use_id: toolResult.id,
			content: toolResult.content,
			...(toolResult.isError ? { is_error: true } : {}),
		}));

		currentMessages = currentMessages.concat([
			{ role: "assistant", content: toolUseBlocks },
			{ role: "user", content: toolResultBlocks },
		]);
	}
}

async function streamArkServer(
	messages: LLMMessage[],
	model: string,
	apiKey: string,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
	options?: { enableThinking?: boolean },
): Promise<void> {
	const body: Record<string, unknown> = {
		model,
		max_tokens: 1000,
		messages: messages.map((message) => ({
			role: message.role,
			content: message.content,
		})),
		stream: true,
	};
	if (options?.enableThinking !== false) {
		body.thinking = { type: "enabled" };
	}

	const response = await fetch(
		"https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
		{
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Ark API error: ${response.status} - ${errorText}`);
	}

	const contentType = response.headers.get("Content-Type") || "";
	if (!contentType.includes("text/event-stream")) {
		const data = (await response.json()) as any;
		const content = extractOpenAIContent(data);
		const usage = normalizeUsage(data?.usage);
		if (content) {
			await writeEvent({ type: "delta", content });
		}
		if (usage) {
			await writeEvent({ type: "usage", usage });
		}
		return;
	}

	await processSSEStream(response, async (parsed) => {
		if (parsed?.error?.message) {
			throw new Error(parsed.error.message);
		}
		const content = extractOpenAIDelta(parsed);
		const usage = normalizeUsage(parsed?.usage);
		if (content) {
			await writeEvent({ type: "delta", content });
		}
		if (usage) {
			await writeEvent({ type: "usage", usage });
		}
	});
}

function extractOpenAIDelta(payload: any): string | undefined {
	const delta = payload?.choices?.[0]?.delta;
	const content = delta?.content ?? delta?.text;
	return typeof content === "string" ? content : undefined;
}

function extractOpenAIContent(payload: any): string | undefined {
	const message = payload?.choices?.[0]?.message;
	if (typeof message?.content === "string") {
		return message.content;
	}
	if (Array.isArray(message?.content)) {
		return message.content
			.map((block: any) => (typeof block?.text === "string" ? block.text : ""))
			.join("");
	}
	return undefined;
}

function extractXAIResponseText(payload: any): string | undefined {
	if (!payload) return undefined;

	if (typeof payload.output_text === "string") {
		return payload.output_text;
	}

	const response = payload.response ?? payload;
	const output = response?.output;
	if (Array.isArray(output)) {
		const parts: string[] = [];
		for (const item of output) {
			const content = item?.content;
			if (!Array.isArray(content)) continue;
			for (const block of content) {
				if (block?.type === "output_text" && typeof block.text === "string") {
					parts.push(block.text);
				}
			}
		}
		if (parts.length) {
			return parts.join("");
		}
	}

	return undefined;
}

function extractXAICitations(payload: any): string[] | undefined {
	if (!payload) return undefined;
	const response = payload.response ?? payload;

	const citations = response?.citations;
	if (Array.isArray(citations)) {
		const urls = citations.filter((item: any) => typeof item === "string");
		if (urls.length) return urls;
	}

	const inline = response?.inline_citations;
	if (Array.isArray(inline)) {
		const urls = inline
			.map((item: any) => item?.web_citation?.url)
			.filter((url: any) => typeof url === "string");
		if (urls.length) return urls;
	}

	return undefined;
}


// Helper to process SSE streams
async function processSSEStream(
	response: Response,
	onParsed: (parsed: any) => Promise<void>,
): Promise<void> {
	const reader = response.body?.getReader();
	const decoder = new TextDecoder();

	if (!reader) {
		throw new Error("No response body received");
	}

	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			if (line.startsWith("data:")) {
				const data = line.slice(5).trim();
				if (data === "[DONE]") break;

				try {
					const parsed = JSON.parse(data);
					await onParsed(parsed);
				} catch (error) {
					console.error(
						"[LLM Server] Stream parse error:",
						error,
						"Data chunk:",
						data.slice(0, 50),
					);
				}
			}
		}
	}
}

function normalizeUsage(usage: any): Usage | undefined {
	if (!usage) return undefined;
	const promptTokens = usage.prompt_tokens ?? usage.promptTokens;
	const completionTokens = usage.completion_tokens ?? usage.completionTokens;
	const totalTokens = usage.total_tokens ?? usage.totalTokens;
	const inputTokens = usage.input_tokens ?? usage.inputTokens;
	const outputTokens = usage.output_tokens ?? usage.outputTokens;
	if (
		typeof promptTokens !== "number" ||
		typeof completionTokens !== "number" ||
		typeof totalTokens !== "number"
	) {
		if (typeof inputTokens === "number" && typeof outputTokens === "number") {
			return {
				promptTokens: inputTokens,
				completionTokens: outputTokens,
				totalTokens: inputTokens + outputTokens,
			};
		}
		return undefined;
	}
	return { promptTokens, completionTokens, totalTokens };
}

function extractPoloAIContent(payload: any): string | undefined {
	const choice = payload?.choices?.[0];
	const delta = choice?.delta;
	const openAIDelta =
		delta?.content ??
		delta?.text ??
		payload?.delta?.text ??
		payload?.delta?.content ??
		payload?.content_block?.text;
	if (typeof openAIDelta === "string") {
		return openAIDelta;
	}

	const messageContent = choice?.message?.content;
	if (typeof messageContent === "string") {
		return messageContent;
	}

	const contentBlocks = payload?.content ?? payload?.message?.content;
	if (Array.isArray(contentBlocks)) {
		const text = contentBlocks
			.map((block: any) => (typeof block?.text === "string" ? block.text : ""))
			.join("");
		return text || undefined;
	}

	return undefined;
}

function extractPoloAIReasoning(payload: any): string | undefined {
	if (!payload) return undefined;

	if (payload.type === "content_block_delta") {
		const delta = payload.delta;
		if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
			return delta.thinking;
		}
		return undefined;
	}

	if (payload.type === "content_block_start") {
		const contentBlock = payload.content_block;
		if (
			contentBlock?.type === "thinking" &&
			typeof contentBlock.thinking === "string"
		) {
			return contentBlock.thinking;
		}
	}

	const openAIDelta = payload?.choices?.[0]?.delta;
	if (typeof openAIDelta?.reasoning_content === "string") {
		return openAIDelta.reasoning_content;
	}
	if (typeof openAIDelta?.reasoning === "string") {
		return openAIDelta.reasoning;
	}
	if (typeof payload?.delta?.reasoning === "string") {
		return payload.delta.reasoning;
	}
	if (typeof payload?.delta?.thinking === "string") {
		return payload.delta.thinking;
	}
	if (typeof payload?.content_block?.thinking === "string") {
		return payload.content_block.thinking;
	}

	const contentBlocks =
		payload?.content ??
		payload?.message?.content ??
		payload?.choices?.[0]?.message?.content;

	if (Array.isArray(contentBlocks)) {
		const thinkingParts = contentBlocks
			.filter(
				(block: any) =>
					block?.type === "thinking" && typeof block.thinking === "string",
			)
			.map((block: any) => block.thinking);
		if (thinkingParts.length > 0) {
			return thinkingParts.join("");
		}
	}

	return undefined;
}

type PoloAIToolUse = {
	id: string;
	name: string;
	input?: unknown;
	inputJson?: string;
};

type PoloAIToolResult = {
	id: string;
	content: string;
	isError?: boolean;
};

function evaluateMathExpression(expression: string): number {
	const sanitized = expression.replace(/\s+/g, "");
	if (!sanitized) {
		throw new Error("Missing expression");
	}
	if (!/^[0-9+\-*/().]+$/.test(sanitized)) {
		throw new Error("Expression contains unsupported characters");
	}

	const tokens = sanitized.match(/\d+(?:\.\d+)?|[()+\-*/]/g) || [];
	const values: number[] = [];
	const ops: string[] = [];
	const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

	const applyOp = () => {
		const op = ops.pop();
		const right = values.pop();
		const left = values.pop();
		if (!op || right === undefined || left === undefined) {
			throw new Error("Invalid expression");
		}
		switch (op) {
			case "+":
				values.push(left + right);
				break;
			case "-":
				values.push(left - right);
				break;
			case "*":
				values.push(left * right);
				break;
			case "/":
				values.push(left / right);
				break;
			default:
				throw new Error("Invalid operator");
		}
	};

	const isOperator = (token: string) => ["+", "-", "*", "/"].includes(token);

	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		if (!token) continue;

		if (/^\d/.test(token)) {
			values.push(Number(token));
			continue;
		}

		if (token === "(") {
			ops.push(token);
			continue;
		}

		if (token === ")") {
			while (ops.length && ops[ops.length - 1] !== "(") {
				applyOp();
			}
			if (ops.pop() !== "(") {
				throw new Error("Mismatched parentheses");
			}
			continue;
		}

		if (isOperator(token)) {
			const prev = tokens[i - 1];
			if (token === "-" && (i === 0 || (prev && (isOperator(prev) || prev === "(")))) {
				values.push(0);
			}
			while (
				ops.length &&
				isOperator(ops[ops.length - 1]) &&
				precedence[ops[ops.length - 1]] >= precedence[token]
			) {
				applyOp();
			}
			ops.push(token);
			continue;
		}

		throw new Error("Invalid token");
	}

	while (ops.length) {
		if (ops[ops.length - 1] === "(") {
			throw new Error("Mismatched parentheses");
		}
		applyOp();
	}

	if (values.length !== 1) {
		throw new Error("Invalid expression");
	}
	return values[0];
}

const POLOAI_LOCAL_TOOLS = [
	{
		name: "get_time",
		description: "Get the current time in UTC or in a specific IANA time zone.",
		input_schema: {
			type: "object",
			properties: {
				time_zone: {
					type: "string",
					description: "IANA time zone, e.g. Asia/Shanghai.",
				},
			},
		},
		handler: async (input: any) => {
			const now = new Date();
			const payload: Record<string, unknown> = {
				iso_utc: now.toISOString(),
				unix_ms: now.getTime(),
			};
			const timeZone = typeof input?.time_zone === "string" ? input.time_zone : null;
			if (timeZone) {
				try {
					const formatter = new Intl.DateTimeFormat("sv-SE", {
						timeZone,
						year: "numeric",
						month: "2-digit",
						day: "2-digit",
						hour: "2-digit",
						minute: "2-digit",
						second: "2-digit",
						hour12: false,
					});
					payload.local = formatter.format(now).replace(" ", "T");
					payload.time_zone = timeZone;
				} catch {
					payload.time_zone_error = "Invalid time zone";
				}
			}
			return JSON.stringify(payload);
		},
	},
	{
		name: "calculate",
		description: "Evaluate a basic math expression with + - * / and parentheses.",
		input_schema: {
			type: "object",
			properties: {
				expression: {
					type: "string",
					description: "Math expression, e.g. (12 + 8) / 4",
				},
			},
			required: ["expression"],
		},
		handler: async (input: any) => {
			const expression =
				typeof input?.expression === "string" ? input.expression.trim() : "";
			const result = evaluateMathExpression(expression);
			if (!Number.isFinite(result)) {
				throw new Error("Invalid expression result");
			}
			return JSON.stringify({ expression, result });
		},
	},
];

function buildPoloAITools(options: {
	webSearch: boolean;
	enableTools: boolean;
}): { tools: Array<Record<string, unknown>>; localToolNames: Set<string> } {
	const tools: Array<Record<string, unknown>> = [];
	const localToolNames = new Set<string>();

	if (options.webSearch) {
		tools.push({ type: "web_search_20250305", name: "web_search" });
	}

	if (options.enableTools) {
		for (const tool of POLOAI_LOCAL_TOOLS) {
			tools.push({
				name: tool.name,
				description: tool.description,
				input_schema: tool.input_schema,
			});
			localToolNames.add(tool.name);
		}
	}

	return { tools, localToolNames };
}

function buildPoloAIMessages(messages: LLMMessage[]) {
	return messages.map((message) => {
		const attachments = (message.attachments ?? []).filter((item) => item.data);
		if (!attachments.length) {
			return { role: message.role, content: message.content };
		}
		const blocks: Array<Record<string, unknown>> = [];
		if (message.content.trim()) {
			blocks.push({ type: "text", text: message.content });
		}
		for (const attachment of attachments) {
			if (!attachment?.data) continue;
			blocks.push({
				type: "image",
				source: {
					type: "base64",
					media_type: attachment.mimeType,
					data: attachment.data,
				},
			});
		}
		return { role: message.role, content: blocks.length ? blocks : message.content };
	});
}

async function runPoloAITools(toolUses: PoloAIToolUse[]): Promise<PoloAIToolResult[]> {
	const results: PoloAIToolResult[] = [];
	for (const toolUse of toolUses) {
		const tool = POLOAI_LOCAL_TOOLS.find((entry) => entry.name === toolUse.name);
		if (!tool) {
			results.push({
				id: toolUse.id,
				content: `Unknown tool: ${toolUse.name}`,
				isError: true,
			});
			continue;
		}
		try {
			const output = await tool.handler(toolUse.input ?? {});
			results.push({ id: toolUse.id, content: output });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Tool execution failed";
			results.push({ id: toolUse.id, content: message, isError: true });
		}
	}
	return results;
}

function parseClaudeContentBlocks(payload: any): Array<Record<string, any>> {
	if (Array.isArray(payload?.content)) return payload.content;
	if (Array.isArray(payload?.message?.content)) return payload.message.content;
	const choice = payload?.choices?.[0];
	if (Array.isArray(choice?.message?.content)) return choice.message.content;
	return [];
}

function extractClaudeSearchFromBlocks(blocks: Array<Record<string, any>>) {
	const results: Array<{
		title?: string;
		url?: string;
		pageAge?: string;
	}> = [];
	const citations = new Set<string>();

	for (const block of blocks) {
		if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
			for (const item of block.content) {
				if (item?.type === "web_search_result") {
					results.push({
						title: item.title,
						url: item.url,
						pageAge: item.page_age,
					});
				}
			}
		}
		if (Array.isArray(block?.citations)) {
			for (const citation of block.citations) {
				const url =
					typeof citation === "string"
						? citation
						: typeof citation?.url === "string"
							? citation.url
							: null;
				if (url) citations.add(url);
			}
		}
	}

	if (results.length === 0 && citations.size === 0) {
		return undefined;
	}

	return {
		provider: "claude" as const,
		results: results.map((result, index) => ({
			id: `${index}`,
			title: result.title,
			url: result.url,
			pageAge: result.pageAge,
		})),
		citations: Array.from(citations),
	};
}

type SearchResult = NonNullable<
	NonNullable<LLMStreamEvent["search"]>["results"]
>[number];

function mergeSearchMeta(
	base: LLMStreamEvent["search"] | undefined,
	next: LLMStreamEvent["search"] | undefined,
) {
	if (!next) return base;
	if (!base) return next;
	const citations = new Set<string>([
		...(base.citations || []),
		...(next.citations || []),
	]);
	const resultsMap = new Map<string, SearchResult>();
	for (const result of base.results || []) {
		const key = result.url || result.title || result.text || result.id || "";
		if (!key) continue;
		resultsMap.set(key, result);
	}
	for (const result of next.results || []) {
		const key = result.url || result.title || result.text || result.id || "";
		if (!key) continue;
		resultsMap.set(key, result);
	}
	return {
		provider: next.provider || base.provider,
		query: next.query || base.query,
		results: Array.from(resultsMap.values()),
		citations: Array.from(citations),
	};
}

async function runPoloAIStreamRequest(options: {
	apiKey: string;
	messages: Array<{ role: string; content: unknown }>;
	baseBody: Record<string, unknown>;
	localToolNames: Set<string>;
	writeEvent: (event: LLMStreamEvent) => Promise<void>;
}): Promise<{ toolUses: PoloAIToolUse[]; searchMeta?: LLMStreamEvent["search"] }> {
	const response = await fetch("https://poloai.top/v1/messages", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			Authorization: options.apiKey,
		},
		body: JSON.stringify({
			...options.baseBody,
			messages: options.messages,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`PoloAI API error: ${response.status} - ${errorText}`);
	}

	const contentType = response.headers.get("Content-Type") || "";
	if (!contentType.includes("text/event-stream")) {
		const data = (await response.json()) as any;
		const blocks = parseClaudeContentBlocks(data);
		const searchMeta = extractClaudeSearchFromBlocks(blocks);

		const toolUses = blocks
			.filter((block) => block?.type === "tool_use")
			.map((block) => ({
				id: block.id,
				name: block.name,
				input: block.input,
			}))
			.filter((toolUse) => options.localToolNames.has(toolUse.name));

		const reasoning = extractPoloAIReasoning(data);
		if (reasoning) {
			await options.writeEvent({ type: "reasoning", content: reasoning });
		}

		const content = extractPoloAIContent(data);
		if (content) {
			await options.writeEvent({ type: "delta", content });
		}

		const usage = normalizeUsage(data?.usage);
		if (usage) {
			await options.writeEvent({ type: "usage", usage });
		}

		return { toolUses, searchMeta };
	}

	const toolUsesByIndex = new Map<number, PoloAIToolUse>();
	const citations = new Set<string>();
	const searchResults: Array<{
		title?: string;
		url?: string;
		pageAge?: string;
	}> = [];

	await processSSEStream(response, async (parsed) => {
		if (parsed?.error?.message) {
			throw new Error(parsed.error.message);
		}

		if (parsed?.type === "content_block_start") {
			const block = parsed.content_block;
			if (block?.type === "tool_use") {
				toolUsesByIndex.set(parsed.index, {
					id: block.id,
					name: block.name,
					input: block.input,
					inputJson: "",
				});
			}
			if (block?.type === "text" && typeof block.text === "string") {
				await options.writeEvent({ type: "delta", content: block.text });
			}
			if (block?.type === "thinking" && typeof block.thinking === "string") {
				await options.writeEvent({ type: "reasoning", content: block.thinking });
			}
			if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
				for (const item of block.content) {
					if (item?.type === "web_search_result") {
						searchResults.push({
							title: item.title,
							url: item.url,
							pageAge: item.page_age,
						});
					}
				}
			}
			if (Array.isArray(block?.citations)) {
				for (const citation of block.citations) {
					const url =
						typeof citation === "string"
							? citation
							: typeof citation?.url === "string"
								? citation.url
								: null;
					if (url) citations.add(url);
				}
			}
		}

		if (parsed?.type === "content_block_delta") {
			const delta = parsed.delta;
			if (delta?.type === "text_delta" && typeof delta.text === "string") {
				await options.writeEvent({ type: "delta", content: delta.text });
			}
			if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
				await options.writeEvent({ type: "reasoning", content: delta.thinking });
			}
			if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
				const entry = toolUsesByIndex.get(parsed.index);
				if (entry) {
					entry.inputJson = `${entry.inputJson ?? ""}${delta.partial_json}`;
				}
			}
			if (Array.isArray(delta?.citations)) {
				for (const citation of delta.citations) {
					const url =
						typeof citation === "string"
							? citation
							: typeof citation?.url === "string"
								? citation.url
								: null;
					if (url) citations.add(url);
				}
			}
		}

		if (parsed?.type === "content_block_stop") {
			const entry = toolUsesByIndex.get(parsed.index);
			if (entry && entry.input === undefined && entry.inputJson) {
				try {
					entry.input = JSON.parse(entry.inputJson);
				} catch {
					entry.input = entry.inputJson;
				}
			}
		}

		if (parsed?.type === "message_delta") {
			const usage = normalizeUsage(parsed?.usage);
			if (usage) {
				await options.writeEvent({ type: "usage", usage });
			}
		}
	});

	for (const entry of toolUsesByIndex.values()) {
		if (entry.input === undefined && entry.inputJson) {
			try {
				entry.input = JSON.parse(entry.inputJson);
			} catch {
				entry.input = entry.inputJson;
			}
		}
	}

	const toolUses = Array.from(toolUsesByIndex.values()).filter((toolUse) =>
		options.localToolNames.has(toolUse.name),
	);
	const searchMeta =
		searchResults.length > 0 || citations.size > 0
			? {
					provider: "claude" as const,
					results: searchResults.map((result, index) => ({
						id: `${index}`,
						title: result.title,
						url: result.url,
						pageAge: result.pageAge,
					})),
					citations: Array.from(citations),
				}
			: undefined;

	return { toolUses, searchMeta };
}

async function maybeInjectXSearch(
	messages: LLMMessage[],
	context: AppLoadContext,
): Promise<{ messages: LLMMessage[]; searchMeta?: LLMStreamEvent["search"] }> {
	const env = context.cloudflare.env;
	const apiKey = env.X_API_BEARER || env.XAI_API_KEY;
	const lastUserMessage = [...messages].reverse().find((msg) => msg.role === "user");

	if (!apiKey || !lastUserMessage) {
		return { messages };
	}

	const query = lastUserMessage.content.slice(0, 256);
	const results = await fetchXSearchResults(apiKey, query);
	if (results.length === 0) {
		return { messages };
	}

	const summaryLines = results.map((result) => {
		const prefix = result.author ? `@${result.author}: ` : "";
		const text = result.text.length > 240 ? `${result.text.slice(0, 240)}...` : result.text;
		return `- ${prefix}${text}`;
	});

	const systemMessage: LLMMessage = {
		role: "system",
		content: `X search results (recent):\n${summaryLines.join("\n")}`,
	};

	return {
		messages: [systemMessage, ...messages],
		searchMeta: {
			provider: "x",
			query,
			results,
		},
	};
}

function formatUserFacingError(message: string) {
	const lowered = message.toLowerCase();
	if (lowered.includes("api key")) {
		return "模型密钥未配置或无效。";
	}
	if (lowered.includes("rate limit")) {
		return "请求过于频繁，请稍后再试。";
	}
	return "上游服务暂时不可用，请稍后再试。";
}

async function fetchXSearchResults(apiKey: string, query: string) {
	const url = new URL("https://api.x.com/2/tweets/search/recent");
	url.searchParams.set("query", query);
	url.searchParams.set("max_results", "5");
	url.searchParams.set("tweet.fields", "author_id,created_at");
	url.searchParams.set("expansions", "author_id");
	url.searchParams.set("user.fields", "username,name");

	const response = await fetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});

	if (!response.ok) {
		return [];
	}

	const data = (await response.json()) as {
		data?: Array<{ id: string; text: string; author_id?: string; created_at?: string }>;
		includes?: { users?: Array<{ id: string; username?: string; name?: string }> };
	};

	const usersById = new Map(
		(data.includes?.users || []).map((user) => [user.id, user.username || user.name || ""]),
	);

	return (data.data || []).map((tweet) => ({
		id: tweet.id,
		author: tweet.author_id ? usersById.get(tweet.author_id) : undefined,
		text: tweet.text,
		createdAt: tweet.created_at,
		url: `https://x.com/i/web/status/${tweet.id}`,
	}));
}

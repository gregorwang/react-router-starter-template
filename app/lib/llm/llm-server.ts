import type { AppLoadContext } from "react-router";
import type { LLMMessage, LLMProvider, Usage } from "./types";

interface LLMStreamEvent {
	type: "delta" | "reasoning" | "usage" | "credits" | "meta" | "search" | "error";
	content?: string;
	usage?: Usage;
	credits?: number;
	meta?: { thinkingMs?: number };
	search?: {
		provider: "x" | "xai";
		query?: string;
		results?: Array<{
			id?: string;
			author?: string;
			text: string;
			url?: string;
			createdAt?: string;
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
	const extraBody =
		model.startsWith("claude-opus")
			? { output_effort: options?.outputEffort ?? "max", web_search: webSearch }
			: model.startsWith("claude-sonnet")
				? { web_search: webSearch }
				: undefined;

	const response = await fetch("https://poloai.top/v1/messages", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			Authorization: apiKey,
		},
		body: JSON.stringify({
			model,
			messages: messages.map((message) => ({
				role: message.role,
				content: message.content,
			})),
			stream: true,
			max_tokens: maxTokens,
			...(enableThinking ? { thinking: { type: "enabled", budget_tokens: thinkingBudget } } : {}),
			...(extraBody ? { extra_body: extraBody } : {}),
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`PoloAI API error: ${response.status} - ${errorText}`);
	}

	const contentType = response.headers.get("Content-Type") || "";
	if (!contentType.includes("text/event-stream")) {
		const data = (await response.json()) as any;
		const content = extractPoloAIContent(data);
		const reasoning = extractPoloAIReasoning(data);
		const usage = normalizeUsage(data?.usage);
		if (reasoning) {
			await writeEvent({ type: "reasoning", content: reasoning });
		}
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
		const content = extractPoloAIContent(parsed);
		const reasoning = extractPoloAIReasoning(parsed);
		const usage = normalizeUsage(parsed?.usage);
		if (reasoning) {
			await writeEvent({ type: "reasoning", content: reasoning });
		}
		if (content) {
			await writeEvent({ type: "delta", content });
		}
		if (usage) {
			await writeEvent({ type: "usage", usage });
		}
	});
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

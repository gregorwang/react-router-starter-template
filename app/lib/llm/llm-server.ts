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
		query: string;
		results: Array<{
			id?: string;
			author?: string;
			text: string;
			url?: string;
			createdAt?: string;
		}>;
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
		webSearch?: boolean;
	},
): Promise<ReadableStream<Uint8Array>> {
	const env = context.cloudflare.env;

	const apiKeyMap: Record<LLMProvider, string | undefined> = {
		deepseek: env.DEEPSEEK_API_KEY,
		xai: env.XAI_API_KEY,
		poe: env.POE_API_KEY,
		"workers-ai": undefined,
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
			console.log(
				`[LLM Server] Streaming request: Provider=${provider}, Model=${model}`,
			);

			let requestMessages = messages;
			let searchMeta: LLMStreamEvent["search"] | undefined;

			if (provider === "xai" && options?.webSearch) {
				const searchResult = await maybeInjectXSearch(messages, context);
				requestMessages = searchResult.messages;
				searchMeta = searchResult.searchMeta;
			}

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
			if (line.startsWith("data: ")) {
				const data = line.slice(6).trim();
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
	if (
		typeof promptTokens !== "number" ||
		typeof completionTokens !== "number" ||
		typeof totalTokens !== "number"
	) {
		return undefined;
	}
	return { promptTokens, completionTokens, totalTokens };
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
	return message;
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

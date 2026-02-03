import type { Route } from "./+types/chat.action";
import { streamLLMFromServer } from "../lib/llm/llm-server";
import type { LLMMessage, LLMProvider, Usage } from "../lib/llm/types";
import {
	appendConversationMessages,
	getConversation,
} from "../lib/db/conversations.server";
import { requireAuth } from "../lib/auth.server";

interface ChatActionData {
	conversationId: string;
	messages: LLMMessage[];
	provider: LLMProvider;
	model: string;
	userMessageId: string;
	assistantMessageId: string;
	reasoningEffort?: "low" | "medium" | "high";
	enableThinking?: boolean;
	thinkingBudget?: number;
	thinkingLevel?: "low" | "medium" | "high";
	webSearch?: boolean;
}

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 8000;
const MAX_TOTAL_CHARS = 120000;
const PROMPT_TOKEN_BUDGET = 3500;
const MIN_CONTEXT_MESSAGES = 4;

const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

export async function action({ request, context }: Route.ActionArgs) {
	await requireAuth(request, context.db);
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	const contentLength = request.headers.get("Content-Length");
	const length = contentLength ? Number(contentLength) : null;
	if (length && Number.isFinite(length) && length > MAX_BODY_BYTES) {
		return new Response("Payload too large", { status: 413 });
	}

	try {
		let data: ChatActionData;
		try {
			data = await request.json();
		} catch {
			return new Response("Invalid JSON", { status: 400 });
		}
		const validationError = validateChatActionData(data);
		if (validationError) {
			return new Response(validationError, { status: 400 });
		}

		const {
			conversationId,
			messages,
			provider,
			model,
			userMessageId,
			assistantMessageId,
			reasoningEffort,
			enableThinking,
			thinkingBudget,
			thinkingLevel,
			webSearch,
		} = data;

		const actorKey = await resolveActorKey(request);
		const rateLimitResult = await enforceRateLimit(context.cloudflare.env, actorKey);
		if (!rateLimitResult.allowed) {
			return new Response(
				JSON.stringify({
					error: "Rate limit exceeded. Try again later.",
					retryAt: rateLimitResult.resetAt,
				}),
				{
					status: 429,
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "no-store",
					},
				},
			);
		}

		const existingConversation = await getConversation(context.db, conversationId);
		if (!existingConversation) {
			return new Response("Conversation not found", { status: 404 });
		}

		let contextMessages = messages;
		let summaryMessage: LLMMessage | null = null;
		if (existingConversation.summary) {
			const summaryMessageCount = Math.min(
				existingConversation.summaryMessageCount ?? 0,
				messages.length,
			);
			let trimmed =
				summaryMessageCount > 0
					? messages.slice(summaryMessageCount)
					: messages;
			if (trimmed.length === 0 && messages.length > 0) {
				trimmed = messages.slice(-6);
			}
			summaryMessage = {
				role: "system" as const,
				content: `以下是对话摘要（用于继续上下文，不要逐字引用）：\n${existingConversation.summary}`,
			};
			contextMessages = trimmed;
		}
		const budget = Math.max(
			500,
			PROMPT_TOKEN_BUDGET -
				(summaryMessage ? estimateTokens(summaryMessage.content) : 0),
		);
		const trimmedMessages = trimMessagesToBudget(
			contextMessages,
			budget,
			MIN_CONTEXT_MESSAGES,
		);
		const requestMessages = summaryMessage
			? [summaryMessage, ...trimmedMessages]
			: trimmedMessages;

		// Start streaming LLM response
		const stream = await streamLLMFromServer(requestMessages, provider, model, context, {
			reasoningEffort,
			enableThinking,
			thinkingBudget,
			thinkingLevel,
			webSearch,
		});

		// Use waitUntil to save the conversation after stream completes
		const ctx = context.cloudflare.ctx;

		// Create a tee of the stream - one for the response, one for saving
		const [responseStream, saveStream] = stream.tee();

		// Save conversation in background
		ctx.waitUntil(
			(async () => {
				let fullContent = "";
				let reasoning = "";
				let usage: Usage | undefined;
				let credits: number | undefined;
				let thinkingMs: number | undefined;
				let searchMeta: any | undefined;

				await readSseStream(saveStream, (payload) => {
					try {
						const parsed = JSON.parse(payload);
						if (parsed.type === "delta" && parsed.content) {
							fullContent += parsed.content;
						}
						if (parsed.type === "reasoning" && parsed.content) {
							reasoning += parsed.content;
						}
						if (parsed.type === "usage" && parsed.usage) {
							usage = parsed.usage;
						}
						if (parsed.type === "credits" && parsed.credits) {
							credits = parsed.credits;
						}
						if (parsed.type === "meta" && parsed.meta?.thinkingMs) {
							thinkingMs = parsed.meta.thinkingMs;
						}
						if (parsed.type === "search" && parsed.search) {
							searchMeta = parsed.search;
						}
					} catch {
						// Ignore parse errors
					}
				});

				if (!usage) {
					usage = estimateUsage(requestMessages, fullContent);
				}

				const conversation = await getConversation(context.db, conversationId);
				if (conversation) {
					const lastMessage = messages[messages.length - 1];
					const userMessage = {
						id: userMessageId,
						role: "user" as const,
						content: lastMessage.content,
						timestamp: Date.now(),
					};
					const assistantMessage = {
						id: assistantMessageId,
						role: "assistant" as const,
						content: fullContent,
						timestamp: Date.now(),
						meta: {
							usage,
							credits,
							reasoning: reasoning || undefined,
							thinkingMs,
							webSearch: searchMeta,
						},
					};

					let nextTitle: string | undefined;
					if (
						conversation.messages.length === 0 &&
						(conversation.title === "New Chat" || conversation.title === "新对话")
					) {
						const firstUserMsg = lastMessage.content;
						nextTitle =
							firstUserMsg.slice(0, 50) + (firstUserMsg.length > 50 ? "..." : "");
					}

					await appendConversationMessages(
						context.db,
						conversation.id,
						{
							updatedAt: Date.now(),
							title: nextTitle,
							provider,
							model,
						},
						[userMessage, assistantMessage],
					);
				}
			})(),
		);

		return new Response(responseStream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-store, no-cache, no-transform",
				"Connection": "keep-alive",
				"X-Accel-Buffering": "no",
			},
		});
	} catch (error) {
		console.error("Chat action error:", error);
		return new Response(
			JSON.stringify({
				error: error instanceof Error ? toUserFacingError(error.message) : "Unknown error",
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
			},
		);
	}
}

function validateChatActionData(data: ChatActionData): string | null {
	if (!data || typeof data !== "object") return "Invalid payload";
	if (!data.conversationId) return "Missing conversationId";
	if (!data.userMessageId || !data.assistantMessageId) return "Missing message ids";
	if (!data.model) return "Missing model";
	if (!data.provider) return "Missing provider";
	if (!Array.isArray(data.messages) || data.messages.length === 0) {
		return "Missing messages";
	}
	if (data.messages.length > MAX_MESSAGES) {
		return "Too many messages";
	}
	const allowedProviders: LLMProvider[] = ["deepseek", "xai", "poe", "workers-ai"];
	if (!allowedProviders.includes(data.provider)) {
		return "Unsupported provider";
	}
	let totalChars = 0;
	const allowedRoles = new Set(["user", "assistant", "system"]);
	for (const message of data.messages) {
		if (!message || typeof message.content !== "string" || !message.role) {
			return "Invalid message format";
		}
		if (!allowedRoles.has(message.role)) {
			return "Invalid message role";
		}
		if (message.content.length > MAX_MESSAGE_CHARS) {
			return "Message too large";
		}
		totalChars += message.content.length;
	}
	if (totalChars > MAX_TOTAL_CHARS) {
		return "Payload too large";
	}
	const last = data.messages[data.messages.length - 1];
	if (last.role !== "user") {
		return "Last message must be user";
	}
	return null;
}

async function readSseStream(
	stream: ReadableStream<Uint8Array>,
	onData: (payload: string) => void,
) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line.startsWith("data: ")) continue;
			const payload = line.slice(6).trim();
			if (payload === "[DONE]") return;
			onData(payload);
		}
	}
}

async function resolveActorKey(request: Request) {
	const ip =
		request.headers.get("CF-Connecting-IP") ||
		request.headers
			.get("X-Forwarded-For")
			?.split(",")[0]
			?.trim() ||
		"unknown";
	return `ip:${ip}`;
}

async function enforceRateLimit(
	env: Env,
	key: string,
): Promise<{ allowed: boolean; resetAt?: number }> {
	if (import.meta.env.DEV) {
		return { allowed: true };
	}

	let allowed = true;
	let resetAt: number | undefined;

	if (env.CHAT_RATE_LIMITER) {
		try {
			const decision = await env.CHAT_RATE_LIMITER.limit({ key });
			if (decision && decision.success === false) {
				allowed = false;
			}
		} catch {
			// Ignore rate limiter errors and fall back to DO
		}
	}

	if (allowed && env.CHAT_RATE_LIMITER_DO) {
		const id = env.CHAT_RATE_LIMITER_DO.idFromName(key);
		const stub = env.CHAT_RATE_LIMITER_DO.get(id);
		const response = await stub.fetch("https://rate-limiter/limit", {
			method: "POST",
			body: JSON.stringify({ limit: 20, windowMs: 3_600_000 }),
		});
		if (response.ok) {
			const data = (await response.json()) as {
				allowed: boolean;
				resetAt?: number;
			};
			allowed = data.allowed;
			resetAt = data.resetAt ?? resetAt;
		}
	}

	return { allowed, resetAt };
}

function toUserFacingError(message: string) {
	if (message.toLowerCase().includes("api key")) {
		return "模型密钥未配置或无效。";
	}
	return "请求失败，请稍后再试。";
}

function trimMessagesToBudget(
	messages: LLMMessage[],
	budget: number,
	minKeep: number,
) {
	if (messages.length === 0) return messages;

	const keepMin = Math.min(minKeep, messages.length);
	let totalTokens = 0;
	const kept: LLMMessage[] = [];

	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		const messageTokens = estimateTokens(message.content);
		if (kept.length >= keepMin && totalTokens + messageTokens > budget) {
			break;
		}
		kept.unshift(message);
		totalTokens += messageTokens;
	}

	if (kept.length === 0) {
		return messages.slice(-1);
	}

	return kept;
}

function estimateUsage(messages: LLMMessage[], response: string): Usage {
	const promptTokens = messages.reduce(
		(total, msg) => total + estimateTokens(msg.content),
		0,
	);
	const completionTokens = estimateTokens(response);
	return {
		promptTokens,
		completionTokens,
		totalTokens: promptTokens + completionTokens,
		estimated: true,
	};
}

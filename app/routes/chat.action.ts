import type { Route } from "./+types/chat.action";
import { streamLLMFromServer } from "../lib/llm/llm-server";
import type { ImageAttachment, LLMMessage, LLMProvider, Usage } from "../lib/llm/types";
import { deriveConversationTitle } from "../lib/llm/title.server";
import { invalidateConversationCaches } from "../lib/cache/conversation-index.server";
import {
	appendConversationMessages,
	getConversation,
	saveConversation,
} from "../lib/db/conversations.server";
import { getProject, ensureDefaultProject } from "../lib/db/projects.server";
import { getUserModelLimit } from "../lib/db/user-model-limits.server";
import { countModelCallsSince } from "../lib/db/user-usage.server";
import { requireAuth } from "../lib/auth.server";

interface ChatActionData {
	conversationId: string;
	projectId?: string;
	messages: LLMMessage[];
	messagesTrimmed?: boolean;
	provider: LLMProvider;
	model: string;
	userMessageId: string;
	assistantMessageId: string;
	reasoningEffort?: "low" | "medium" | "high";
	enableThinking?: boolean;
	thinkingBudget?: number;
	thinkingLevel?: "low" | "medium" | "high";
	outputTokens?: number;
	outputEffort?: "low" | "medium" | "high" | "max";
	webSearch?: boolean;
	enableTools?: boolean;
}

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 20000;
const MAX_TOTAL_CHARS = 120000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 4;
const PROMPT_TOKEN_BUDGET = 3500;
const MIN_CONTEXT_MESSAGES = 4;

const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
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
			projectId,
			messages,
			messagesTrimmed,
			provider,
			model,
			userMessageId,
			assistantMessageId,
			reasoningEffort,
			enableThinking,
			thinkingBudget,
			thinkingLevel,
			outputTokens,
			outputEffort,
			webSearch,
			enableTools,
		} = data;

		if (provider === "workers-ai") {
			return new Response(
				JSON.stringify({ error: "Workers AI 暂时不可用。" }),
				{
					status: 503,
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "no-store",
					},
				},
			);
		}

		if (user.role !== "admin") {
			const limit = await getUserModelLimit(context.db, user.id, provider, model);
			if (!limit || !limit.enabled) {
				return new Response(
					JSON.stringify({ error: "该模型未授权使用。" }),
					{
						status: 403,
						headers: {
							"Content-Type": "application/json",
							"Cache-Control": "no-store",
						},
					},
				);
			}

			const now = Date.now();
			if (typeof limit.weeklyLimit === "number") {
				const weekStart = getWeekStartUtc(now);
				const weekCalls = await countModelCallsSince(context.db, {
					userId: user.id,
					provider,
					model,
					startMs: weekStart,
				});
				if (weekCalls >= limit.weeklyLimit) {
					return new Response(
						JSON.stringify({ error: "本周该模型调用次数已用尽。" }),
						{
							status: 429,
							headers: {
								"Content-Type": "application/json",
								"Cache-Control": "no-store",
							},
						},
					);
				}
			}

			if (typeof limit.monthlyLimit === "number") {
				const monthStart = getMonthStartUtc(now);
				const monthCalls = await countModelCallsSince(context.db, {
					userId: user.id,
					provider,
					model,
					startMs: monthStart,
				});
				if (monthCalls >= limit.monthlyLimit) {
					return new Response(
						JSON.stringify({ error: "本月该模型调用次数已用尽。" }),
						{
							status: 429,
							headers: {
								"Content-Type": "application/json",
								"Cache-Control": "no-store",
							},
						},
					);
				}
			}
		}

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

		let resolvedProjectId = projectId || undefined;
		if (resolvedProjectId) {
			const project = await getProject(context.db, resolvedProjectId, user.id);
			if (!project) {
				resolvedProjectId = undefined;
			}
		}
		if (!resolvedProjectId) {
			const fallback = await ensureDefaultProject(context.db, user.id);
			resolvedProjectId = fallback.id;
		}

		let existingConversation = await getConversation(
			context.db,
			user.id,
			conversationId,
		);
		if (!existingConversation) {
			const { results: conflict } = await context.db
				.prepare("SELECT user_id FROM conversations WHERE id = ?")
				.bind(conversationId)
				.all();
			if (conflict && conflict.length > 0 && conflict[0]?.user_id !== user.id) {
				return new Response(
					JSON.stringify({ error: "无权访问该对话。" }),
					{
						status: 403,
						headers: {
							"Content-Type": "application/json",
							"Cache-Control": "no-store",
						},
					},
				);
			}

			const now = Date.now();
			const nextConversation = {
				id: conversationId,
				projectId: resolvedProjectId,
				title: "新对话",
				userId: user.id,
				provider,
				model,
				createdAt: now,
				updatedAt: now,
				messages: [],
			};
			await saveConversation(context.db, nextConversation);
			existingConversation = nextConversation;
		}

		const payloadTrimmed = messagesTrimmed === true;
		let contextMessages = messages;
		let summaryMessage: LLMMessage | null = null;
		if (existingConversation.summary) {
			let trimmed = messages;
			if (!payloadTrimmed) {
				const summaryMessageCount = Math.min(
					existingConversation.summaryMessageCount ?? 0,
					messages.length,
				);
				trimmed =
					summaryMessageCount > 0
						? messages.slice(summaryMessageCount)
						: messages;
			}
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

		const lastMessage = messages[messages.length - 1];
		let storedAttachments: ImageAttachment[] | undefined;
		if (lastMessage?.attachments && lastMessage.attachments.length > 0) {
			storedAttachments = await persistAttachmentsToR2({
				env: context.cloudflare.env,
				userId: user.id,
				conversationId,
				attachments: lastMessage.attachments,
			});
		}

		// Start streaming LLM response
		const stream = await streamLLMFromServer(requestMessages, provider, model, context, {
			reasoningEffort,
			enableThinking,
			thinkingBudget,
			thinkingLevel,
			outputTokens,
			outputEffort,
			webSearch,
			enableTools,
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

				const conversation = await getConversation(
					context.db,
					user.id,
					conversationId,
				);
				if (conversation) {
					const lastMessage = messages[messages.length - 1];
					const attachmentsForMeta =
						storedAttachments && storedAttachments.length > 0
							? storedAttachments
							: undefined;
					const userMessage = {
						id: userMessageId,
						role: "user" as const,
						content: lastMessage.content,
						timestamp: Date.now(),
						meta: {
							model,
							provider,
							attachments: attachmentsForMeta,
						},
					};
					const assistantMessage = {
						id: assistantMessageId,
						role: "assistant" as const,
						content: fullContent,
						timestamp: Date.now(),
						meta: {
							model,
							provider,
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
						nextTitle = deriveConversationTitle([
							{ role: "user", content: firstUserMsg },
						]);
					}

					await appendConversationMessages(
						context.db,
						user.id,
						conversation.id,
						{
							updatedAt: Date.now(),
							title: nextTitle,
							provider,
							model,
						},
						[userMessage, assistantMessage],
					);
					if (context.cloudflare.env.SETTINGS_KV) {
						await invalidateConversationCaches(
							context.cloudflare.env.SETTINGS_KV,
							user.id,
							conversation.projectId,
						);
					}
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
	if (
		data.messagesTrimmed !== undefined &&
		typeof data.messagesTrimmed !== "boolean"
	) {
		return "Invalid payload";
	}
	if (data.enableTools !== undefined && typeof data.enableTools !== "boolean") {
		return "Invalid payload";
	}
	if (!Array.isArray(data.messages) || data.messages.length === 0) {
		return "Missing messages";
	}
	if (data.messages.length > MAX_MESSAGES) {
		return "Too many messages";
	}
	const allowedProviders: LLMProvider[] = [
		"deepseek",
		"xai",
		"poe",
		"workers-ai",
		"poloai",
		"ark",
	];
	if (!allowedProviders.includes(data.provider)) {
		return "Unsupported provider";
	}
	const hasAttachments = data.messages.some(
		(message) => Array.isArray(message.attachments) && message.attachments.length > 0,
	);
	if (hasAttachments && data.provider !== "poloai" && data.provider !== "xai") {
		return "Images not supported for this provider";
	}
	let totalChars = 0;
	let totalImageBytes = 0;
	const allowedRoles = new Set(["user", "assistant", "system"]);
	const allowedImageMimeTypes =
		data.provider === "xai"
			? new Set(["image/jpeg", "image/png"])
			: new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
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
		if (message.attachments !== undefined) {
			if (!Array.isArray(message.attachments)) {
				return "Invalid attachments";
			}
			if (message.attachments.length > MAX_IMAGES_PER_MESSAGE) {
				return "Too many images";
			}
			if (message.role !== "user") {
				return "Images must be in user messages";
			}
			for (const attachment of message.attachments) {
				if (
					!attachment ||
					typeof attachment.id !== "string" ||
					typeof attachment.mimeType !== "string" ||
					typeof attachment.data !== "string"
				) {
					return "Invalid attachment format";
				}
				if (!allowedImageMimeTypes.has(attachment.mimeType)) {
					return "Unsupported image type";
				}
				const base64 = attachment.data.replace(/\s+/g, "");
				if (!/^[A-Za-z0-9+/=]*$/.test(base64)) {
					return "Invalid image data";
				}
				const estimatedBytes = Math.floor((base64.length * 3) / 4);
				if (estimatedBytes > MAX_IMAGE_BYTES) {
					return "Image too large";
				}
				totalImageBytes += estimatedBytes;
			}
		}
		totalChars += message.content.length;
	}
	if (totalChars > MAX_TOTAL_CHARS) {
		return "Payload too large";
	}
	if (totalImageBytes > MAX_TOTAL_IMAGE_BYTES) {
		return "Images too large";
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

function getImageExtension(mimeType: string) {
	switch (mimeType) {
		case "image/jpeg":
			return "jpg";
		case "image/png":
			return "png";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		default:
			return "bin";
	}
}

function decodeBase64ToUint8Array(data: string) {
	const normalized = data.replace(/\s+/g, "");
	const binary = atob(normalized);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

async function persistAttachmentsToR2(options: {
	env: Env;
	userId: string;
	conversationId: string;
	attachments: ImageAttachment[];
}): Promise<ImageAttachment[]> {
	if (!options.attachments.length) return [];
	if (!options.env.CHAT_MEDIA) {
		throw new Error("R2 binding not configured");
	}

	const stored: ImageAttachment[] = [];
	for (const attachment of options.attachments) {
		if (!attachment.data) continue;
		const ext = getImageExtension(attachment.mimeType);
		const key = `img_${options.userId}_${options.conversationId}_${attachment.id}.${ext}`;
		const bytes = decodeBase64ToUint8Array(attachment.data);
		await options.env.CHAT_MEDIA.put(key, bytes, {
			httpMetadata: { contentType: attachment.mimeType },
		});
		stored.push({
			id: attachment.id,
			mimeType: attachment.mimeType,
			name: attachment.name,
			size: attachment.size ?? bytes.length,
			url: `/media/${encodeURIComponent(key)}`,
			r2Key: key,
		});
	}

	return stored;
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
	if (message.toLowerCase().includes("r2 binding")) {
		return "图片存储未配置，请检查 R2 绑定。";
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

function getWeekStartUtc(nowMs: number) {
	const date = new Date(nowMs);
	const day = date.getUTCDay();
	const diff = (day + 6) % 7; // Monday = 0
	const start = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
	start.setUTCDate(start.getUTCDate() - diff);
	start.setUTCHours(0, 0, 0, 0);
	return start.getTime();
}

function getMonthStartUtc(nowMs: number) {
	const date = new Date(nowMs);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0);
}

import type {
	LLMMessage,
	LLMProvider,
	Usage,
	XAISearchMode,
} from "../llm/types";

export interface ChatActionData {
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
	xaiSearchMode?: XAISearchMode;
	enableTools?: boolean;
}

export const CHAT_ACTION_MAX_BODY_BYTES = 16 * 1024 * 1024;
export const CHAT_PROMPT_TOKEN_BUDGET = 12000;
export const CHAT_MIN_CONTEXT_MESSAGES = 6;

const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 20000;
const MAX_TOTAL_CHARS = 120000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 4;

const XAI_ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"application/pdf",
	"text/plain",
	"text/markdown",
	"text/csv",
	"application/json",
]);
const POLO_ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
	"application/pdf",
]);

const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

export function validateChatActionData(data: ChatActionData): string | null {
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
	if (
		data.xaiSearchMode !== undefined &&
		!["x", "web", "both"].includes(data.xaiSearchMode)
	) {
		return "Invalid payload";
	}
	if (data.xaiSearchMode !== undefined && data.provider !== "xai") {
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
		return "Attachments not supported for this provider";
	}
	let totalChars = 0;
	let totalImageBytes = 0;
	const allowedRoles = new Set(["user", "assistant", "system"]);
	const allowedImageMimeTypes =
		data.provider === "xai"
			? XAI_ALLOWED_ATTACHMENT_MIME_TYPES
			: POLO_ALLOWED_ATTACHMENT_MIME_TYPES;
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

export async function readJsonBodyWithLimit<T>(
	request: Request,
	maxBytes: number,
): Promise<
	| { ok: true; data: T }
	| { ok: false; status: 400 | 413; message: string }
> {
	const contentLength = request.headers.get("Content-Length");
	const declaredLength = contentLength ? Number(contentLength) : NaN;
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		return { ok: false, status: 413, message: "Payload too large" };
	}

	if (!request.body) {
		return { ok: false, status: 400, message: "Invalid JSON" };
	}

	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let totalBytes = 0;
	let body = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;

			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				await reader.cancel("Payload too large");
				return { ok: false, status: 413, message: "Payload too large" };
			}

			body += decoder.decode(value, { stream: true });
		}
		body += decoder.decode();
	} catch {
		return { ok: false, status: 400, message: "Invalid JSON" };
	}

	try {
		return { ok: true, data: JSON.parse(body) as T };
	} catch {
		return { ok: false, status: 400, message: "Invalid JSON" };
	}
}

export function trimMessagesToBudget(
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

export function estimateUsage(messages: LLMMessage[], response: string): Usage {
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

export function getWeekStartUtc(nowMs: number) {
	const date = new Date(nowMs);
	const day = date.getUTCDay();
	const diff = (day + 6) % 7;
	const start = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
	start.setUTCDate(start.getUTCDate() - diff);
	start.setUTCHours(0, 0, 0, 0);
	return start.getTime();
}

export function getMonthStartUtc(nowMs: number) {
	const date = new Date(nowMs);
	return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0);
}

export function toUserFacingError(message: string) {
	if (message.toLowerCase().includes("api key")) {
		return "模型密钥未配置或无效。";
	}
	if (message.toLowerCase().includes("r2 binding")) {
		return "图片存储未配置，请检查 R2 绑定。";
	}
	return "请求失败，请稍后再试。";
}

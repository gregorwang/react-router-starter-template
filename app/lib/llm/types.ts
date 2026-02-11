export type LLMProvider =
	| "deepseek"
	| "xai"
	| "poe"
	| "workers-ai"
	| "poloai"
	| "ark";

export interface Attachment {
	id: string;
	mimeType:
		| "image/jpeg"
		| "image/png"
		| "image/gif"
		| "image/webp"
		| "application/pdf"
		| "text/plain"
		| "text/markdown"
		| "text/csv"
		| "application/json";
	data?: string;
	name?: string;
	size?: number;
	url?: string;
	r2Key?: string;
}

/** @deprecated Use `Attachment` instead. */
export type ImageAttachment = Attachment;

export interface LLMMessage {
	role: "user" | "assistant" | "system";
	content: string;
	attachments?: Attachment[];
}

export type ConversationId = string;
export type XAISearchMode = "x" | "web" | "both";

export interface Message {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
	meta?: MessageMeta;
}

export interface Conversation {
	id: ConversationId;
	title: string;
	messages: Message[];
	messageCount?: number;
	userId?: string;
	provider: LLMProvider;
	model: string;
	projectId?: string;
	isArchived?: boolean;
	isPinned?: boolean;
	pinnedAt?: number;
	forkedFromConversationId?: string;
	forkedFromMessageId?: string;
	forkedAt?: number;
	createdAt: number;
	updatedAt: number;
	isPersisted?: boolean;
	summary?: string;
	summaryUpdatedAt?: number;
	summaryMessageCount?: number;
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

export interface Project {
	id: string;
	name: string;
	description?: string;
	userId?: string;
	isDefault?: boolean;
	createdAt: number;
	updatedAt: number;
}

export type UserRole = "admin" | "user";

export interface User {
	id: string;
	username: string;
	role: UserRole;
	createdAt: number;
	updatedAt: number;
	lastLoginAt?: number;
}

export interface Usage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	estimated?: boolean;
}

export interface MessageMeta {
	model?: string;
	provider?: LLMProvider;
	event?: {
		type: "context_cleared";
		at: number;
	};
	usage?: Usage;
	credits?: number;
	reasoning?: string;
	thinkingMs?: number;
	attachments?: Attachment[];
	webSearch?: {
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

export const PROVIDER_NAMES: Record<LLMProvider, string> = {
	poe: "Poe",
	xai: "xAI",
	deepseek: "DeepSeek",
	poloai: "PoloAI",
	ark: "火山方舟",
	"workers-ai": "Workers AI",
};

export const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
	poe: [
		"grok-4.1-fast-reasoning",
		"kimi-k2.5",
		"claude-sonnet-4.5",
		"o3",
		"gemini-3-pro",
	],
	xai: [
		"grok-4-1-fast-reasoning",
		"grok-4-1-fast-non-reasoning",
		"grok-code-fast-1",
		"grok-4-fast-reasoning",
		"grok-4-fast-non-reasoning",
		"grok-4-0709",
		"grok-3-mini",
		"grok-3",
		"grok-2-vision-1212",
	],
	deepseek: ["deepseek-chat", "deepseek-reasoner"],
	poloai: [
		"claude-opus-4-6",
		"claude-opus-4-5-20251101-thinking",
		"claude-sonnet-4-5-20250929-thinking",
		"claude-sonnet-4-5-20250929",
		"claude-haiku-4-5-20251001-thinking",
	],
	ark: ["ark-code-latest"],
	"workers-ai": [
		"@cf/meta/llama-3.1-8b-instruct",
		"@cf/meta/llama-3.1-70b-instruct",
		"@cf/qwen/qwen1.5-7b-chat",
	],
};


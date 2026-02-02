export type LLMProvider = "deepseek" | "xai" | "poe" | "workers-ai";

export interface LLMMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

export interface LLMStreamChunk {
	content: string;
	done: boolean;
}

export interface LLMResponse {
	content: string;
	usage?: Usage;
}

export interface LLMProviderConfig {
	apiKey: string;
	baseUrl?: string;
	model?: string;
}

export interface LLMClientOptions {
	provider: LLMProvider;
	config: LLMProviderConfig;
}

export interface LLMStreamCallback {
	onChunk: (chunk: string) => void;
	onComplete: (content: string) => void;
	onError: (error: Error) => void;
}

export type ConversationId = string;

export interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: number;
	meta?: MessageMeta;
}

export interface Conversation {
	id: ConversationId;
	title: string;
	messages: Message[];
	provider: LLMProvider;
	model: string;
	projectId?: string;
	createdAt: number;
	updatedAt: number;
	reasoningEffort?: "low" | "medium" | "high";
	enableThinking?: boolean;
	thinkingBudget?: number;
	thinkingLevel?: "low" | "medium" | "high";
	webSearch?: boolean;
}

export interface Project {
	id: string;
	name: string;
	description?: string;
	createdAt: number;
	updatedAt: number;
}

export interface Usage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	estimated?: boolean;
}

export interface MessageMeta {
	usage?: Usage;
	credits?: number;
	reasoning?: string;
	thinkingMs?: number;
	webSearch?: {
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

export const PROVIDER_NAMES: Record<LLMProvider, string> = {
	deepseek: "DeepSeek",
	xai: "xAI",
	poe: "Poe",
	"workers-ai": "Workers AI",
};

export const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
	deepseek: ["deepseek-chat", "deepseek-reasoner"],
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
	poe: ["kimi-k2.5", "claude-sonnet-4.5", "o3", "gemini-3-pro"],
	"workers-ai": [
		"@cf/meta/llama-3.1-8b-instruct",
		"@cf/meta/llama-3.1-70b-instruct",
		"@cf/qwen/qwen1.5-7b-chat",
	],
};

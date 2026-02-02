export type LLMProvider = "deepseek" | "xai" | "poe";

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
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
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
}

export interface Conversation {
	id: ConversationId;
	title: string;
	messages: Message[];
	provider: LLMProvider;
	model: string;
	createdAt: number;
	updatedAt: number;
	reasoningEffort?: "low" | "medium" | "high";
	enableThinking?: boolean;
	thinkingBudget?: number;
	thinkingLevel?: "low" | "medium" | "high";
	webSearch?: boolean;
}

export interface Settings {
	deepseekApiKey: string;
	xaiApiKey: string;
	poeApiKey: string;
	deepseekModel: string;
	xaiModel: string;
	poeModel: string;
	theme: "light" | "dark" | "auto";
}

export const DEFAULT_SETTINGS: Settings = {
	deepseekApiKey: "",
	xaiApiKey: "",
	poeApiKey: "",
	deepseekModel: "deepseek-chat",
	xaiModel: "grok-3",
	poeModel: "kimi-k2.5",
	theme: "auto",
};

export const PROVIDER_NAMES: Record<LLMProvider, string> = {
	deepseek: "DeepSeek",
	xai: "xAI",
	poe: "Poe",
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
};

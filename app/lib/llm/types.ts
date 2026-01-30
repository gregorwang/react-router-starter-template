export type LLMProvider = "openai" | "anthropic" | "google" | "deepseek";

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
}

export interface Settings {
	openaiApiKey: string;
	anthropicApiKey: string;
	googleApiKey: string;
	deepseekApiKey: string;
	openaiModel: string;
	anthropicModel: string;
	googleModel: string;
	deepseekModel: string;
	theme: "light" | "dark" | "auto";
}

export const DEFAULT_SETTINGS: Settings = {
	openaiApiKey: "",
	anthropicApiKey: "",
	googleApiKey: "",
	deepseekApiKey: "",
	openaiModel: "gpt-4o",
	anthropicModel: "claude-3-5-sonnet-20241022",
	googleModel: "gemini-2.0-flash-exp",
	deepseekModel: "deepseek-chat",
	theme: "auto",
};

export const PROVIDER_NAMES: Record<LLMProvider, string> = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	google: "Google",
	deepseek: "DeepSeek",
};

export const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
	openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
	anthropic: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
	google: ["gemini-2.0-flash-exp", "gemini-2.0-flash-thinking-exp", "gemini-1.5-pro"],
	deepseek: ["deepseek-chat", "deepseek-coder"],
};

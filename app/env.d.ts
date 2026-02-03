export {};

declare global {
	interface Env {
		DB: D1Database;
		AI?: Ai;
		CHAT_ARCHIVE?: R2Bucket;
		CHAT_RATE_LIMITER?: RateLimit;
		CHAT_RATE_LIMITER_DO?: DurableObjectNamespace;
		DEEPSEEK_API_KEY?: string;
		XAI_API_KEY?: string;
		POE_API_KEY?: string;
		X_API_BEARER?: string;
		AUTH_PASSWORD?: string;
	}
}

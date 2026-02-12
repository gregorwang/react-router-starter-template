export {};

declare global {
	interface Env {
		DB: D1Database;
		AI?: Ai;
		SETTINGS_KV?: KVNamespace;
		CHAT_ARCHIVE?: R2Bucket;
		CHAT_MEDIA?: R2Bucket;
		CHAT_RATE_LIMITER?: RateLimit;
		CHAT_RATE_LIMITER_DO?: DurableObjectNamespace;
		CHAT_SESSION_DO?: DurableObjectNamespace;
		CHAT_SUMMARY_QUEUE?: Queue;
		DEEPSEEK_API_KEY?: string;
		XAI_API_KEY?: string;
		POE_API_KEY?: string;
		POLOAI_API_KEY?: string;
		ARK_API_KEY?: string;
		X_API_BEARER?: string;
		AUTH_PASSWORD?: string;
		ADMIN_USERNAME?: string;
		ADMIN_PASSWORD?: string;
		SUMMARY_PROVIDER?: string;
		SUMMARY_MODEL?: string;
		TITLE_PROVIDER?: string;
		TITLE_MODEL?: string;
		D1_LOG?: string;
	}
}

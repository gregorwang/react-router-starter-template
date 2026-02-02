export {};

declare global {
	interface Env {
		DEEPSEEK_API_KEY?: string;
		XAI_API_KEY?: string;
		POE_API_KEY?: string;
		X_API_BEARER?: string;
	}
}

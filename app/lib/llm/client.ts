import type {
	LLMProvider,
	LLMProviderConfig,
	LLMMessage,
	LLMStreamCallback,
} from "./types";
import { streamOpenAI } from "./providers/openai";
import { streamAnthropic } from "./providers/anthropic";
import { streamGoogle } from "./providers/google";
import { streamDeepSeek } from "./providers/deepseek";

export async function* streamLLM(
	messages: LLMMessage[],
	provider: LLMProvider,
	config: LLMProviderConfig,
	callback: LLMStreamCallback,
): AsyncGenerator<string, void, unknown> {
	switch (provider) {
		case "openai":
			yield* streamOpenAI(messages, config, callback);
			break;
		case "anthropic":
			yield* streamAnthropic(messages, config, callback);
			break;
		case "google":
			yield* streamGoogle(messages, config, callback);
			break;
		case "deepseek":
			yield* streamDeepSeek(messages, config, callback);
			break;
		default:
			throw new Error(`Unsupported provider: ${provider}`);
	}
}

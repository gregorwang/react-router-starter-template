import type {
	LLMProviderConfig,
	LLMMessage,
	LLMStreamCallback,
} from "../types";

export async function* streamDeepSeek(
	messages: LLMMessage[],
	config: LLMProviderConfig,
	callback: LLMStreamCallback,
): AsyncGenerator<string, void, unknown> {
	// DeepSeek uses OpenAI-compatible API
	const baseUrl = config.baseUrl || "https://api.deepseek.com";
	const model = config.model || "deepseek-chat";

	try {
		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify({
				model,
				messages,
				stream: true,
				temperature: 0.7,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`DeepSeek API error: ${response.status} ${response.statusText} - ${errorText}`,
			);
		}

		const reader = response.body?.getReader();
		const decoder = new TextDecoder();

		if (!reader) {
			throw new Error("No response body received");
		}

		let fullContent = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const chunk = decoder.decode(value);
			const lines = chunk.split("\n");

			for (const line of lines) {
				if (line.startsWith("data: ")) {
					const data = line.slice(6);
					if (data === "[DONE]") break;

					try {
						const parsed = JSON.parse(data);
						const content =
							parsed.choices?.[0]?.delta?.content || "";
						if (content) {
							fullContent += content;
							callback.onChunk(content);
							yield content;
						}
					} catch {
						// Ignore JSON parse errors for incomplete chunks
					}
				}
			}
		}

		callback.onComplete(fullContent);
	} catch (error) {
		callback.onError(error instanceof Error ? error : new Error(String(error)));
		throw error;
	}
}

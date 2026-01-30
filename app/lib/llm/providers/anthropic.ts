import type {
	LLMProviderConfig,
	LLMMessage,
	LLMStreamCallback,
} from "../types";

export async function* streamAnthropic(
	messages: LLMMessage[],
	config: LLMProviderConfig,
	callback: LLMStreamCallback,
): AsyncGenerator<string, void, unknown> {
	const baseUrl = config.baseUrl || "https://api.anthropic.com";
	const model = config.model || "claude-3-5-sonnet-20241022";

	try {
		const response = await fetch(`${baseUrl}/v1/messages`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": config.apiKey,
				"anthropic-version": "2023-06-01",
				"anthropic-dangerous-direct-browser-access": "true",
			},
			body: JSON.stringify({
				model,
				messages,
				max_tokens: 4096,
				stream: true,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`,
			);
		}

		const reader = response.body?.getReader();
		const decoder = { decode: (v: Uint8Array) => new TextDecoder().decode(v) };

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
						if (parsed.type === "content_block_delta") {
							const content = parsed.delta?.text || "";
							if (content) {
								fullContent += content;
								callback.onChunk(content);
								yield content;
							}
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

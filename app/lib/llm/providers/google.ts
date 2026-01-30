import type {
	LLMProviderConfig,
	LLMMessage,
	LLMStreamCallback,
} from "../types";

export async function* streamGoogle(
	messages: LLMMessage[],
	config: LLMProviderConfig,
	callback: LLMStreamCallback,
): AsyncGenerator<string, void, unknown> {
	const baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com";
	const model = config.model || "gemini-2.0-flash-exp";

	try {
		// Google Gemini uses a different message format
		const contents = messages.map((msg) => ({
			role: msg.role === "user" ? "user" : "model",
			parts: [{ text: msg.content }],
		}));

		const response = await fetch(
			`${baseUrl}/v1beta/models/${model}:streamGenerateContent?key=${config.apiKey}`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					contents,
					generationConfig: {
						temperature: 0.7,
						maxOutputTokens: 4096,
					},
				}),
			},
		);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Google API error: ${response.status} ${response.statusText} - ${errorText}`,
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
				if (line.trim()) {
					try {
						const parsed = JSON.parse(line);
						const content =
							parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
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

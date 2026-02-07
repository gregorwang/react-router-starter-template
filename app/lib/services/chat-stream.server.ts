import { consumeSSE } from "../utils/sse";
import type { MessageMeta, Usage } from "../llm/types";

export type ChatStreamResult = {
	fullContent: string;
	reasoning: string;
	usage?: Usage;
	credits?: number;
	thinkingMs?: number;
	searchMeta?: MessageMeta["webSearch"];
};

export async function collectSSEChatResult(
	stream: ReadableStream<Uint8Array>,
): Promise<ChatStreamResult> {
	let fullContent = "";
	let reasoning = "";
	let usage: Usage | undefined;
	let credits: number | undefined;
	let thinkingMs: number | undefined;
	let searchMeta: MessageMeta["webSearch"] | undefined;

	await consumeSSE(stream, ({ data }) => {
		const payload = data.trim();
		if (!payload) return true;
		if (payload === "[DONE]") return false;

		try {
			const parsed = JSON.parse(payload) as {
				type?: string;
				content?: string;
				usage?: Usage;
				credits?: number;
				meta?: { thinkingMs?: number };
				search?: MessageMeta["webSearch"];
			};
			if (parsed.type === "delta" && parsed.content) {
				fullContent += parsed.content;
			}
			if (parsed.type === "reasoning" && parsed.content) {
				reasoning += parsed.content;
			}
			if (parsed.type === "usage" && parsed.usage) {
				usage = parsed.usage;
			}
			if (parsed.type === "credits" && typeof parsed.credits === "number") {
				credits = parsed.credits;
			}
			if (parsed.type === "meta" && parsed.meta?.thinkingMs) {
				thinkingMs = parsed.meta.thinkingMs;
			}
			if (parsed.type === "search" && parsed.search) {
				searchMeta = parsed.search;
			}
		} catch {
			// Ignore malformed payloads.
		}
		return true;
	});

	return {
		fullContent,
		reasoning,
		usage,
		credits,
		thinkingMs,
		searchMeta,
	};
}

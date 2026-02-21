import { describe, expect, it } from "vitest";
import { collectSSEChatResult } from "./chat-stream.server";

function createStream(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
}

describe("collectSSEChatResult", () => {
	it("aggregates SSE payload into stream result", async () => {
		const stream = createStream([
			'data: {"type":"delta","content":"hello"}\n\n',
			'data: {"type":"reasoning","content":"think"}\n\n',
			'data: {"type":"credits","credits":9}\n\n',
			'data: {"type":"meta","meta":{"thinkingMs":321}}\n\n',
			'data: {"type":"meta","meta":{"stopReason":"max_tokens"}}\n\n',
			'data: {"type":"search","search":{"provider":"x"}}\n\n',
			"data: [DONE]\n\n",
		]);

		const result = await collectSSEChatResult(stream);
		expect(result.fullContent).toBe("hello");
		expect(result.reasoning).toBe("think");
		expect(result.credits).toBe(9);
		expect(result.thinkingMs).toBe(321);
		expect(result.stopReason).toBe("max_tokens");
		expect(result.searchMeta).toEqual({ provider: "x" });
	});
});

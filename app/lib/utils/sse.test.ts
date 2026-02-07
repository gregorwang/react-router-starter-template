import { describe, expect, it, vi } from "vitest";
import { consumeSSE, consumeSSEJson, type SSEMessage } from "./sse";

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

describe("consumeSSE", () => {
	it("parses event fields across chunk boundaries", async () => {
		const stream = createStream([
			"id: 42\n",
			"event: delta\n",
			"data: hello\n",
			"data: world\n\n",
		]);
		const messages: SSEMessage[] = [];

		await consumeSSE(stream, (message) => {
			messages.push(message);
		});

		expect(messages).toEqual([
			{
				id: "42",
				event: "delta",
				data: "hello\nworld",
				retry: undefined,
			},
		]);
	});
});

describe("consumeSSEJson", () => {
	it("stops on [DONE] token", async () => {
		const stream = createStream([
			'data: {"type":"delta","content":"a"}\n\n',
			"data: [DONE]\n\n",
			'data: {"type":"delta","content":"b"}\n\n',
		]);

		const parsed: Array<{ type: string; content: string }> = [];
		await consumeSSEJson(stream, (message) => {
			parsed.push(message as { type: string; content: string });
		});

		expect(parsed).toEqual([{ type: "delta", content: "a" }]);
	});

	it("invokes onParseError for invalid payloads", async () => {
		const stream = createStream(["data: invalid-json\n\n", "data: [DONE]\n\n"]);
		const onParseError = vi.fn();

		await consumeSSEJson(stream, () => undefined, { onParseError });

		expect(onParseError).toHaveBeenCalledOnce();
	});
});

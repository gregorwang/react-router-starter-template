import { describe, expect, it } from "vitest";
import {
	CHAT_ACTION_MAX_BODY_BYTES,
	readJsonBodyWithLimit,
	trimMessagesToBudget,
	validateChatActionData,
} from "./chat-action-guards.server";
import type { ChatActionData } from "./chat-action-guards.server";

function buildValidPayload(): ChatActionData {
	return {
		conversationId: "conv-1",
		userMessageId: "msg-user-1",
		assistantMessageId: "msg-assistant-1",
		provider: "poe",
		model: "grok-4.1-fast-reasoning",
		messages: [
			{
				role: "user",
				content: "hello",
			},
		],
	};
}

describe("validateChatActionData", () => {
	it("accepts a valid payload", () => {
		expect(validateChatActionData(buildValidPayload())).toBeNull();
	});

	it("rejects unsupported provider", () => {
		const payload = {
			...buildValidPayload(),
			provider: "invalid-provider",
		} as unknown as ChatActionData;
		expect(validateChatActionData(payload)).toBe("Unsupported provider");
	});

	it("rejects attachments for unsupported providers", () => {
		const payload: ChatActionData = {
			...buildValidPayload(),
			provider: "deepseek",
			messages: [
				{
					role: "user",
					content: "has attachment",
					attachments: [
						{
							id: "att-1",
							mimeType: "image/png",
							data: "aGVsbG8=",
						},
					],
				},
			],
		};
		expect(validateChatActionData(payload)).toBe(
			"Attachments not supported for this provider",
		);
	});
});

describe("readJsonBodyWithLimit", () => {
	it("returns 413 when declared Content-Length exceeds max", async () => {
		const response = await readJsonBodyWithLimit<{ ok: boolean }>(
			new Request("https://example.com/chat", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": String(CHAT_ACTION_MAX_BODY_BYTES + 1),
				},
				body: JSON.stringify({ ok: true }),
			}),
			CHAT_ACTION_MAX_BODY_BYTES,
		);
		expect(response).toEqual({
			ok: false,
			status: 413,
			message: "Payload too large",
		});
	});
});

describe("trimMessagesToBudget", () => {
	it("keeps recent messages within budget while preserving minKeep", () => {
		const messages = [
			{ role: "user" as const, content: "a".repeat(1000) },
			{ role: "assistant" as const, content: "b".repeat(1000) },
			{ role: "user" as const, content: "c".repeat(1000) },
		];

		const kept = trimMessagesToBudget(messages, 100, 2);
		expect(kept.length).toBe(2);
		expect(kept[0].content[0]).toBe("b");
		expect(kept[1].content[0]).toBe("c");
	});
});

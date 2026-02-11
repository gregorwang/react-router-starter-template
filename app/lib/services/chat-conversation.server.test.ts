import { describe, expect, it } from "vitest";
import { buildRequestMessages } from "./chat-conversation.server";
import type { LLMMessage } from "../llm/types";

describe("buildRequestMessages", () => {
	it("prepends summary system message when summary is present", () => {
		const messages: LLMMessage[] = [
			{ role: "user", content: "q1" },
			{ role: "assistant", content: "a1" },
		];

		const result = buildRequestMessages({
			messages,
			summary: "summary text",
			summaryMessageCount: 1,
			promptTokenBudget: 3500,
			minContextMessages: 2,
		});

		expect(result[0].role).toBe("system");
		expect(result[0].content).toContain("summary text");
		expect(result.slice(1).map((message) => message.content)).toEqual(["q1", "a1"]);
	});

	it("keeps a recent overlap window when summary is present", () => {
		const messages: LLMMessage[] = [
			{ role: "user", content: "u1" },
			{ role: "assistant", content: "a1" },
			{ role: "user", content: "u2" },
			{ role: "assistant", content: "a2" },
			{ role: "user", content: "u3" },
			{ role: "assistant", content: "a3" },
			{ role: "user", content: "u4" },
			{ role: "assistant", content: "a4" },
			{ role: "user", content: "u5" },
		];

		const result = buildRequestMessages({
			messages,
			summary: "summary text",
			summaryMessageCount: 8,
			promptTokenBudget: 3500,
			minContextMessages: 2,
		});

		expect(result[0].role).toBe("system");
		expect(result.slice(1).map((message) => message.content)).toEqual([
			"u3",
			"a3",
			"u4",
			"a4",
			"u5",
		]);
	});

	it("keeps only recent messages when budget is small", () => {
		const messages: LLMMessage[] = [
			{ role: "user", content: "a".repeat(1000) },
			{ role: "assistant", content: "b".repeat(1000) },
			{ role: "user", content: "c".repeat(1000) },
		];

		const result = buildRequestMessages({
			messages,
			promptTokenBudget: 100,
			minContextMessages: 2,
		});

		expect(result.length).toBe(2);
		expect(result[0].content[0]).toBe("b");
		expect(result[1].content[0]).toBe("c");
	});
});

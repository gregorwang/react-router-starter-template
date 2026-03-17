import { describe, expect, it } from "vitest";
import {
	buildPrompt,
	applyTokenBudget,
	estimateTokens,
	type PromptBlock,
	type PromptBuildInput,
} from "./prompt-builder";

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
	it("returns at least 1 for empty string", () => {
		expect(estimateTokens("")).toBe(1);
	});

	it("returns roughly length/4", () => {
		expect(estimateTokens("abcdefgh")).toBe(2);
		expect(estimateTokens("a".repeat(100))).toBe(25);
	});
});

// ---------------------------------------------------------------------------
// applyTokenBudget
// ---------------------------------------------------------------------------

describe("applyTokenBudget", () => {
	it("keeps all blocks when within budget", () => {
		const blocks: PromptBlock[] = [
			{ role: "system", content: "sys", tag: "system_prompt", priority: 100 },
			{ role: "user", content: "hi", tag: "user_input", priority: 1000 },
		];
		const result = applyTokenBudget(blocks, 10000);
		expect(result.messages.length).toBe(2);
		expect(result.trimmedTags).toEqual([]);
	});

	it("trims lowest priority blocks first", () => {
		const blocks: PromptBlock[] = [
			{ role: "system", content: "a".repeat(400), tag: "system_prompt", priority: 100 },
			{ role: "system", content: "b".repeat(400), tag: "running_summary", priority: 80 },
			{ role: "system", content: "c".repeat(400), tag: "retrieved_context", priority: 70 },
			{ role: "user", content: "d".repeat(40), tag: "user_input", priority: 1000 },
		];
		// Total tokens ≈ 100+100+100+10 = 310, budget = 250
		const result = applyTokenBudget(blocks, 250);
		// Should trim retrieved_context first (priority 70)
		expect(result.trimmedTags).toContain("retrieved_context");
		expect(result.messages.some((m) => m.content.startsWith("c"))).toBe(false);
	});

	it("never removes user_input even if over budget", () => {
		const blocks: PromptBlock[] = [
			{ role: "user", content: "a".repeat(10000), tag: "user_input", priority: 1000 },
		];
		const result = applyTokenBudget(blocks, 10);
		expect(result.messages.length).toBe(1);
		expect(result.trimmedTags).toEqual([]);
	});

	it("trims multiple blocks if needed", () => {
		const blocks: PromptBlock[] = [
			{ role: "system", content: "a".repeat(400), tag: "system_prompt", priority: 100 },
			{ role: "system", content: "b".repeat(400), tag: "structured_memory", priority: 85 },
			{ role: "system", content: "c".repeat(400), tag: "running_summary", priority: 80 },
			{ role: "system", content: "d".repeat(400), tag: "retrieved_context", priority: 70 },
			{ role: "user", content: "e".repeat(40), tag: "user_input", priority: 1000 },
		];
		// budget = 120 tokens ≈ 480 chars — only room for system_prompt + user_input
		const result = applyTokenBudget(blocks, 120);
		expect(result.trimmedTags).toContain("retrieved_context");
		expect(result.trimmedTags).toContain("running_summary");
		expect(result.trimmedTags).toContain("structured_memory");
		expect(result.messages[0].content).toContain("a".repeat(400));
	});
});

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
	const baseInput: PromptBuildInput = {
		recentTurns: [
			{ role: "user", content: "hello" },
		],
		inputBudget: 100000,
	};

	it("includes system prompt as first message when provided", () => {
		const result = buildPrompt({
			...baseInput,
			systemPrompt: "You are an AI.",
		});
		expect(result.messages[0].role).toBe("system");
		expect(result.messages[0].content).toBe("You are an AI.");
	});

	it("places blocks in correct order: system → memory → summary → context → turns", () => {
		const result = buildPrompt({
			...baseInput,
			systemPrompt: "sys",
			structuredMemories: ["- pref1", "- pref2"],
			runningSummary: "summary text",
			retrievedChunks: ["chunk1", "chunk2"],
			recentTurns: [
				{ role: "user", content: "q1" },
				{ role: "assistant", content: "a1" },
				{ role: "user", content: "q2" },
			],
		});

		const contents = result.messages.map((m) => m.content);
		expect(contents[0]).toBe("sys");
		expect(contents[1]).toContain("【长期记忆】");
		expect(contents[2]).toContain("【对话摘要】");
		expect(contents[3]).toContain("【相关上下文】");
		expect(contents[4]).toBe("q1");
		expect(contents[5]).toBe("a1");
		expect(contents[6]).toBe("q2");
	});

	it("deduplicates retrieved chunks", () => {
		const result = buildPrompt({
			...baseInput,
			retrievedChunks: ["dup", "dup", "unique"],
		});
		const ctxMsg = result.messages.find((m) =>
			m.content.includes("【相关上下文】"),
		);
		expect(ctxMsg).toBeDefined();
		// Should contain "dup" once and "unique" once
		const matches = ctxMsg!.content.match(/dup/g);
		expect(matches?.length).toBe(1);
	});

	it("limits retrieved chunks to 8", () => {
		const chunks = Array.from({ length: 15 }, (_, i) => `chunk-${i}`);
		const result = buildPrompt({
			...baseInput,
			retrievedChunks: chunks,
		});
		const ctxMsg = result.messages.find((m) =>
			m.content.includes("【相关上下文】"),
		);
		expect(ctxMsg).toBeDefined();
		// Should have exactly 8 numbered entries
		const numbered = ctxMsg!.content.match(/\(\d+\)/g);
		expect(numbered?.length).toBe(8);
	});

	it("works with no optional fields", () => {
		const result = buildPrompt(baseInput);
		expect(result.messages.length).toBe(1);
		expect(result.messages[0].content).toBe("hello");
		expect(result.trimmedTags).toEqual([]);
	});

	it("trims low-priority blocks when budget is tight", () => {
		const result = buildPrompt({
			systemPrompt: "short system",
			runningSummary: "a".repeat(2000),
			retrievedChunks: ["b".repeat(2000)],
			recentTurns: [{ role: "user", content: "question" }],
			inputBudget: 100, // very tight
		});
		// Should have trimmed some blocks
		expect(result.trimmedTags.length).toBeGreaterThan(0);
		// user_input must survive
		expect(result.messages.some((m) => m.content === "question")).toBe(true);
	});

	it("gives the last recent turn the user_input tag with highest priority", () => {
		const result = buildPrompt({
			...baseInput,
			systemPrompt: "a".repeat(10000),
			runningSummary: "b".repeat(10000),
			recentTurns: [
				{ role: "user", content: "old" },
				{ role: "assistant", content: "reply" },
				{ role: "user", content: "current" },
			],
			inputBudget: 100,
		});
		// "current" must always survive
		expect(result.messages.some((m) => m.content === "current")).toBe(true);
	});
});

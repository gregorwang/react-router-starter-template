/**
 * Prompt Builder — the core context assembly engine.
 *
 * Replaces the old `buildRequestMessages()` with a prioritised,
 * budget-aware, cache-friendly prompt construction system.
 *
 * ## Design principles
 *
 * 1. **Stable prefix** — system prompt + structured memory are placed
 *    first and change infrequently, improving Prompt Caching hit rate.
 * 2. **Priority-based trimming** — when the token budget is exceeded,
 *    lower-priority blocks are dropped first while user input is always
 *    kept.
 * 3. **Lost-in-the-middle mitigation** — critical information lives at
 *    the beginning (system prompt, memories) and end (user input) of
 *    the prompt.
 */

import type { LLMMessage } from "../llm/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptBlock {
	role: "system" | "user" | "assistant";
	content: string;
	/** Debugging / logging label. */
	tag: string;
	/**
	 * Higher priority = less likely to be trimmed.
	 * The `user_input` block should always have the highest priority.
	 */
	priority: number;
	/** Preserve this block even when trimming aggressively. */
	preserve?: boolean;
}

export interface PromptBuildInput {
	/** Fixed system instruction (stable prefix, great for caching). */
	systemPrompt?: string;
	/** L1 running summary text. */
	runningSummary?: string;
	/** L2 structured memory items — pre-formatted text lines. */
	structuredMemories?: string[];
	/** L3 retrieved chunks from vector search. */
	retrievedChunks?: string[];
	/** L0 recent conversation turns (high fidelity). */
	recentTurns: LLMMessage[];
	/** Minimum number of latest turns to keep when trimming. */
	minRecentTurnsToKeep?: number;
	/** Maximum tokens available for input (ctxMax − outReserve). */
	inputBudget: number;
}

export interface PromptBuildResult {
	/** Final messages array to send to the LLM. */
	messages: LLMMessage[];
	/** Tags of blocks that were trimmed to fit the budget. */
	trimmedTags: string[];
	/** Estimated total input tokens. */
	estimatedTokens: number;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Rough token estimation.  1 CJK character ≈ 1–2 tokens, 1 Latin
 * word ≈ 1–1.3 tokens.  Using chars/4 as a rough baseline is common
 * in the ecosystem (matches existing project convention).
 */
export function estimateTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

function estimateBlockTokens(blocks: PromptBlock[]): number {
	return blocks.reduce((sum, b) => sum + estimateTokens(b.content), 0);
}

// ---------------------------------------------------------------------------
// Core builder
// ---------------------------------------------------------------------------

export function buildPrompt(input: PromptBuildInput): PromptBuildResult {
	const blocks: PromptBlock[] = [];

	// ① Fixed prefix — system prompt (stable, cacheable)
	if (input.systemPrompt) {
		blocks.push({
			role: "system",
			content: input.systemPrompt,
			tag: "system_prompt",
			priority: 100,
			preserve: true,
		});
	}

	// ② Structured memories (semi-fixed, low change frequency)
	if (input.structuredMemories && input.structuredMemories.length > 0) {
		const memText = input.structuredMemories.join("\n");
		blocks.push({
			role: "system",
			content: `【长期记忆】\n${memText}`,
			tag: "structured_memory",
			priority: 85,
		});
	}

	// ③ Running summary (semi-fixed, patched each turn)
	if (input.runningSummary) {
		blocks.push({
			role: "system",
			content: `【对话摘要】\n${input.runningSummary}`,
			tag: "running_summary",
			priority: 80,
		});
	}

	// ④ Retrieved chunks / evidence (dynamic)
	if (input.retrievedChunks && input.retrievedChunks.length > 0) {
		const deduped = [...new Set(input.retrievedChunks)].slice(0, 8);
		const chunkText = deduped
			.map((c, i) => `(${i + 1}) ${c}`)
			.join("\n\n");
		blocks.push({
			role: "system",
			content: `【相关上下文】\n${chunkText}`,
			tag: "retrieved_context",
			priority: 70,
		});
	}

	// ⑤ Recent turns — preserve original role, ordered from oldest to newest
	// Priority decreases for older turns so they are trimmed first.
	const turnCount = input.recentTurns.length;
	const protectedRecentTurns = Math.max(
		0,
		Math.min(input.minRecentTurnsToKeep ?? 1, turnCount) - 1,
	);
	for (let i = 0; i < turnCount; i++) {
		const turn = input.recentTurns[i];
		// Last turn gets priority 65, earlier turns get progressively less
		const turnPriority = 50 + Math.floor((15 * (i + 1)) / turnCount);
		const isUserInput = i === turnCount - 1;
		const isProtectedRecentTurn =
			!isUserInput && i >= turnCount - 1 - protectedRecentTurns;
		blocks.push({
			role: turn.role as "user" | "assistant" | "system",
			content: turn.content,
			tag: isUserInput ? "user_input" : "recent_turn",
			// The very last message (current user input) gets max priority
			priority: isUserInput ? 1000 : turnPriority,
			preserve: isProtectedRecentTurn,
		});
	}

	// Apply token budget
	return applyTokenBudget(blocks, input.inputBudget);
}

// ---------------------------------------------------------------------------
// Budget trimming
// ---------------------------------------------------------------------------

export function applyTokenBudget(
	blocks: PromptBlock[],
	budget: number,
): PromptBuildResult {
	// Work on a mutable copy with original indices
	const indexed = blocks.map((b, i) => ({ ...b, originalIndex: i }));
	let currentTokens = estimateBlockTokens(indexed);
	const trimmedTags: string[] = [];

	// Sort candidates for removal: lowest priority first.
	// Never remove user_input.
	while (currentTokens > budget) {
		const removable = indexed
			.filter((b) => b.tag !== "user_input" && b.preserve !== true)
			.sort((a, b) => a.priority - b.priority);

		if (removable.length === 0) break;

		const victim = removable[0];
		trimmedTags.push(victim.tag);
		currentTokens -= estimateTokens(victim.content);
		const victimIdx = indexed.indexOf(victim);
		if (victimIdx !== -1) {
			indexed.splice(victimIdx, 1);
		}
	}

	// If we're still over budget, the user_input itself is too big.
	// We keep it anyway — the LLM will truncate or error.

	const messages: LLMMessage[] = indexed.map((b) => ({
		role: b.role as LLMMessage["role"],
		content: b.content,
	}));

	return {
		messages,
		trimmedTags,
		estimatedTokens: currentTokens,
	};
}

import { describe, expect, it } from "vitest";
import type { Conversation } from "../llm/types";
import {
	DEFAULT_OUTPUT_TOKENS,
	buildConversationSessionBootstrap,
	bootstrapStateToPersistedState,
	mergeConversationSessionState,
	sanitizeConversationSessionPatch,
} from "./chat-session-state.shared";

function buildConversation(overrides: Partial<Conversation> = {}): Conversation {
	return {
		id: "conv-1",
		title: "新对话",
		messages: [],
		provider: "xai",
		model: "grok-4-1-fast-reasoning",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe("chat-session-state.shared", () => {
	it("applies provider defaults for xai conversation bootstrap", () => {
		const bootstrap = buildConversationSessionBootstrap(
			buildConversation({
				provider: "xai",
				webSearch: undefined,
				xaiSearchMode: undefined,
			}),
			"user-1",
		);
		expect(bootstrap.webSearch).toBe(true);
		expect(bootstrap.xaiSearchMode).toBe("x");
	});

	it("applies provider defaults for poloai output settings", () => {
		const bootstrap = buildConversationSessionBootstrap(
			buildConversation({
				provider: "poloai",
				model: "claude-sonnet-4-5-20250929-thinking",
				outputTokens: undefined,
				enableTools: undefined,
			}),
			"user-1",
		);
		expect(bootstrap.outputTokens).toBe(DEFAULT_OUTPUT_TOKENS);
		expect(bootstrap.enableTools).toBe(true);
	});

	it("sanitizes numeric patches", () => {
		const patch = sanitizeConversationSessionPatch({
			outputTokens: 999999,
			thinkingBudget: -10,
		});
		expect(patch.outputTokens).toBe(32768);
		expect(patch.thinkingBudget).toBe(1024);
	});

	it("clears summary fields when clearSummary is true", () => {
		const base = bootstrapStateToPersistedState(
			buildConversationSessionBootstrap(
				buildConversation({
					summary: "old summary",
					summaryUpdatedAt: 100,
					summaryMessageCount: 8,
				}),
				"user-1",
			),
		);
		const next = mergeConversationSessionState(base, { clearSummary: true }, 200);
		expect(next.summary).toBeUndefined();
		expect(next.summaryUpdatedAt).toBeUndefined();
		expect(next.summaryMessageCount).toBeUndefined();
		expect(next.version).toBe(base.version + 1);
	});

	it("does not bump version for empty patch", () => {
		const base = bootstrapStateToPersistedState(
			buildConversationSessionBootstrap(buildConversation(), "user-1"),
		);
		const next = mergeConversationSessionState(base, {}, Date.now());
		expect(next.version).toBe(base.version);
	});
});


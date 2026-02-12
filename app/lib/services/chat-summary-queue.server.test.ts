import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../llm/types";
import {
	createChatSummaryQueueJob,
	isChatSummaryQueueJob,
	processChatSummaryQueueJob,
} from "./chat-summary-queue.server";

const {
	getConversationMock,
	updateConversationSummaryMock,
	summarizeConversationMock,
	resolveConversationSessionStateMock,
	applyConversationSessionStateMock,
	invalidateConversationCachesMock,
} = vi.hoisted(() => ({
	getConversationMock: vi.fn(),
	updateConversationSummaryMock: vi.fn(),
	summarizeConversationMock: vi.fn(),
	resolveConversationSessionStateMock: vi.fn(),
	applyConversationSessionStateMock: vi.fn(),
	invalidateConversationCachesMock: vi.fn(),
}));

vi.mock("../db/conversations.server", () => ({
	getConversation: getConversationMock,
	updateConversationSummary: updateConversationSummaryMock,
}));

vi.mock("../llm/summary.server", () => ({
	summarizeConversation: summarizeConversationMock,
}));

vi.mock("./chat-session-state.server", () => ({
	resolveConversationSessionState: resolveConversationSessionStateMock,
	applyConversationSessionState: applyConversationSessionStateMock,
}));

vi.mock("../cache/conversation-index.server", () => ({
	invalidateConversationCaches: invalidateConversationCachesMock,
}));

function buildConversation(overrides: Partial<Conversation> = {}): Conversation {
	return {
		id: "conv-1",
		userId: "user-1",
		projectId: "project-1",
		title: "新对话",
		provider: "poe",
		model: "grok-4.1-fast-reasoning",
		messages: [],
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe("chat-summary-queue.server", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resolveConversationSessionStateMock.mockResolvedValue({});
		applyConversationSessionStateMock.mockImplementation((conversation) => conversation);
	});

	it("creates and validates queue jobs", () => {
		const job = createChatSummaryQueueJob({
			userId: " user-1 ",
			conversationId: " conv-1 ",
			assistantMessageId: " a-1 ",
			enqueuedAt: 123,
		});

		expect(job).toEqual({
			type: "chat_summary",
			userId: "user-1",
			conversationId: "conv-1",
			assistantMessageId: "a-1",
			enqueuedAt: 123,
		});
		expect(isChatSummaryQueueJob(job)).toBe(true);
		expect(isChatSummaryQueueJob({ type: "chat_summary", userId: "" })).toBe(false);
	});

	it("returns up_to_date when summary already covers active messages", async () => {
		getConversationMock.mockResolvedValue(
			buildConversation({
				summary: "existing",
				summaryMessageCount: 2,
				messages: [
					{ id: "u-1", role: "user", content: "u1", timestamp: 1 },
					{ id: "a-1", role: "assistant", content: "a1", timestamp: 2 },
				],
			}),
		);

		const result = await processChatSummaryQueueJob({
			env: {} as Env,
			db: {} as D1Database,
			job: createChatSummaryQueueJob({
				userId: "user-1",
				conversationId: "conv-1",
				assistantMessageId: "a-1",
				enqueuedAt: 1,
			}),
		});

		expect(result).toEqual({ status: "up_to_date" });
		expect(summarizeConversationMock).not.toHaveBeenCalled();
		expect(updateConversationSummaryMock).not.toHaveBeenCalled();
	});

	it("updates summary in D1 and patches DO state when new turns exist", async () => {
		getConversationMock.mockResolvedValue(
			buildConversation({
				summary: "existing",
				summaryMessageCount: 1,
				messages: [
					{ id: "u-1", role: "user", content: "u1", timestamp: 1 },
					{ id: "a-1", role: "assistant", content: "a1", timestamp: 2 },
					{ id: "u-2", role: "user", content: "u2", timestamp: 3 },
					{ id: "a-2", role: "assistant", content: "a2", timestamp: 4 },
				],
			}),
		);
		summarizeConversationMock.mockResolvedValue("next summary");

		const result = await processChatSummaryQueueJob({
			env: {} as Env,
			db: {} as D1Database,
			job: createChatSummaryQueueJob({
				userId: "user-1",
				conversationId: "conv-1",
				assistantMessageId: "a-2",
				enqueuedAt: 1,
			}),
		});

		expect(result.status).toBe("updated");
		expect(updateConversationSummaryMock).toHaveBeenCalledTimes(1);
		expect(resolveConversationSessionStateMock).toHaveBeenCalledTimes(2);
		expect(resolveConversationSessionStateMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				patch: expect.objectContaining({
					summary: "next summary",
					summaryMessageCount: 4,
				}),
			}),
		);
	});
});

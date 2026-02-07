import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireAuth: vi.fn(),
	createConversationShareLink: vi.fn(),
}));

vi.mock("../lib/auth.server", () => ({
	requireAuth: mocks.requireAuth,
}));

vi.mock("../lib/services/conversation-share.server", async () => {
	const actual = await vi.importActual<
		typeof import("../lib/services/conversation-share.server")
	>("../lib/services/conversation-share.server");

	return {
		...actual,
		createConversationShareLink: mocks.createConversationShareLink,
	};
});

import { action } from "./conversations.share";

describe("conversations.share action", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireAuth.mockResolvedValue({ id: "user-1" });
		mocks.createConversationShareLink.mockResolvedValue(
			Response.json({ ok: true }),
		);
	});

	it("rejects non-POST methods", async () => {
		const response = await action({
			request: new Request("https://example.com/conversations/share", {
				method: "GET",
			}),
			context: { db: {} },
		} as any);

		expect(response.status).toBe(405);
	});

	it("returns 400 when conversationId is missing", async () => {
		const response = await action({
			request: new Request("https://example.com/conversations/share", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}),
			context: { db: {} },
		} as any);

		expect(response.status).toBe(400);
		expect(mocks.createConversationShareLink).not.toHaveBeenCalled();
	});

	it("parses JSON payload and delegates to service", async () => {
		await action({
			request: new Request("https://example.com/conversations/share", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					conversationId: "conv-1",
				}),
			}),
			context: { db: { id: "db" } },
		} as any);

		expect(mocks.createConversationShareLink).toHaveBeenCalledTimes(1);
		expect(mocks.createConversationShareLink).toHaveBeenCalledWith({
			db: { id: "db" },
			userId: "user-1",
			origin: "https://example.com",
			conversationId: "conv-1",
		});
	});

	it("parses form payload and delegates to service", async () => {
		const formData = new FormData();
		formData.set("conversationId", "conv-2");

		await action({
			request: new Request("https://example.com/conversations/share", {
				method: "POST",
				body: formData,
			}),
			context: { db: { id: "db-2" } },
		} as any);

		expect(mocks.createConversationShareLink).toHaveBeenCalledWith({
			db: { id: "db-2" },
			userId: "user-1",
			origin: "https://example.com",
			conversationId: "conv-2",
		});
	});
});

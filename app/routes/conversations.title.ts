import type { Route } from "./+types/conversations.title";
import {
	getConversation,
	updateConversationTitle,
} from "../lib/db/conversations.server";
import { generateConversationTitle } from "../lib/llm/title.server";
import { invalidateConversationCaches } from "../lib/cache/conversation-index.server";
import { requireAuth } from "../lib/auth.server";
import {
	getMessagesInActiveContext,
	isChatTurnMessage,
} from "../lib/chat/context-boundary";

type TitlePayload = {
	conversationId?: string;
	messages?: Array<{
		role: string;
		content: string;
		meta?: { event?: { type?: string } };
	}>;
	force?: boolean;
};

const DEFAULT_TITLES = new Set(["新对话", "New Chat", ""]);

function trimMessages(messages: Array<{ role: string; content: string }>) {
	return messages
		.filter((msg) => msg?.content && typeof msg.content === "string")
		.slice(0, 4)
		.map((msg) => ({
			role: msg.role,
			content: msg.content.length > 2000 ? msg.content.slice(0, 2000) : msg.content,
		}));
}

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	let payload: TitlePayload = {};
	if (request.headers.get("Content-Type")?.includes("application/json")) {
		try {
			payload = (await request.json()) as TitlePayload;
		} catch {
			return new Response("Invalid JSON", { status: 400 });
		}
	} else {
		const formData = await request.formData();
		payload.conversationId = (formData.get("conversationId") as string | null) || undefined;
	}

	const conversationId = payload.conversationId?.trim();
	if (!conversationId) {
		return new Response("Missing conversationId", { status: 400 });
	}

	const conversation = await getConversation(context.db, user.id, conversationId);
	if (!conversation) {
		return new Response("Conversation not found", { status: 404 });
	}

	const currentTitle = (conversation.title || "").trim();
	const shouldSkip =
		!payload.force && currentTitle && !DEFAULT_TITLES.has(currentTitle);
	if (shouldSkip) {
		return new Response(
			JSON.stringify({ title: currentTitle, skipped: true }),
			{ headers: { "Content-Type": "application/json" } },
		);
	}

	const messagesSource =
		payload.messages && payload.messages.length > 0
			? payload.messages
			: conversation.messages;
	const activeMessages = getMessagesInActiveContext(messagesSource);
	const messages = trimMessages(activeMessages.filter(isChatTurnMessage));
	if (messages.length === 0) {
		return new Response("Missing messages", { status: 400 });
	}

	try {
		const title = await generateConversationTitle({
			env: context.cloudflare.env,
			messages,
		});
		if (!title) {
			return new Response("Failed to generate title", { status: 500 });
		}

		const updatedAt = Date.now();
		await updateConversationTitle(context.db, user.id, conversationId, title, updatedAt);
		if (context.cloudflare.env.SETTINGS_KV) {
			await invalidateConversationCaches(
				context.cloudflare.env.SETTINGS_KV,
				user.id,
				conversation.projectId,
			);
		}

		return new Response(
			JSON.stringify({ title, updatedAt }),
			{ headers: { "Content-Type": "application/json" } },
		);
	} catch (error) {
		console.error("Conversation title error:", error);
		return new Response(
			JSON.stringify({
				error: error instanceof Error ? error.message : "Unknown error",
			}),
			{ status: 500, headers: { "Content-Type": "application/json" } },
		);
	}
}

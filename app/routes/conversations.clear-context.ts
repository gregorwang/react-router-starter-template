import type { Route } from "./+types/conversations.clear-context";
import { invalidateConversationCaches } from "../lib/cache/conversation-index.server";
import {
	appendConversationMessages,
	getConversation,
} from "../lib/db/conversations.server";
import { createContextClearedEventMessage } from "../lib/chat/context-boundary";
import { requireAuth } from "../lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	let conversationId: string | null = null;
	const contentType = request.headers.get("Content-Type") || "";
	if (contentType.includes("application/json")) {
		const body = (await request.json()) as { conversationId?: string };
		conversationId = body.conversationId?.trim() || null;
	} else {
		const formData = await request.formData();
		conversationId = (formData.get("conversationId") as string | null)?.trim() || null;
	}

	if (!conversationId) {
		return new Response("Missing conversationId", { status: 400 });
	}

	const conversation = await getConversation(context.db, user.id, conversationId);
	if (!conversation) {
		return new Response("Conversation not found", { status: 404 });
	}

	const clearedAt = Date.now();
	const marker = createContextClearedEventMessage(clearedAt);
	await appendConversationMessages(
		context.db,
		user.id,
		conversationId,
		{
			updatedAt: clearedAt,
			resetSummary: true,
		},
		[marker],
	);

	if (context.cloudflare.env.SETTINGS_KV) {
		await invalidateConversationCaches(
			context.cloudflare.env.SETTINGS_KV,
			user.id,
			conversation.projectId,
		);
	}

	return Response.json(
		{ ok: true, message: marker, clearedAt },
		{ headers: { "Cache-Control": "no-store" } },
	);
}

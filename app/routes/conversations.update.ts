import type { Route } from "./+types/conversations.update";
import { requireAuth } from "../lib/auth.server";
import {
	getConversation,
	updateConversationMetadata,
} from "../lib/db/conversations.server";
import { invalidateConversationCaches } from "../lib/cache/conversation-index.server";

type UpdateAction = "rename" | "archive" | "unarchive" | "pin" | "unpin";

type UpdatePayload = {
	conversationId?: string;
	action?: UpdateAction;
	title?: string;
};

const MAX_TITLE_LENGTH = 120;

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	if (request.method !== "POST" && request.method !== "PATCH") {
		return new Response("Method not allowed", { status: 405 });
	}

	let payload: UpdatePayload = {};
	const contentType = request.headers.get("Content-Type") || "";
	if (contentType.includes("application/json")) {
		try {
			payload = (await request.json()) as UpdatePayload;
		} catch {
			return new Response("Invalid JSON", { status: 400 });
		}
	} else {
		const formData = await request.formData();
		payload.conversationId =
			(formData.get("conversationId") as string | null) || undefined;
		payload.action = (formData.get("action") as UpdateAction | null) || undefined;
		payload.title = (formData.get("title") as string | null) || undefined;
	}

	const conversationId = payload.conversationId?.trim();
	const action = payload.action;
	if (!conversationId || !action) {
		return new Response("Missing conversationId or action", { status: 400 });
	}

	const conversation = await getConversation(context.db, user.id, conversationId);
	if (!conversation) {
		return new Response("Conversation not found", { status: 404 });
	}

	const updatedAt = Date.now();
	let nextTitle: string | undefined;
	let isArchived: boolean | undefined;
	let isPinned: boolean | undefined;

	if (action === "rename") {
		const title = payload.title?.trim();
		if (!title) return new Response("Missing title", { status: 400 });
		nextTitle = title.slice(0, MAX_TITLE_LENGTH);
	}
	if (action === "archive") {
		isArchived = true;
		isPinned = false;
	}
	if (action === "unarchive") {
		isArchived = false;
	}
	if (action === "pin") {
		isPinned = true;
		isArchived = false;
	}
	if (action === "unpin") {
		isPinned = false;
	}

	await updateConversationMetadata(context.db, user.id, conversationId, {
		title: nextTitle,
		isArchived,
		isPinned,
		updatedAt,
	});

	if (context.cloudflare.env.SETTINGS_KV) {
		await invalidateConversationCaches(
			context.cloudflare.env.SETTINGS_KV,
			user.id,
			conversation.projectId,
		);
	}

	return Response.json(
		{
			ok: true,
			conversationId,
			title: nextTitle ?? conversation.title,
			isArchived: isArchived ?? conversation.isArchived ?? false,
			isPinned: isPinned ?? conversation.isPinned ?? false,
			updatedAt,
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

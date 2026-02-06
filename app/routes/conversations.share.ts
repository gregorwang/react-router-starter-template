import type { Route } from "./+types/conversations.share";
import { requireAuth } from "../lib/auth.server";
import { createOrGetConversationShareToken } from "../lib/db/share-links.server";

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

	const token = await createOrGetConversationShareToken(context.db, user.id, conversationId);
	if (!token) {
		return new Response("Conversation not found", { status: 404 });
	}

	const url = new URL(request.url);
	const shareUrl = `${url.origin}/s/${token}`;
	return Response.json(
		{ ok: true, url: shareUrl },
		{ headers: { "Cache-Control": "no-store" } },
	);
}

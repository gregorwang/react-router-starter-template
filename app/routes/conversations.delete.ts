import type { Route } from "./+types/conversations.delete";
import { deleteConversation } from "../lib/db/conversations.server";
import { invalidateConversationCaches } from "../lib/cache/conversation-index.server";
import { redirect } from "react-router";
import { requireAuth } from "../lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	if (request.method !== "POST" && request.method !== "DELETE") {
		return new Response("Method not allowed", { status: 405 });
	}

	let conversationId: string | null = null;
	let projectId: string | null = null;
	const contentType = request.headers.get("Content-Type") || "";
	const expectsJson = contentType.includes("application/json");
	if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
		const formData = await request.formData();
		conversationId = (formData.get("conversationId") as string | null) || null;
		projectId = (formData.get("projectId") as string | null) || null;
	} else if (expectsJson) {
		const body = (await request.json()) as {
			conversationId?: string;
			projectId?: string;
		};
		conversationId = body.conversationId?.trim() || null;
		projectId = body.projectId?.trim() || null;
	} else {
		const url = new URL(request.url);
		conversationId = url.searchParams.get("conversationId");
		projectId = url.searchParams.get("projectId");
	}

	if (!conversationId) {
		return new Response("Conversation ID is required", { status: 400 });
	}

	await deleteConversation(context.db, user.id, conversationId);
	if (context.cloudflare.env.SETTINGS_KV && projectId) {
		await invalidateConversationCaches(
			context.cloudflare.env.SETTINGS_KV,
			user.id,
			projectId,
		);
	}

	if (expectsJson) {
		return Response.json(
			{
				ok: true,
				conversationId,
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	}

	return redirect(projectId ? `/c/new?project=${projectId}` : "/c/new");
}

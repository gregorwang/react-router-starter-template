import type { Route } from "./+types/conversations.share";
import { requireAuth } from "../lib/auth.server";
import {
	createConversationShareLink,
} from "../lib/services/conversation-share.server";

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

	const url = new URL(request.url);
	return createConversationShareLink({
		db: context.db,
		userId: user.id,
		origin: url.origin,
		conversationId,
	});
}

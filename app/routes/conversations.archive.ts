import type { Route } from "./+types/conversations.archive";
import { getConversation } from "../lib/db/conversations.server";

export async function action({ request, context }: Route.ActionArgs) {
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	const env = context.cloudflare.env;
	if (!env.CHAT_ARCHIVE) {
		return new Response("R2 binding not configured", { status: 500 });
	}

	const formData = await request.formData();
	const conversationId = formData.get("conversationId") as string | null;
	if (!conversationId) {
		return new Response("Missing conversationId", { status: 400 });
	}

	const conversation = await getConversation(context.db, conversationId);
	if (!conversation) {
		return new Response("Conversation not found", { status: 404 });
	}

	const key = `conversations/${conversationId}.json`;
	const body = JSON.stringify(conversation, null, 2);
	await env.CHAT_ARCHIVE.put(key, body, {
		httpMetadata: { contentType: "application/json" },
	});

	return Response.json({ ok: true, key });
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	if (!env.CHAT_ARCHIVE) {
		return new Response("R2 binding not configured", { status: 500 });
	}

	const url = new URL(request.url);
	const key = url.searchParams.get("key");
	const conversationId = url.searchParams.get("conversationId");
	const download = url.searchParams.get("download");
	const resolvedKey = key || (conversationId ? `conversations/${conversationId}.json` : null);

	if (!resolvedKey) {
		return new Response("Missing key", { status: 400 });
	}

	const object = await env.CHAT_ARCHIVE.get(resolvedKey);
	if (!object) {
		return new Response("Not found", { status: 404 });
	}

	const headers = new Headers();
	if (object.httpMetadata?.contentType) {
		headers.set("Content-Type", object.httpMetadata.contentType);
	} else {
		headers.set("Content-Type", "application/json");
	}
	if (download === "1") {
		const filename =
			conversationId ? `conversation-${conversationId}.json` : "conversation.json";
		headers.set("Content-Disposition", `attachment; filename="${filename}"`);
	}

	return new Response(object.body, {
		headers,
	});
}

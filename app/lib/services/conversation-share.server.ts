import {
	createOrGetConversationShareToken,
} from "../db/share-links.server";

export type ConversationShareDeps = {
	createOrGetConversationShareToken: typeof createOrGetConversationShareToken;
};

const defaultDeps: ConversationShareDeps = {
	createOrGetConversationShareToken,
};

export type CreateConversationShareInput = {
	db: D1Database;
	userId: string;
	origin: string;
	conversationId: string;
};

export async function createConversationShareLink(
	input: CreateConversationShareInput,
	deps: ConversationShareDeps = defaultDeps,
) {
	const share = await deps.createOrGetConversationShareToken(
		input.db,
		input.userId,
		input.conversationId,
	);
	if (!share?.token) {
		return new Response("Conversation not found", { status: 404 });
	}

	const shareUrl = `${input.origin}/s/${share.token}`;
	return jsonNoStore({
		ok: true,
		url: shareUrl,
	});
}

function jsonNoStore(payload: unknown) {
	return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
}

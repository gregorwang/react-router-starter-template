import type { Route } from "./+types/media.$key";
import { getCurrentUser } from "../lib/auth.server";
import { canAccessSharedConversation } from "../lib/db/share-links.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const key = params.key;

	if (!key) {
		return new Response("Not found", { status: 404 });
	}

	const bucket = context.cloudflare.env.CHAT_MEDIA;
	if (!bucket) {
		return new Response("R2 binding not configured", { status: 500 });
	}

	const user = await getCurrentUser(request, context.db);
	const shareToken = new URL(request.url).searchParams.get("token")?.trim();
	const canReadAsOwner = Boolean(
		user &&
			(key.startsWith(`att_${user.id}_`) || key.startsWith(`img_${user.id}_`)),
	);
	const canReadByShare =
		!canReadAsOwner &&
		Boolean(shareToken) &&
		(await canReadSharedAttachment(context.db, key, shareToken!));

	if (!canReadAsOwner && !canReadByShare) {
		return new Response("Not found", { status: 404 });
	}

	const object = await bucket.get(key);
	if (!object) {
		return new Response("Not found", { status: 404 });
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	if (!headers.get("Content-Type")) {
		headers.set("Content-Type", "application/octet-stream");
	}
	headers.set(
		"Cache-Control",
		canReadAsOwner ? "private, max-age=3600" : "public, max-age=300",
	);

	return new Response(object.body, { headers });
}

async function canReadSharedAttachment(
	db: D1Database,
	key: string,
	shareToken: string,
): Promise<boolean> {
	const parsed = parseAttachmentKey(key);
	if (!parsed) return false;
	return canAccessSharedConversation(
		db,
		shareToken,
		parsed.conversationId,
		parsed.userId,
	);
}

function parseAttachmentKey(key: string) {
	const match = key.match(/^att_([^_]+)_([^_]+)_[^/]+\.[A-Za-z0-9]+$/);
	if (!match) return null;
	return {
		userId: match[1],
		conversationId: match[2],
	};
}

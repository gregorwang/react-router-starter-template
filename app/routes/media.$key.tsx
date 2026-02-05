import type { Route } from "./+types/media.$key";
import { requireAuth } from "../lib/auth.server";

export async function loader({ request, context, params }: Route.LoaderArgs) {
	const user = await requireAuth(request, context.db);
	const key = params.key;

	if (!key) {
		return new Response("Not found", { status: 404 });
	}

	if (!key.startsWith(`img_${user.id}_`)) {
		return new Response("Not found", { status: 404 });
	}

	const bucket = context.cloudflare.env.CHAT_MEDIA;
	if (!bucket) {
		return new Response("R2 binding not configured", { status: 500 });
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
	headers.set("Cache-Control", "private, max-age=3600");

	return new Response(object.body, { headers });
}

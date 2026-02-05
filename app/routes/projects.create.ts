import type { Route } from "./+types/projects.create";
import { createProject, getProject } from "../lib/db/projects.server";
import { requireAuth } from "../lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	let name: string | null = null;
	let description: string | null = null;

	const contentType = request.headers.get("Content-Type") || "";
	if (contentType.includes("application/json")) {
		const body = (await request.json()) as { name?: string; description?: string };
		name = body.name?.trim() || null;
		description = body.description?.trim() || null;
	} else {
		const formData = await request.formData();
		name = (formData.get("name") as string | null)?.trim() || null;
		description = (formData.get("description") as string | null)?.trim() || null;
	}

	if (!name) {
		return new Response("Missing project name", { status: 400 });
	}

	const id = crypto.randomUUID();
	const now = Date.now();
	await createProject(context.db, {
		id,
		name,
		description: description || undefined,
		userId: user.id,
		createdAt: now,
		updatedAt: now,
	});

	const project = await getProject(context.db, id, user.id);
	return Response.json({ ok: true, project });
}

import type { Route } from "./+types/projects.update";
import { requireAuth } from "../lib/auth.server";
import { getProject, updateProjectMeta } from "../lib/db/projects.server";

const MAX_PROJECT_NAME = 60;
const MAX_PROJECT_DESCRIPTION = 240;

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	if (request.method !== "POST" && request.method !== "PATCH") {
		return new Response("Method not allowed", { status: 405 });
	}

	let projectId: string | null = null;
	let name: string | null = null;
	let description: string | null = null;
	let hasDescription = false;
	const contentType = request.headers.get("Content-Type") || "";
	if (contentType.includes("application/json")) {
		const body = (await request.json()) as {
			projectId?: string;
			name?: string;
			description?: string;
		};
		projectId = body.projectId?.trim() || null;
		name = body.name?.trim() || null;
		if (Object.prototype.hasOwnProperty.call(body, "description")) {
			hasDescription = true;
			description = body.description?.trim() || null;
		}
	} else {
		const formData = await request.formData();
		projectId = (formData.get("projectId") as string | null)?.trim() || null;
		name = (formData.get("name") as string | null)?.trim() || null;
		if (formData.has("description")) {
			hasDescription = true;
			description = (formData.get("description") as string | null)?.trim() || null;
		}
	}

	if (!projectId || !name) {
		return new Response("Missing projectId or name", { status: 400 });
	}

	const project = await getProject(context.db, projectId, user.id);
	if (!project) {
		return new Response("Project not found", { status: 404 });
	}

	const nextName = name.slice(0, MAX_PROJECT_NAME);
	const nextDescription = hasDescription
		? (description ? description.slice(0, MAX_PROJECT_DESCRIPTION) : null)
		: project.description ?? null;
	await updateProjectMeta(context.db, projectId, user.id, {
		name: nextName,
		description: nextDescription,
	});

	return Response.json(
		{
			ok: true,
			project: {
				...project,
				name: nextName,
				description: nextDescription ?? undefined,
				updatedAt: Date.now(),
			},
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

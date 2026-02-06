import type { Route } from "./+types/projects.delete";
import { requireAuth } from "../lib/auth.server";
import {
	deleteConversationsByProject,
	moveProjectConversations,
} from "../lib/db/conversations.server";
import { invalidateConversationCaches } from "../lib/cache/conversation-index.server";
import {
	deleteProject,
	ensureDefaultProject,
	getProject,
} from "../lib/db/projects.server";

type DeleteMode = "move_to_default" | "delete_with_chats";

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	if (request.method !== "POST" && request.method !== "DELETE") {
		return new Response("Method not allowed", { status: 405 });
	}

	let projectId: string | null = null;
	let mode: DeleteMode = "move_to_default";
	const contentType = request.headers.get("Content-Type") || "";
	if (contentType.includes("application/json")) {
		const body = (await request.json()) as {
			projectId?: string;
			mode?: DeleteMode;
		};
		projectId = body.projectId?.trim() || null;
		mode = body.mode || "move_to_default";
	} else {
		const formData = await request.formData();
		projectId = (formData.get("projectId") as string | null)?.trim() || null;
		mode = ((formData.get("mode") as DeleteMode | null) || "move_to_default");
	}

	if (!projectId) {
		return new Response("Missing projectId", { status: 400 });
	}

	const project = await getProject(context.db, projectId, user.id);
	if (!project) {
		return new Response("Project not found", { status: 404 });
	}
	if (project.isDefault) {
		return new Response("Default project cannot be deleted", { status: 400 });
	}

	const now = Date.now();
	const defaultProject = await ensureDefaultProject(context.db, user.id);
	if (mode === "delete_with_chats") {
		await deleteConversationsByProject(context.db, user.id, projectId);
	} else {
		await moveProjectConversations(
			context.db,
			user.id,
			projectId,
			defaultProject.id,
			now,
		);
	}
	await deleteProject(context.db, projectId, user.id);

	if (context.cloudflare.env.SETTINGS_KV) {
		await Promise.all([
			invalidateConversationCaches(context.cloudflare.env.SETTINGS_KV, user.id, projectId),
			invalidateConversationCaches(
				context.cloudflare.env.SETTINGS_KV,
				user.id,
				defaultProject.id,
			),
		]);
	}

	return Response.json(
		{
			ok: true,
			projectId,
			mode,
			fallbackProjectId: defaultProject.id,
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

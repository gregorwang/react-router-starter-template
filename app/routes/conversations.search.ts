import type { Route } from "./+types/conversations.search";
import { requireAuth } from "../lib/auth.server";
import { getProject } from "../lib/db/projects.server";
import { searchConversations } from "../lib/db/conversations.server";

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuth(request, context.db);
	const url = new URL(request.url);
	const query = (url.searchParams.get("q") || "").trim();
	const scope = (url.searchParams.get("scope") || "project").trim();
	const projectIdParam = (url.searchParams.get("projectId") || "").trim();
	const limit = Number(url.searchParams.get("limit") || 30);

	if (!query) {
		return Response.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
	}

	let scopedProjectId: string | undefined;
	if (scope !== "all" && projectIdParam) {
		const project = await getProject(context.db, projectIdParam, user.id);
		if (project) scopedProjectId = project.id;
	}

	const results = await searchConversations(context.db, {
		userId: user.id,
		query,
		projectId: scopedProjectId,
		limit: Number.isFinite(limit) ? limit : 30,
	});

	return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}

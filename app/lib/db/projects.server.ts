import type { Project } from "../llm/types";

export async function getProjects(db: D1Database): Promise<Project[]> {
	const { results } = await db
		.prepare("SELECT * FROM projects ORDER BY updated_at DESC")
		.all();

	return (results || []).map((row: any) => ({
		id: row.id,
		name: row.name,
		description: row.description ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}));
}

export async function getProject(db: D1Database, id: string): Promise<Project | null> {
	const { results } = await db
		.prepare("SELECT * FROM projects WHERE id = ?")
		.bind(id)
		.all();

	if (!results || results.length === 0) return null;
	const row = results[0] as any;
	return {
		id: row.id,
		name: row.name,
		description: row.description ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function createProject(
	db: D1Database,
	project: Project,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO projects (id, name, description, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)`
		)
		.bind(
			project.id,
			project.name,
			project.description ?? null,
			project.createdAt,
			project.updatedAt,
		)
		.run();
}

export async function ensureDefaultProject(db: D1Database): Promise<Project> {
	const existing = await getProject(db, "default");
	if (existing) {
		if (existing.name === "Default" || existing.name === "模型选择") {
			const now = Date.now();
			const updated: Project = {
				...existing,
				name: "默认项目",
				description: "默认工作区",
				updatedAt: now,
			};
			await db
				.prepare(
					"UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?",
				)
				.bind(
					updated.name,
					updated.description ?? null,
					updated.updatedAt,
					updated.id,
				)
				.run();
			return updated;
		}
		return existing;
	}

	const now = Date.now();
	const project: Project = {
		id: "default",
		name: "默认项目",
		description: "默认工作区",
		createdAt: now,
		updatedAt: now,
	};

	await createProject(db, project);
	return project;
}

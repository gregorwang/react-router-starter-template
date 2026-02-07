import type { Project } from "../llm/types";

export async function getProjects(
	db: D1Database,
	userId: string,
): Promise<Project[]> {
	const { results } = await db
		.prepare(
			"SELECT * FROM projects WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC",
		)
		.bind(userId)
		.all();

	if (!results || results.length === 0) {
		const fallback = await ensureDefaultProject(db, userId);
		return [fallback];
	}

	return (results || []).map((row: any) => ({
		id: row.id,
		name: row.name,
		description: row.description ?? undefined,
		userId: row.user_id,
		isDefault: Boolean(row.is_default),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}));
}

export async function getProject(
	db: D1Database,
	id: string,
	userId: string,
): Promise<Project | null> {
	const { results } = await db
		.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
		.bind(id, userId)
		.all();

	if (!results || results.length === 0) return null;
	const row = results[0] as any;
	return {
		id: row.id,
		name: row.name,
		description: row.description ?? undefined,
		userId: row.user_id,
		isDefault: Boolean(row.is_default),
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
			`INSERT INTO projects (id, user_id, name, description, is_default, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			project.id,
			project.userId,
			project.name,
			project.description ?? null,
			project.isDefault ? 1 : 0,
			project.createdAt,
			project.updatedAt,
		)
		.run();
}

export async function renameProject(
	db: D1Database,
	id: string,
	userId: string,
	name: string,
): Promise<void> {
	await db
		.prepare(
			`UPDATE projects
			SET name = ?, updated_at = ?
			WHERE id = ? AND user_id = ?`,
		)
		.bind(name, Date.now(), id, userId)
		.run();
}

export async function updateProjectMeta(
	db: D1Database,
	id: string,
	userId: string,
	input: { name: string; description: string | null },
): Promise<void> {
	await db
		.prepare(
			`UPDATE projects
			SET name = ?, description = ?, updated_at = ?
			WHERE id = ? AND user_id = ?`,
		)
		.bind(input.name, input.description, Date.now(), id, userId)
		.run();
}

export async function deleteProject(
	db: D1Database,
	id: string,
	userId: string,
): Promise<void> {
	await db
		.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?")
		.bind(id, userId)
		.run();
}

export async function ensureDefaultProject(
	db: D1Database,
	userId: string,
): Promise<Project> {
	const { results } = await db
		.prepare("SELECT * FROM projects WHERE user_id = ? AND is_default = 1 LIMIT 1")
		.bind(userId)
		.all();
	if (results && results.length > 0) {
		const row = results[0] as any;
		return {
			id: row.id,
			name: row.name,
			description: row.description ?? undefined,
			userId: row.user_id,
			isDefault: Boolean(row.is_default),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	const legacyDefault = await getProject(db, "default", userId);
	if (legacyDefault) {
		const normalized =
			legacyDefault.name === "Default" || legacyDefault.name === "模型选择"
				? "默认项目"
				: legacyDefault.name;
		const normalizedDescription =
			legacyDefault.name === "Default" || legacyDefault.name === "模型选择"
				? "默认工作区"
				: legacyDefault.description;
		const updatedAt = Date.now();
		await db
			.prepare(
				"UPDATE projects SET name = ?, description = ?, is_default = 1, updated_at = ? WHERE id = ? AND user_id = ?",
			)
			.bind(
				normalized,
				normalizedDescription ?? null,
				updatedAt,
				legacyDefault.id,
				userId,
			)
			.run();
		return {
			...legacyDefault,
			name: normalized,
			description: normalizedDescription ?? undefined,
			isDefault: true,
			updatedAt,
		};
	}

	const now = Date.now();
	const project: Project = {
		id: `default:${userId}`,
		userId,
		name: "默认项目",
		description: "默认工作区",
		isDefault: true,
		createdAt: now,
		updatedAt: now,
	};

	await createProject(db, project);
	return project;
}

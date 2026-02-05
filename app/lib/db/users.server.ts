import type { User, UserRole } from "../llm/types";

export interface DBUserRow {
	id: string;
	username: string;
	password_hash: string;
	role: UserRole;
	created_at: number;
	updated_at: number;
	last_login_at?: number | null;
}

export async function getUserById(
	db: D1Database,
	id: string,
): Promise<User | null> {
	const { results } = await db
		.prepare("SELECT * FROM users WHERE id = ?")
		.bind(id)
		.all<DBUserRow>();
	if (!results || results.length === 0) return null;
	return mapUser(results[0]);
}

export async function getUserByUsername(
	db: D1Database,
	username: string,
): Promise<(User & { passwordHash: string }) | null> {
	const { results } = await db
		.prepare("SELECT * FROM users WHERE username = ?")
		.bind(username)
		.all<DBUserRow>();
	if (!results || results.length === 0) return null;
	const row = results[0];
	return {
		...mapUser(row),
		passwordHash: row.password_hash,
	};
}

export async function listUsers(db: D1Database): Promise<User[]> {
	const { results } = await db
		.prepare("SELECT * FROM users ORDER BY created_at DESC")
		.all<DBUserRow>();
	return (results || []).map((row) => mapUser(row));
}

export async function createUser(
	db: D1Database,
	input: {
		username: string;
		passwordHash: string;
		role: UserRole;
	},
): Promise<User> {
	const now = Date.now();
	const user: User = {
		id: crypto.randomUUID(),
		username: input.username,
		role: input.role,
		createdAt: now,
		updatedAt: now,
	};

	await db
		.prepare(
			`INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			user.id,
			user.username,
			input.passwordHash,
			user.role,
			user.createdAt,
			user.updatedAt,
		)
		.run();

	return user;
}

export async function ensureAdminUser(
	db: D1Database,
	input: { username: string; passwordHash: string },
): Promise<User> {
	const existing = await getUserByUsername(db, input.username);
	if (existing) {
		const role = existing.role === "admin" ? existing.role : "admin";
		if (existing.role !== "admin") {
			await db
				.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?")
				.bind(Date.now(), existing.id)
				.run();
		}
		return {
			id: existing.id,
			username: existing.username,
			role,
			createdAt: existing.createdAt,
			updatedAt: existing.updatedAt,
			lastLoginAt: existing.lastLoginAt,
		};
	}

	return createUser(db, {
		username: input.username,
		passwordHash: input.passwordHash,
		role: "admin",
	});
}

export async function updateUserLastLogin(
	db: D1Database,
	userId: string,
): Promise<void> {
	await db
		.prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
		.bind(Date.now(), userId)
		.run();
}

function mapUser(row: DBUserRow): User {
	return {
		id: row.id,
		username: row.username,
		role: row.role,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastLoginAt: row.last_login_at ?? undefined,
	};
}

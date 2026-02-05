export interface Session {
	id: string;
	userId: string;
	createdAt: number;
	expiresAt: number;
}

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export async function createSession(
	db: D1Database,
	userId: string,
	ttlMs = DEFAULT_TTL_MS,
): Promise<Session> {
	const now = Date.now();
	const session: Session = {
		id: crypto.randomUUID(),
		userId,
		createdAt: now,
		expiresAt: now + ttlMs,
	};

	await db
		.prepare(
			`INSERT INTO sessions (id, user_id, created_at, expires_at)
			VALUES (?, ?, ?, ?)`,
		)
		.bind(session.id, session.userId, session.createdAt, session.expiresAt)
		.run();

	return session;
}

export async function getSession(
	db: D1Database,
	id: string,
): Promise<Session | null> {
	const { results } = await db
		.prepare("SELECT * FROM sessions WHERE id = ?")
		.bind(id)
		.all();

	if (!results || results.length === 0) {
		return null;
	}

	const row = results[0] as any;
	return {
		id: row.id,
		userId: row.user_id,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
	};
}

export async function deleteSession(db: D1Database, id: string): Promise<void> {
	await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
}

export async function deleteExpiredSessions(
	db: D1Database,
	now = Date.now(),
): Promise<void> {
	await db
		.prepare("DELETE FROM sessions WHERE expires_at <= ?")
		.bind(now)
		.run();
}

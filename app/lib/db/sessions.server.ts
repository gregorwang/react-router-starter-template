export interface Session {
	id: string;
	createdAt: number;
	expiresAt: number;
}

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export async function createSession(
	db: D1Database,
	ttlMs = DEFAULT_TTL_MS,
): Promise<Session> {
	const now = Date.now();
	const session: Session = {
		id: crypto.randomUUID(),
		createdAt: now,
		expiresAt: now + ttlMs,
	};

	await db
		.prepare(
			`INSERT INTO sessions (id, created_at, expires_at)
			VALUES (?, ?, ?)`,
		)
		.bind(session.id, session.createdAt, session.expiresAt)
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

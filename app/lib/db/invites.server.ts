export interface InviteCode {
	code: string;
	createdBy: string;
	createdAt: number;
	expiresAt: number;
	usedBy?: string;
	usedAt?: number;
}

export async function createInviteCode(
	db: D1Database,
	input: { code: string; createdBy: string; expiresAt: number },
): Promise<InviteCode> {
	const now = Date.now();
	await db
		.prepare(
			`INSERT INTO invite_codes (code, created_by, created_at, expires_at)
			VALUES (?, ?, ?, ?)`,
		)
		.bind(input.code, input.createdBy, now, input.expiresAt)
		.run();

	return {
		code: input.code,
		createdBy: input.createdBy,
		createdAt: now,
		expiresAt: input.expiresAt,
	};
}

export async function getInviteCode(
	db: D1Database,
	code: string,
): Promise<InviteCode | null> {
	const { results } = await db
		.prepare("SELECT * FROM invite_codes WHERE code = ?")
		.bind(code)
		.all();
	if (!results || results.length === 0) return null;
	return mapInvite(results[0] as any);
}

export async function listInviteCodes(db: D1Database): Promise<InviteCode[]> {
	const { results } = await db
		.prepare("SELECT * FROM invite_codes ORDER BY created_at DESC")
		.all();
	return (results || []).map((row: any) => mapInvite(row));
}

export async function markInviteUsed(
	db: D1Database,
	code: string,
	userId: string,
): Promise<boolean> {
	const now = Date.now();
	const result = await db
		.prepare(
			`UPDATE invite_codes
			SET used_by = ?, used_at = ?
			WHERE code = ? AND used_by IS NULL AND expires_at > ?`,
		)
		.bind(userId, now, code, now)
		.run();

	return Boolean(result.meta?.changes);
}

function mapInvite(row: any): InviteCode {
	return {
		code: row.code,
		createdBy: row.created_by,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		usedBy: row.used_by ?? undefined,
		usedAt: row.used_at ?? undefined,
	};
}

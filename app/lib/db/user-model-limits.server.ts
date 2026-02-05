export interface UserModelLimit {
	userId: string;
	provider: string;
	model: string;
	enabled: boolean;
	weeklyLimit?: number;
	monthlyLimit?: number;
	updatedAt: number;
}

export async function listUserModelLimits(
	db: D1Database,
	userId: string,
): Promise<UserModelLimit[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM user_model_limits
			WHERE user_id = ?
			ORDER BY provider, model`,
		)
		.bind(userId)
		.all();
	return (results || []).map((row: any) => mapLimit(row));
}

export async function listAllUserModelLimits(
	db: D1Database,
): Promise<UserModelLimit[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM user_model_limits
			ORDER BY user_id, provider, model`,
		)
		.all();
	return (results || []).map((row: any) => mapLimit(row));
}

export async function getUserModelLimit(
	db: D1Database,
	userId: string,
	provider: string,
	model: string,
): Promise<UserModelLimit | null> {
	const { results } = await db
		.prepare(
			`SELECT * FROM user_model_limits
			WHERE user_id = ? AND provider = ? AND model = ?`,
		)
		.bind(userId, provider, model)
		.all();
	if (!results || results.length === 0) return null;
	return mapLimit(results[0] as any);
}

export async function upsertUserModelLimit(
	db: D1Database,
	input: {
		userId: string;
		provider: string;
		model: string;
		enabled: boolean;
		weeklyLimit?: number | null;
		monthlyLimit?: number | null;
	},
): Promise<void> {
	const now = Date.now();
	await db
		.prepare(
			`INSERT INTO user_model_limits (
				user_id,
				provider,
				model,
				enabled,
				weekly_limit,
				monthly_limit,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_id, provider, model) DO UPDATE SET
				enabled = excluded.enabled,
				weekly_limit = excluded.weekly_limit,
				monthly_limit = excluded.monthly_limit,
				updated_at = excluded.updated_at`,
		)
		.bind(
			input.userId,
			input.provider,
			input.model,
			input.enabled ? 1 : 0,
			input.weeklyLimit ?? null,
			input.monthlyLimit ?? null,
			now,
		)
		.run();
}

export async function ensureUserModelLimits(
	db: D1Database,
	input: {
		userId: string;
		provider: string;
		model: string;
		enabled?: boolean;
	},
): Promise<void> {
	const now = Date.now();
	await db
		.prepare(
			`INSERT OR IGNORE INTO user_model_limits (
				user_id,
				provider,
				model,
				enabled,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?)`,
		)
		.bind(
			input.userId,
			input.provider,
			input.model,
			input.enabled === false ? 0 : 1,
			now,
		)
		.run();
}

function mapLimit(row: any): UserModelLimit {
	return {
		userId: row.user_id,
		provider: row.provider,
		model: row.model,
		enabled: Boolean(row.enabled),
		weeklyLimit:
			row.weekly_limit === null || row.weekly_limit === undefined
				? undefined
				: Number(row.weekly_limit),
		monthlyLimit:
			row.monthly_limit === null || row.monthly_limit === undefined
				? undefined
				: Number(row.monthly_limit),
		updatedAt: row.updated_at,
	};
}

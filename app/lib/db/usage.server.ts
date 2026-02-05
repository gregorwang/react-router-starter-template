export interface UsageStats {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	totalCalls: number;
	models: Record<string, number>;
}

export async function getUsageStats(
	db: D1Database,
	options: {
		userId: string;
		startMs: number;
		endMs: number;
		projectId?: string;
	},
): Promise<UsageStats> {
	const { userId, startMs, endMs, projectId } = options;

	let query = `
		SELECT
			CASE
				WHEN json_valid(m.meta) AND json_extract(m.meta, '$.model') IS NOT NULL
					THEN json_extract(m.meta, '$.model')
				ELSE c.model
			END as model,
			COUNT(*) as calls,
			SUM(CASE WHEN json_valid(m.meta) THEN COALESCE(json_extract(m.meta, '$.usage.promptTokens'), 0) ELSE 0 END) as promptTokens,
			SUM(CASE WHEN json_valid(m.meta) THEN COALESCE(json_extract(m.meta, '$.usage.completionTokens'), 0) ELSE 0 END) as completionTokens,
			SUM(CASE WHEN json_valid(m.meta) THEN COALESCE(json_extract(m.meta, '$.usage.totalTokens'), 0) ELSE 0 END) as totalTokens
		FROM messages m
		JOIN conversations c ON c.id = m.conversation_id
		WHERE m.role = 'assistant'
			AND m.timestamp >= ?
			AND m.timestamp <= ?
	`;

	const params: Array<string | number> = [startMs, endMs];
	query += " AND c.user_id = ?";
	params.push(userId);
	if (projectId) {
		query += " AND c.project_id = ?";
		params.push(projectId);
	}

	query += " GROUP BY model";

	const { results } = await db.prepare(query).bind(...params).all();

	let promptTokens = 0;
	let completionTokens = 0;
	let totalTokens = 0;
	let totalCalls = 0;
	const models: Record<string, number> = {};

	for (const row of (results || []) as Array<{
		model?: string | null;
		calls?: number | string | null;
		promptTokens?: number | string | null;
		completionTokens?: number | string | null;
		totalTokens?: number | string | null;
	}>) {
		const calls = Number(row.calls || 0);
		totalCalls += calls;
		promptTokens += Number(row.promptTokens || 0);
		completionTokens += Number(row.completionTokens || 0);
		totalTokens += Number(row.totalTokens || 0);

		const model = row.model || "unknown";
		models[model] = (models[model] || 0) + calls;
	}

	return {
		promptTokens,
		completionTokens,
		totalTokens,
		totalCalls,
		models,
	};
}

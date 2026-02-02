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
		startMs: number;
		endMs: number;
		projectId?: string;
	},
): Promise<UsageStats> {
	const { startMs, endMs, projectId } = options;

	let query = `
		SELECT m.meta as meta, c.model as model
		FROM messages m
		JOIN conversations c ON c.id = m.conversation_id
		WHERE m.role = 'assistant'
			AND m.timestamp >= ?
			AND m.timestamp <= ?
	`;

	const params: Array<string | number> = [startMs, endMs];
	if (projectId) {
		query += " AND c.project_id = ?";
		params.push(projectId);
	}

	const { results } = await db.prepare(query).bind(...params).all();

	let promptTokens = 0;
	let completionTokens = 0;
	let totalTokens = 0;
	let totalCalls = 0;
	const models: Record<string, number> = {};

	for (const row of (results || []) as Array<{ meta?: string | null; model?: string }>) {
		totalCalls += 1;
		const model = row.model || "unknown";
		models[model] = (models[model] || 0) + 1;

		if (!row.meta) {
			continue;
		}

		try {
			const parsed = JSON.parse(row.meta) as { usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
			const usage = parsed?.usage;
			if (usage) {
				promptTokens += usage.promptTokens || 0;
				completionTokens += usage.completionTokens || 0;
				totalTokens += usage.totalTokens || 0;
			}
		} catch {
			// Ignore invalid meta JSON
		}
	}

	return {
		promptTokens,
		completionTokens,
		totalTokens,
		totalCalls,
		models,
	};
}

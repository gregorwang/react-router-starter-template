export async function countModelCallsSince(
	db: D1Database,
	input: {
		userId: string;
		provider: string;
		model: string;
		startMs: number;
	},
): Promise<number> {
	const { results } = await db
		.prepare(
			`SELECT COUNT(*) as calls
			FROM messages m
			JOIN conversations c ON c.id = m.conversation_id
			WHERE c.user_id = ?
				AND m.role = 'assistant'
				AND m.timestamp >= ?
				AND (
					(json_valid(m.meta)
						AND json_extract(m.meta, '$.provider') = ?
						AND json_extract(m.meta, '$.model') = ?)
					OR (
						NOT json_valid(m.meta)
						AND c.provider = ?
						AND c.model = ?
					)
				)`,
		)
		.bind(
			input.userId,
			input.startMs,
			input.provider,
			input.model,
			input.provider,
			input.model,
		)
		.all();

	const row = (results && results[0]) as any;
	return Number(row?.calls || 0);
}

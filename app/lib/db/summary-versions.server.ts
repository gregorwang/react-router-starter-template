/**
 * Summary version persistence layer.
 *
 * Stores each summary update as a versioned record for
 * drift diagnosis and potential rollback.
 */

export interface SummaryVersion {
	id: number;
	conversationId: string;
	userId: string;
	version: number;
	summaryText: string;
	sourceTurnRange?: string;
	changeDescription?: string;
	createdAt: number;
}

/**
 * Save a new summary version and bump the version counter
 * on the conversations table.
 */
export async function saveSummaryVersion(
	db: D1Database,
	options: {
		conversationId: string;
		userId: string;
		version: number;
		summaryText: string;
		sourceTurnRange?: string;
		changeDescription?: string;
	},
): Promise<void> {
	const now = Date.now();
	await db.batch([
		db
			.prepare(
				`INSERT INTO summary_versions
					(conversation_id, user_id, version, summary_text, source_turn_range, change_description, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				options.conversationId,
				options.userId,
				options.version,
				options.summaryText,
				options.sourceTurnRange ?? null,
				options.changeDescription ?? null,
				now,
			),
		db
			.prepare(
				`UPDATE conversations SET summary_version = ? WHERE id = ? AND user_id = ?`,
			)
			.bind(options.version, options.conversationId, options.userId),
	]);
}

/**
 * Get the current summary version number for a conversation.
 * Returns 0 if no version has been recorded yet.
 */
export async function getSummaryVersion(
	db: D1Database,
	conversationId: string,
): Promise<number> {
	const result = await db
		.prepare(`SELECT summary_version FROM conversations WHERE id = ?`)
		.bind(conversationId)
		.first<{ summary_version: number | null }>();
	return result?.summary_version ?? 0;
}

/**
 * List summary versions for a conversation, most recent first.
 */
export async function getSummaryVersions(
	db: D1Database,
	conversationId: string,
	limit = 20,
): Promise<SummaryVersion[]> {
	const { results } = await db
		.prepare(
			`SELECT * FROM summary_versions
			WHERE conversation_id = ?
			ORDER BY version DESC
			LIMIT ?`,
		)
		.bind(conversationId, limit)
		.all();

	return (results || []).map((row: any) => ({
		id: row.id,
		conversationId: row.conversation_id,
		userId: row.user_id,
		version: row.version,
		summaryText: row.summary_text,
		sourceTurnRange: row.source_turn_range ?? undefined,
		changeDescription: row.change_description ?? undefined,
		createdAt: row.created_at,
	}));
}

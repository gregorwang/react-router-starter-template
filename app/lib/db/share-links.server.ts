import type { Conversation } from "../llm/types";

export async function createOrGetConversationShareToken(
	db: D1Database,
	userId: string,
	conversationId: string,
): Promise<string | null> {
	const ownerCheck = await db
		.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ? LIMIT 1")
		.bind(conversationId, userId)
		.first<{ id: string }>();
	if (!ownerCheck?.id) return null;

	const existing = await db
		.prepare(
			`SELECT token
			FROM conversation_share_links
			WHERE user_id = ? AND conversation_id = ? AND revoked_at IS NULL
			LIMIT 1`,
		)
		.bind(userId, conversationId)
		.first<{ token?: string }>();

	if (existing?.token) return existing.token;

	const token = crypto.randomUUID().replace(/-/g, "");
	const now = Date.now();
	try {
		await db
			.prepare(
				`INSERT INTO conversation_share_links (
					token,
					conversation_id,
					user_id,
					created_at,
					updated_at
				) VALUES (?, ?, ?, ?, ?)`,
			)
			.bind(token, conversationId, userId, now, now)
			.run();
	} catch {
		const raced = await db
			.prepare(
				`SELECT token
				FROM conversation_share_links
				WHERE user_id = ? AND conversation_id = ? AND revoked_at IS NULL
				LIMIT 1`,
			)
			.bind(userId, conversationId)
			.first<{ token?: string }>();
		if (raced?.token) return raced.token;
		throw new Error("Failed to create share token");
	}

	return token;
}

export async function getConversationByShareToken(
	db: D1Database,
	token: string,
): Promise<Conversation | null> {
	const result = await db
		.prepare(
			`SELECT c.*,
				(SELECT json_group_array(
					json_object('id', m.id, 'role', m.role, 'content', m.content, 'meta', json(m.meta), 'timestamp', m.timestamp)
					ORDER BY m.timestamp
				) FROM messages m WHERE m.conversation_id = c.id) as messages
			FROM conversation_share_links s
			JOIN conversations c
				ON c.id = s.conversation_id
				AND c.user_id = s.user_id
			WHERE s.token = ? AND s.revoked_at IS NULL
			LIMIT 1`,
		)
		.bind(token)
		.all();

	const row = result.results?.[0] as any;
	if (!row) return null;

	return {
		id: row.id,
		userId: row.user_id,
		projectId: row.project_id,
		title: row.title,
		provider: row.provider,
		model: row.model,
		isArchived: Boolean(row.is_archived),
		isPinned: Boolean(row.is_pinned),
		pinnedAt: row.pinned_at ?? undefined,
		forkedFromConversationId: row.forked_from_conversation_id ?? undefined,
		forkedFromMessageId: row.forked_from_message_id ?? undefined,
		forkedAt: row.forked_at ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		summary: row.summary || undefined,
		summaryUpdatedAt: row.summary_updated_at ?? undefined,
		summaryMessageCount: row.summary_message_count ?? undefined,
		messages: JSON.parse(row.messages || "[]").map((message: any) => ({
			...message,
			meta:
				typeof message.meta === "string"
					? JSON.parse(message.meta || "null") ?? undefined
					: message.meta ?? undefined,
		})),
	};
}

import type { Conversation } from "../llm/types";
import type { Message } from "../llm/types";
import { safeJsonParse } from "./safe-json.server";

type ShareLinkRow = {
	token: string;
	conversation_id: string;
	user_id: string;
	created_at: number;
	updated_at: number;
	revoked_at: number | null;
	expires_at: number | null;
};

type CreateShareTokenOptions = {
	expiresAt?: number | null;
	forceRotate?: boolean;
};

export async function createOrGetConversationShareToken(
	db: D1Database,
	userId: string,
	conversationId: string,
	options?: CreateShareTokenOptions,
): Promise<{ token: string; expiresAt: number | null } | null> {
	const ownerCheck = await db
		.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ? LIMIT 1")
		.bind(conversationId, userId)
		.first<{ id: string }>();
	if (!ownerCheck?.id) return null;

	const now = Date.now();
	const desiredExpiresAt = normalizeExpiresAt(options?.expiresAt);
	const forceRotate = options?.forceRotate === true;

	const existing = await db
		.prepare(
			`SELECT token, expires_at, revoked_at
			FROM conversation_share_links
			WHERE user_id = ? AND conversation_id = ?
			LIMIT 1`,
		)
		.bind(userId, conversationId)
		.first<{
			token?: string;
			expires_at?: number | null;
			revoked_at?: number | null;
		}>();

	const existingActive = isActiveShareLink(existing, now);
	if (existing?.token && existingActive && !forceRotate) {
		if (desiredExpiresAt !== undefined && desiredExpiresAt !== (existing.expires_at ?? null)) {
			await db
				.prepare(
					`UPDATE conversation_share_links
					SET expires_at = ?, updated_at = ?
					WHERE user_id = ? AND conversation_id = ?`,
				)
				.bind(desiredExpiresAt, now, userId, conversationId)
				.run();
			return {
				token: existing.token,
				expiresAt: desiredExpiresAt,
			};
		}
		return {
			token: existing.token,
			expiresAt: existing.expires_at ?? null,
		};
	}

	const nextExpiresAt =
		desiredExpiresAt === undefined ? (existing?.expires_at ?? null) : desiredExpiresAt;

	for (let attempt = 0; attempt < 3; attempt += 1) {
		const token = crypto.randomUUID().replace(/-/g, "");
		try {
			await db
				.prepare(
					`INSERT INTO conversation_share_links (
						token,
						conversation_id,
						user_id,
						created_at,
						updated_at,
						revoked_at,
						expires_at
					) VALUES (?, ?, ?, ?, ?, NULL, ?)
					ON CONFLICT(user_id, conversation_id) DO UPDATE SET
						token = excluded.token,
						updated_at = excluded.updated_at,
						revoked_at = NULL,
						expires_at = excluded.expires_at`,
				)
				.bind(token, conversationId, userId, now, now, nextExpiresAt)
				.run();
			return { token, expiresAt: nextExpiresAt };
		} catch (error) {
			if (attempt === 2) {
				console.error("[share-links] Failed to create share token", error);
				throw new Error("Failed to create share token");
			}
		}
	}

	return null;
}

export async function revokeConversationShareToken(
	db: D1Database,
	userId: string,
	conversationId: string,
): Promise<boolean> {
	const now = Date.now();
	const result = await db
		.prepare(
			`UPDATE conversation_share_links
			SET revoked_at = ?, updated_at = ?
			WHERE user_id = ?
				AND conversation_id = ?
				AND revoked_at IS NULL`,
		)
		.bind(now, now, userId, conversationId)
		.run();

	return Number((result.meta as { changes?: number } | undefined)?.changes || 0) > 0;
}

function normalizeExpiresAt(expiresAt: number | null | undefined): number | null | undefined {
	if (expiresAt === undefined) return undefined;
	if (expiresAt === null) return null;
	if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;
	return Math.floor(expiresAt);
}

function isActiveShareLink(
	link:
		| {
				revoked_at?: number | null;
				expires_at?: number | null;
		  }
		| null
		| undefined,
	now = Date.now(),
) {
	if (!link) return false;
	if (link.revoked_at != null) return false;
	if (link.expires_at != null && link.expires_at <= now) return false;
	return true;
}

function parseStoredMessages(
	rawMessages: string | null | undefined,
	context: string,
): Message[] {
	const parsed = safeJsonParse<any[]>(rawMessages, [], `${context}:messages`);
	return parsed.map((message) => {
		const parsedMeta =
			typeof message?.meta === "string"
				? safeJsonParse<Message["meta"] | null>(
						message.meta,
						null,
						`${context}:message-meta`,
					) ?? undefined
				: (message?.meta as Message["meta"] | undefined);

		return {
			...message,
			meta: parsedMeta,
		} as Message;
	});
}

function parseShareLinkRow(row: any): ShareLinkRow | null {
	if (!row || typeof row.token !== "string") return null;
	return {
		token: row.token,
		conversation_id: row.conversation_id,
		user_id: row.user_id,
		created_at: row.created_at,
		updated_at: row.updated_at,
		revoked_at: row.revoked_at ?? null,
		expires_at: row.expires_at ?? null,
	};
}

export async function getShareLinkStatus(
	db: D1Database,
	userId: string,
	conversationId: string,
): Promise<{
	token: string;
	expiresAt: number | null;
	revokedAt: number | null;
	createdAt: number;
	updatedAt: number;
} | null> {
	const row = await db
			.prepare(
				`SELECT token, conversation_id, user_id, created_at, updated_at, revoked_at, expires_at
				FROM conversation_share_links
				WHERE user_id = ? AND conversation_id = ?
				LIMIT 1`,
			)
			.bind(userId, conversationId)
			.first();
	const parsed = parseShareLinkRow(row);
	if (!parsed) return null;
	return {
		token: parsed.token,
		expiresAt: parsed.expires_at,
		revokedAt: parsed.revoked_at,
		createdAt: parsed.created_at,
		updatedAt: parsed.updated_at,
	};
}

export async function getConversationByShareToken(
	db: D1Database,
	token: string,
): Promise<Conversation | null> {
	const now = Date.now();
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
			WHERE s.token = ?
				AND s.revoked_at IS NULL
				AND (s.expires_at IS NULL OR s.expires_at > ?)
			LIMIT 1`,
		)
		.bind(token, now)
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
		isPersisted: true,
		summary: row.summary || undefined,
		summaryUpdatedAt: row.summary_updated_at ?? undefined,
		summaryMessageCount: row.summary_message_count ?? undefined,
		messages: parseStoredMessages(row.messages, `shared-conversation:${row.id}`),
	};
}

export async function canAccessSharedConversation(
	db: D1Database,
	token: string,
	conversationId: string,
	userId: string,
): Promise<boolean> {
	const now = Date.now();
	const row = await db
		.prepare(
			`SELECT 1
			FROM conversation_share_links
			WHERE token = ?
				AND conversation_id = ?
				AND user_id = ?
				AND revoked_at IS NULL
				AND (expires_at IS NULL OR expires_at > ?)
			LIMIT 1`,
		)
		.bind(token, conversationId, userId, now)
		.first<{ "1": number }>();
	return Boolean(row);
}

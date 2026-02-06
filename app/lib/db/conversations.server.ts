import type { Conversation, Message } from "../llm/types";
import { hashPassword } from "../auth/password.server";
import { ensureAdminUser } from "./users.server";

type D1Meta = {
	duration?: number;
	rows_read?: number;
	rows_written?: number;
};

function isD1LogEnabled() {
	return Boolean((globalThis as { __D1_LOG__?: boolean }).__D1_LOG__);
}

function logD1(label: string, meta?: D1Meta, extra?: Record<string, unknown>) {
	if (!isD1LogEnabled()) return;
	if (!meta && !extra) return;
	const payload = {
		label,
		durationMs: meta?.duration,
		rowsRead: meta?.rows_read,
		rowsWritten: meta?.rows_written,
		...extra,
	};
	console.log("[d1]", JSON.stringify(payload));
}

function logD1Batch(label: string, results: Array<{ meta?: D1Meta }>) {
	if (!isD1LogEnabled()) return;
	let totalDuration = 0;
	let rowsRead = 0;
	let rowsWritten = 0;
	let hasMeta = false;
	for (const result of results) {
		const meta = result?.meta;
		if (!meta) continue;
		hasMeta = true;
		if (typeof meta.duration === "number") totalDuration += meta.duration;
		if (typeof meta.rows_read === "number") rowsRead += meta.rows_read;
		if (typeof meta.rows_written === "number") rowsWritten += meta.rows_written;
	}
	if (!hasMeta) return;
	logD1(label, { duration: totalDuration, rows_read: rowsRead, rows_written: rowsWritten }, { batch: results.length });
}

// D1 Database interfaces
export interface DBConversation {
	id: string;
	user_id: string;
	project_id: string;
	title: string;
	provider: string;
	model: string;
	is_archived?: number;
	is_pinned?: number;
	pinned_at?: number;
	forked_from_conversation_id?: string;
	forked_from_message_id?: string;
	forked_at?: number;
	created_at: number;
	updated_at: number;
	summary?: string;
	summary_updated_at?: number;
	summary_message_count?: number;
}

export interface DBMessage {
	id: string;
	conversation_id: string;
	role: "user" | "assistant" | "system";
	content: string;
	meta?: string;
	timestamp: number;
}

// Server-side database operations
export async function getConversations(
	db: D1Database,
	userId: string,
	projectId?: string,
): Promise<Conversation[]> {
	const baseQuery = `SELECT c.*,
			COUNT(m.id) as message_count
		FROM conversations c
		LEFT JOIN messages m ON m.conversation_id = c.id`;

	const statement = projectId
		? db
				.prepare(
					`${baseQuery} WHERE c.user_id = ? AND c.project_id = ? GROUP BY c.id ORDER BY COALESCE(c.is_pinned, 0) DESC, COALESCE(c.pinned_at, 0) DESC, c.updated_at DESC`,
				)
				.bind(userId, projectId)
		: db.prepare(
				`${baseQuery} WHERE c.user_id = ? GROUP BY c.id ORDER BY COALESCE(c.is_pinned, 0) DESC, COALESCE(c.pinned_at, 0) DESC, c.updated_at DESC`,
			)
				.bind(userId);

	const result = await statement.all();
	logD1("getConversations", result.meta);
	const { results } = result;

	return (results || []).map((row: any) => ({
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
		messageCount: Number(row.message_count || 0),
		messages: [],
	}));
}

export async function getConversationIndex(
	db: D1Database,
	userId: string,
	projectId?: string,
): Promise<Conversation[]> {
	const statement = projectId
		? db
				.prepare(
					"SELECT * FROM conversations WHERE user_id = ? AND project_id = ? ORDER BY COALESCE(is_pinned, 0) DESC, COALESCE(pinned_at, 0) DESC, updated_at DESC",
				)
				.bind(userId, projectId)
		: db.prepare(
				"SELECT * FROM conversations WHERE user_id = ? ORDER BY COALESCE(is_pinned, 0) DESC, COALESCE(pinned_at, 0) DESC, updated_at DESC",
			).bind(userId);

	const result = await statement.all();
	logD1("getConversationIndex", result.meta);
	const { results } = result;

	return (results || []).map((row: any) => ({
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
		messages: [],
	}));
}

export async function getConversation(
	db: D1Database,
	userId: string,
	id: string,
): Promise<Conversation | null> {
	const result = await db
		.prepare(
			`SELECT c.*,
				(SELECT json_group_array(
					json_object('id', m.id, 'role', m.role, 'content', m.content, 'meta', json(m.meta), 'timestamp', m.timestamp)
					ORDER BY m.timestamp
				) FROM messages m WHERE m.conversation_id = c.id) as messages
			FROM conversations c
			WHERE c.id = ? AND c.user_id = ?`,
		)
		.bind(id, userId)
		.all();
	logD1("getConversation", result.meta);
	const { results } = result;

	if (!results || results.length === 0) {
		return null;
	}

	const row = results[0] as any;
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

export interface ProjectUsageTotals {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	credits: number;
	conversations: number;
	messages: number;
}

export async function getProjectUsageTotals(
	db: D1Database,
	userId: string,
	projectId: string,
): Promise<ProjectUsageTotals> {
	const result = await db
		.prepare(
			`SELECT
				COUNT(DISTINCT c.id) as conversations,
				COUNT(m.id) as messages,
				SUM(CASE WHEN json_valid(m.meta) THEN COALESCE(json_extract(m.meta, '$.usage.promptTokens'), 0) ELSE 0 END) as promptTokens,
				SUM(CASE WHEN json_valid(m.meta) THEN COALESCE(json_extract(m.meta, '$.usage.completionTokens'), 0) ELSE 0 END) as completionTokens,
				SUM(CASE WHEN json_valid(m.meta) THEN COALESCE(json_extract(m.meta, '$.usage.totalTokens'), 0) ELSE 0 END) as totalTokens,
				SUM(CASE WHEN json_valid(m.meta) THEN COALESCE(json_extract(m.meta, '$.credits'), 0) ELSE 0 END) as credits
			FROM conversations c
			LEFT JOIN messages m ON m.conversation_id = c.id
			WHERE c.user_id = ? AND c.project_id = ?`,
		)
		.bind(userId, projectId)
		.all();
	logD1("getProjectUsageTotals", result.meta);
	const { results } = result;

	const row = (results && results[0]) as any;

	return {
		promptTokens: Number(row?.promptTokens || 0),
		completionTokens: Number(row?.completionTokens || 0),
		totalTokens: Number(row?.totalTokens || 0),
		credits: Number(row?.credits || 0),
		conversations: Number(row?.conversations || 0),
		messages: Number(row?.messages || 0),
	};
}

export type ConversationSearchResult = {
	id: string;
	projectId: string;
	title: string;
	updatedAt: number;
	isArchived: boolean;
	isPinned: boolean;
	pinnedAt?: number;
	snippet?: string;
};

function escapeLikePattern(input: string) {
	return input.replace(/[\\%_]/g, "\\$&");
}

export async function searchConversations(
	db: D1Database,
	options: {
		userId: string;
		query: string;
		projectId?: string;
		limit?: number;
	},
): Promise<ConversationSearchResult[]> {
	const normalizedQuery = options.query.trim().toLowerCase();
	if (!normalizedQuery) return [];

	const safeLimit = Math.max(1, Math.min(options.limit ?? 30, 50));
	const scopeProjectId = options.projectId?.trim() || null;
	const like = `%${escapeLikePattern(normalizedQuery)}%`;

	const result = await db
		.prepare(
			`SELECT
				c.id,
				c.project_id,
				c.title,
				c.updated_at,
				c.is_archived,
				c.is_pinned,
				c.pinned_at,
				CASE WHEN lower(c.title) LIKE ? ESCAPE '\\' THEN 2 ELSE 0 END +
				CASE WHEN EXISTS (
					SELECT 1
					FROM messages m
					WHERE m.conversation_id = c.id
						AND lower(m.content) LIKE ? ESCAPE '\\'
				) THEN 1 ELSE 0 END AS score,
				(
					SELECT substr(m.content, 1, 120)
					FROM messages m
					WHERE m.conversation_id = c.id
						AND lower(m.content) LIKE ? ESCAPE '\\'
					ORDER BY m.timestamp DESC
					LIMIT 1
				) AS snippet
			FROM conversations c
			WHERE c.user_id = ?
				AND (? IS NULL OR c.project_id = ?)
				AND (
					lower(c.title) LIKE ? ESCAPE '\\'
					OR EXISTS (
						SELECT 1
						FROM messages m
						WHERE m.conversation_id = c.id
							AND lower(m.content) LIKE ? ESCAPE '\\'
					)
				)
			ORDER BY score DESC, COALESCE(c.is_pinned, 0) DESC, COALESCE(c.pinned_at, 0) DESC, c.updated_at DESC
			LIMIT ?`,
		)
		.bind(
			like,
			like,
			like,
			options.userId,
			scopeProjectId,
			scopeProjectId,
			like,
			like,
			safeLimit,
		)
		.all();
	logD1("searchConversations", result.meta, {
		projectId: scopeProjectId ?? "all",
		limit: safeLimit,
	});

	return (result.results || []).map((row: any) => ({
		id: row.id,
		projectId: row.project_id,
		title: row.title,
		updatedAt: row.updated_at,
		isArchived: Boolean(row.is_archived),
		isPinned: Boolean(row.is_pinned),
		pinnedAt: row.pinned_at ?? undefined,
		snippet: row.snippet ?? undefined,
	}));
}

export async function getProjectConversationCounts(
	db: D1Database,
	userId: string,
): Promise<Record<string, number>> {
	const result = await db
		.prepare(
			`SELECT project_id, COUNT(id) AS count
			FROM conversations
			WHERE user_id = ?
			GROUP BY project_id`,
		)
		.bind(userId)
		.all();
	logD1("getProjectConversationCounts", result.meta);

	const counts: Record<string, number> = {};
	for (const row of result.results || []) {
		const item = row as { project_id?: string; count?: number };
		if (!item.project_id) continue;
		counts[item.project_id] = Number(item.count || 0);
	}
	return counts;
}

export async function saveConversation(
	db: D1Database,
	conversation: Conversation,
): Promise<void> {
	// Use batch for atomic operations
	const statements: D1PreparedStatement[] = [];

	// Insert or update conversation
	statements.push(
		db
			.prepare(
				`INSERT INTO conversations (
					id,
					user_id,
					project_id,
					title,
					provider,
					model,
					is_archived,
					is_pinned,
					pinned_at,
					forked_from_conversation_id,
					forked_from_message_id,
					forked_at,
					created_at,
					updated_at,
					summary,
					summary_updated_at,
					summary_message_count
				)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				user_id = excluded.user_id,
				project_id = excluded.project_id,
				title = excluded.title,
				provider = excluded.provider,
				model = excluded.model,
				is_archived = excluded.is_archived,
				is_pinned = excluded.is_pinned,
				pinned_at = excluded.pinned_at,
				forked_from_conversation_id = COALESCE(excluded.forked_from_conversation_id, forked_from_conversation_id),
				forked_from_message_id = COALESCE(excluded.forked_from_message_id, forked_from_message_id),
				forked_at = COALESCE(excluded.forked_at, forked_at),
				updated_at = excluded.updated_at,
				summary = COALESCE(excluded.summary, summary),
				summary_updated_at = COALESCE(excluded.summary_updated_at, summary_updated_at),
				summary_message_count = COALESCE(excluded.summary_message_count, summary_message_count)`,
			)
			.bind(
				conversation.id,
				conversation.userId ?? "legacy",
				conversation.projectId ?? "default",
				conversation.title,
				conversation.provider,
				conversation.model,
				conversation.isArchived ? 1 : 0,
				conversation.isPinned ? 1 : 0,
				conversation.isPinned ? (conversation.pinnedAt ?? Date.now()) : null,
				conversation.forkedFromConversationId ?? null,
				conversation.forkedFromMessageId ?? null,
				conversation.forkedAt ?? null,
				conversation.createdAt,
				conversation.updatedAt,
				conversation.summary ?? null,
				conversation.summaryUpdatedAt ?? null,
				conversation.summaryMessageCount ?? null,
			),
	);

	// Delete existing messages
	statements.push(
		db.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(conversation.id),
	);

	// Insert all messages
	for (const message of conversation.messages) {
		statements.push(
			db
				.prepare(
					`INSERT INTO messages (id, conversation_id, role, content, meta, timestamp)
				VALUES (?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					message.id,
					conversation.id,
					message.role,
					message.content,
					message.meta ? JSON.stringify(message.meta) : null,
					message.timestamp,
				),
		);
	}

	// Execute all statements atomically
	const batchResults = await db.batch(statements);
	logD1Batch("saveConversation", batchResults);
}

export async function appendConversationMessages(
	db: D1Database,
	userId: string,
	conversationId: string,
	options: {
		updatedAt: number;
		title?: string;
		provider?: string;
		model?: string;
		resetSummary?: boolean;
	},
	messages: Message[],
): Promise<void> {
	const statements: D1PreparedStatement[] = [];
	const { updatedAt, title, provider, model, resetSummary } = options;
	const shouldResetSummary = resetSummary ? 1 : 0;

	statements.push(
		db
			.prepare(
				`UPDATE conversations
				SET title = COALESCE(?, title),
					provider = COALESCE(?, provider),
					model = COALESCE(?, model),
					updated_at = ?,
					summary = CASE WHEN ? = 1 THEN NULL ELSE summary END,
					summary_updated_at = CASE WHEN ? = 1 THEN NULL ELSE summary_updated_at END,
					summary_message_count = CASE WHEN ? = 1 THEN NULL ELSE summary_message_count END
				WHERE id = ? AND user_id = ?`,
			)
			.bind(
				title ?? null,
				provider ?? null,
				model ?? null,
				updatedAt,
				shouldResetSummary,
				shouldResetSummary,
				shouldResetSummary,
				conversationId,
				userId,
			),
	);

	for (const message of messages) {
		statements.push(
			db
				.prepare(
					`INSERT INTO messages (id, conversation_id, role, content, meta, timestamp)
					VALUES (?, ?, ?, ?, ?, ?)
					ON CONFLICT(id) DO UPDATE SET
						role = excluded.role,
						content = excluded.content,
						meta = excluded.meta,
						timestamp = excluded.timestamp`,
				)
				.bind(
					message.id,
					conversationId,
					message.role,
					message.content,
					message.meta ? JSON.stringify(message.meta) : null,
					message.timestamp,
				),
		);
	}

	const batchResults = await db.batch(statements);
	logD1Batch("appendConversationMessages", batchResults);
}

export async function updateConversationSummary(
	db: D1Database,
	userId: string,
	id: string,
	summary: string,
	summaryUpdatedAt: number,
	summaryMessageCount: number,
): Promise<void> {
	await db
		.prepare(
			`UPDATE conversations
			SET summary = ?, summary_updated_at = ?, summary_message_count = ?
			WHERE id = ? AND user_id = ?`,
		)
		.bind(summary, summaryUpdatedAt, summaryMessageCount, id, userId)
		.run();
}

export async function updateConversationTitle(
	db: D1Database,
	userId: string,
	id: string,
	title: string,
	updatedAt: number,
): Promise<void> {
	await db
		.prepare(
			`UPDATE conversations
			SET title = ?, updated_at = ?
			WHERE id = ? AND user_id = ?`,
		)
		.bind(title, updatedAt, id, userId)
		.run();
}

export async function updateConversationMetadata(
	db: D1Database,
	userId: string,
	id: string,
	options: {
		title?: string;
		isArchived?: boolean;
		isPinned?: boolean;
		projectId?: string;
		updatedAt: number;
	},
): Promise<void> {
	const pinFlag =
		options.isPinned === undefined ? null : options.isPinned ? 1 : 0;
	const pinnedAt = options.isPinned ? options.updatedAt : null;

	await db
		.prepare(
			`UPDATE conversations
			SET title = COALESCE(?, title),
				project_id = COALESCE(?, project_id),
				is_archived = COALESCE(?, is_archived),
				is_pinned = COALESCE(?, is_pinned),
				pinned_at = CASE
					WHEN ? IS NULL THEN pinned_at
					WHEN ? = 1 THEN COALESCE(?, pinned_at, ?)
					ELSE NULL
				END,
				updated_at = ?
			WHERE id = ? AND user_id = ?`,
		)
		.bind(
			options.title ?? null,
			options.projectId ?? null,
			options.isArchived === undefined ? null : options.isArchived ? 1 : 0,
			pinFlag,
			pinFlag,
			pinFlag,
			pinnedAt,
			options.updatedAt,
			options.updatedAt,
			id,
			userId,
		)
		.run();
}

export async function moveProjectConversations(
	db: D1Database,
	userId: string,
	fromProjectId: string,
	toProjectId: string,
	updatedAt: number,
): Promise<void> {
	await db
		.prepare(
			`UPDATE conversations
			SET project_id = ?, updated_at = ?
			WHERE user_id = ? AND project_id = ?`,
		)
		.bind(toProjectId, updatedAt, userId, fromProjectId)
		.run();
}

export async function deleteConversationsByProject(
	db: D1Database,
	userId: string,
	projectId: string,
): Promise<void> {
	await db
		.prepare("DELETE FROM conversations WHERE user_id = ? AND project_id = ?")
		.bind(userId, projectId)
		.run();
}

export async function deleteConversation(
	db: D1Database,
	userId: string,
	id: string,
): Promise<void> {
	// Messages will be deleted via CASCADE
	await db
		.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
		.bind(id, userId)
		.run();
}

// Database initialization
export async function initDatabase(db: D1Database, env?: Env): Promise<void> {
	// Create conversations table
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS conversations (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				project_id TEXT NOT NULL DEFAULT 'default',
				title TEXT NOT NULL,
				provider TEXT NOT NULL,
				model TEXT NOT NULL,
				is_archived INTEGER NOT NULL DEFAULT 0,
				is_pinned INTEGER NOT NULL DEFAULT 0,
				pinned_at INTEGER,
				forked_from_conversation_id TEXT,
				forked_from_message_id TEXT,
				forked_at INTEGER,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				summary TEXT,
				summary_updated_at INTEGER,
				summary_message_count INTEGER
			)`,
		)
		.run();

	// Create messages table
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS messages (
				id TEXT PRIMARY KEY,
				conversation_id TEXT NOT NULL,
				role TEXT NOT NULL,
				content TEXT NOT NULL,
				meta TEXT,
				timestamp INTEGER NOT NULL,
				FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS projects (
				id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT,
				is_default INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS conversation_share_links (
				token TEXT PRIMARY KEY,
				conversation_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				revoked_at INTEGER,
				UNIQUE(user_id, conversation_id),
				FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS users (
				id TEXT PRIMARY KEY,
				username TEXT NOT NULL UNIQUE,
				password_hash TEXT NOT NULL,
				role TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				last_login_at INTEGER
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS invite_codes (
				code TEXT PRIMARY KEY,
				created_by TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				used_by TEXT,
				used_at INTEGER
			)`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS user_model_limits (
				user_id TEXT NOT NULL,
				provider TEXT NOT NULL,
				model TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				weekly_limit INTEGER,
				monthly_limit INTEGER,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (user_id, provider, model)
			)`,
		)
		.run();

	// Normalize default project name if legacy data exists.
	await db
		.prepare(
			"UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = 'default' AND name IN ('Default', '模型选择')",
		)
		.bind("默认项目", "默认工作区", Date.now())
		.run();

	// Best-effort migrations for existing schemas
	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN user_id TEXT").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE messages ADD COLUMN meta TEXT").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN summary TEXT").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN summary_updated_at INTEGER").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN summary_message_count INTEGER").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN forked_from_conversation_id TEXT").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN forked_from_message_id TEXT").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN forked_at INTEGER").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN pinned_at INTEGER").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE sessions ADD COLUMN expires_at INTEGER NOT NULL").run();
	} catch {
		// Column already exists or table is new
	}

	try {
		await db.prepare("ALTER TABLE sessions ADD COLUMN user_id TEXT").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE projects ADD COLUMN user_id TEXT").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE projects ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0").run();
	} catch {
		// Column already exists
	}

	const adminUsername = env?.ADMIN_USERNAME?.trim() || "admin";
	const adminPassword = (env?.ADMIN_PASSWORD || env?.AUTH_PASSWORD || "").trim();
	if (adminPassword) {
		try {
			const adminHash = await hashPassword(adminPassword);
			const adminUser = await ensureAdminUser(db, {
				username: adminUsername,
				passwordHash: adminHash,
			});

			await db
				.prepare(
					"UPDATE conversations SET user_id = ? WHERE user_id IS NULL OR user_id = 'legacy'",
				)
				.bind(adminUser.id)
				.run();

			await db
				.prepare(
					"UPDATE projects SET user_id = ? WHERE user_id IS NULL OR user_id = 'legacy'",
				)
				.bind(adminUser.id)
				.run();

			await db
				.prepare(
					"UPDATE projects SET is_default = 1 WHERE id = 'default' AND user_id = ?",
				)
				.bind(adminUser.id)
				.run();

			const { results: defaultResults } = await db
				.prepare(
					"SELECT id FROM projects WHERE user_id = ? AND is_default = 1 LIMIT 1",
				)
				.bind(adminUser.id)
				.all();

			if (!defaultResults || defaultResults.length === 0) {
				const now = Date.now();
				const defaultId = `default:${adminUser.id}`;
				await db
					.prepare(
						`INSERT OR IGNORE INTO projects (id, user_id, name, description, is_default, created_at, updated_at)
						VALUES (?, ?, ?, ?, 1, ?, ?)`,
					)
					.bind(defaultId, adminUser.id, "默认项目", "默认工作区", now, now)
					.run();
			}

			await db.prepare("DELETE FROM sessions WHERE user_id IS NULL").run();
		} catch (error) {
			console.error("[initDatabase] Admin bootstrap failed:", error);
		}
	}

	// Indexes must be created after migrations to avoid missing-column errors.
	await db
		.prepare(
			"CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id)",
		)
		.run();

	await db
		.prepare(
			"CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(is_archived)",
		)
		.run();

	await db
		.prepare(
			"CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(is_pinned, pinned_at DESC)",
		)
		.run();

	await db
		.prepare(
			"CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC)",
		)
		.run();

	await db
		.prepare(
			"CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)",
		)
		.run();

	await db
		.prepare(
			"CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)",
		)
		.run();

	await db
		.prepare("CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)")
		.run();

	await db
		.prepare(
			"CREATE INDEX IF NOT EXISTS idx_messages_role_timestamp ON messages(role, timestamp)",
		)
		.run();

	await db
		.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)")
		.run();

	await db
		.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
		.run();

	await db
		.prepare("CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)")
		.run();

	await db
		.prepare(
			"CREATE INDEX IF NOT EXISTS idx_share_links_conversation_id ON conversation_share_links(conversation_id)",
		)
		.run();

	await db
		.prepare(
			"CREATE INDEX IF NOT EXISTS idx_share_links_user_id ON conversation_share_links(user_id)",
		)
		.run();

	await db
		.prepare(
			"CREATE INDEX IF NOT EXISTS idx_invite_codes_expires_at ON invite_codes(expires_at)",
		)
		.run();

	await db
		.prepare(
			"CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by ON invite_codes(used_by)",
		)
		.run();

	// Ensure default project exists
	await db
		.prepare(
			`INSERT OR IGNORE INTO projects (id, user_id, name, description, is_default, created_at, updated_at)
			VALUES ('default', 'legacy', '默认项目', '默认工作区', 1, ?, ?)`,
		)
		.bind(Date.now(), Date.now())
		.run();
}

import type { Conversation, Message } from "../llm/types";
import { hashPassword } from "../auth/password.server";
import { ensureAdminUser } from "./users.server";
import { safeJsonParse } from "./safe-json.server";

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
	reasoning_effort?: string;
	enable_thinking?: number;
	thinking_budget?: number;
	thinking_level?: string;
	output_tokens?: number;
	output_effort?: string;
	web_search?: number;
	xai_search_mode?: string;
	enable_tools?: number;
}

export interface DBMessage {
	id: string;
	conversation_id: string;
	role: "user" | "assistant" | "system";
	content: string;
	meta?: string;
	timestamp: number;
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

function toOptionalBoolean(value: unknown): boolean | undefined {
	if (value === null || value === undefined) return undefined;
	return Boolean(value);
}

function toOptionalNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	return undefined;
}

function mapConversationRow(row: any, messages: Message[]): Conversation {
	return {
		id: row.id,
		userId: row.user_id,
		projectId: row.project_id,
		title: row.title,
		provider: row.provider,
		model: row.model,
		isArchived: Boolean(row.is_archived),
		isPinned: Boolean(row.is_pinned),
		pinnedAt: toOptionalNumber(row.pinned_at),
		forkedFromConversationId: row.forked_from_conversation_id ?? undefined,
		forkedFromMessageId: row.forked_from_message_id ?? undefined,
		forkedAt: toOptionalNumber(row.forked_at),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		isPersisted: true,
		summary: row.summary || undefined,
		summaryUpdatedAt: toOptionalNumber(row.summary_updated_at),
		summaryMessageCount: toOptionalNumber(row.summary_message_count),
		reasoningEffort: row.reasoning_effort ?? undefined,
		enableThinking: toOptionalBoolean(row.enable_thinking),
		thinkingBudget: toOptionalNumber(row.thinking_budget),
		thinkingLevel: row.thinking_level ?? undefined,
		outputTokens: toOptionalNumber(row.output_tokens),
		outputEffort: row.output_effort ?? undefined,
		webSearch: toOptionalBoolean(row.web_search),
		xaiSearchMode: row.xai_search_mode ?? undefined,
		enableTools: toOptionalBoolean(row.enable_tools),
		messages,
	};
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
		...mapConversationRow(row, []),
		messageCount: Number(row.message_count || 0),
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

	return (results || []).map((row: any) => mapConversationRow(row, []));
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
	return mapConversationRow(
		row,
		parseStoredMessages(row.messages, `conversation:${row.id}`),
	);
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
					summary_message_count,
					reasoning_effort,
					enable_thinking,
					thinking_budget,
					thinking_level,
					output_tokens,
					output_effort,
					web_search,
					xai_search_mode,
					enable_tools
				)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
				summary_message_count = COALESCE(excluded.summary_message_count, summary_message_count),
				reasoning_effort = COALESCE(excluded.reasoning_effort, reasoning_effort),
				enable_thinking = COALESCE(excluded.enable_thinking, enable_thinking),
				thinking_budget = COALESCE(excluded.thinking_budget, thinking_budget),
				thinking_level = COALESCE(excluded.thinking_level, thinking_level),
				output_tokens = COALESCE(excluded.output_tokens, output_tokens),
				output_effort = COALESCE(excluded.output_effort, output_effort),
				web_search = COALESCE(excluded.web_search, web_search),
				xai_search_mode = COALESCE(excluded.xai_search_mode, xai_search_mode),
				enable_tools = COALESCE(excluded.enable_tools, enable_tools)`,
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
				conversation.reasoningEffort ?? null,
				conversation.enableThinking === undefined ? null : conversation.enableThinking ? 1 : 0,
				conversation.thinkingBudget ?? null,
				conversation.thinkingLevel ?? null,
				conversation.outputTokens ?? null,
				conversation.outputEffort ?? null,
				conversation.webSearch === undefined ? null : conversation.webSearch ? 1 : 0,
				conversation.xaiSearchMode ?? null,
				conversation.enableTools === undefined ? null : conversation.enableTools ? 1 : 0,
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
		reasoningEffort?: "low" | "medium" | "high";
		enableThinking?: boolean;
		thinkingBudget?: number;
		thinkingLevel?: "low" | "medium" | "high";
		outputTokens?: number;
		outputEffort?: "low" | "medium" | "high" | "max";
		webSearch?: boolean;
		xaiSearchMode?: "x" | "web" | "both";
		enableTools?: boolean;
		resetSummary?: boolean;
	},
	messages: Message[],
): Promise<void> {
	const statements: D1PreparedStatement[] = [];
	const {
		updatedAt,
		title,
		provider,
		model,
		reasoningEffort,
		enableThinking,
		thinkingBudget,
		thinkingLevel,
		outputTokens,
		outputEffort,
		webSearch,
		xaiSearchMode,
		enableTools,
		resetSummary,
	} = options;
	const shouldResetSummary = resetSummary ? 1 : 0;

	statements.push(
		db
			.prepare(
				`UPDATE conversations
				SET title = COALESCE(?, title),
					provider = COALESCE(?, provider),
					model = COALESCE(?, model),
					reasoning_effort = COALESCE(?, reasoning_effort),
					enable_thinking = COALESCE(?, enable_thinking),
					thinking_budget = COALESCE(?, thinking_budget),
					thinking_level = COALESCE(?, thinking_level),
					output_tokens = COALESCE(?, output_tokens),
					output_effort = COALESCE(?, output_effort),
					web_search = COALESCE(?, web_search),
					xai_search_mode = COALESCE(?, xai_search_mode),
					enable_tools = COALESCE(?, enable_tools),
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
				reasoningEffort ?? null,
				enableThinking === undefined ? null : enableThinking ? 1 : 0,
				thinkingBudget ?? null,
				thinkingLevel ?? null,
				outputTokens ?? null,
				outputEffort ?? null,
				webSearch === undefined ? null : webSearch ? 1 : 0,
				xaiSearchMode ?? null,
				enableTools === undefined ? null : enableTools ? 1 : 0,
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

export async function updateConversationSessionSettings(
	db: D1Database,
	userId: string,
	id: string,
	options: {
		updatedAt: number;
		projectId?: string;
		provider?: string;
		model?: string;
		reasoningEffort?: "low" | "medium" | "high";
		enableThinking?: boolean;
		thinkingBudget?: number;
		thinkingLevel?: "low" | "medium" | "high";
		outputTokens?: number;
		outputEffort?: "low" | "medium" | "high" | "max";
		webSearch?: boolean;
		xaiSearchMode?: "x" | "web" | "both";
		enableTools?: boolean;
	},
): Promise<void> {
	await db
		.prepare(
			`UPDATE conversations
			SET project_id = COALESCE(?, project_id),
				provider = COALESCE(?, provider),
				model = COALESCE(?, model),
				reasoning_effort = COALESCE(?, reasoning_effort),
				enable_thinking = COALESCE(?, enable_thinking),
				thinking_budget = COALESCE(?, thinking_budget),
				thinking_level = COALESCE(?, thinking_level),
				output_tokens = COALESCE(?, output_tokens),
				output_effort = COALESCE(?, output_effort),
				web_search = COALESCE(?, web_search),
				xai_search_mode = COALESCE(?, xai_search_mode),
				enable_tools = COALESCE(?, enable_tools),
				updated_at = ?
			WHERE id = ? AND user_id = ?`,
		)
		.bind(
			options.projectId ?? null,
			options.provider ?? null,
			options.model ?? null,
			options.reasoningEffort ?? null,
			options.enableThinking === undefined ? null : options.enableThinking ? 1 : 0,
			options.thinkingBudget ?? null,
			options.thinkingLevel ?? null,
			options.outputTokens ?? null,
			options.outputEffort ?? null,
			options.webSearch === undefined ? null : options.webSearch ? 1 : 0,
			options.xaiSearchMode ?? null,
			options.enableTools === undefined ? null : options.enableTools ? 1 : 0,
			options.updatedAt,
			id,
			userId,
		)
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

export interface InitDatabaseOptions {
	allowRuntimeMigrations?: boolean;
	allowAdminBootstrap?: boolean;
}

// Database initialization
export async function initDatabase(
	db: D1Database,
	env?: Env,
	options?: InitDatabaseOptions,
): Promise<void> {
	const allowRuntimeMigrations = options?.allowRuntimeMigrations === true;
	const allowAdminBootstrap = options?.allowAdminBootstrap === true;

	if (allowRuntimeMigrations) {
		await ensureBaseTables(db);
		await runRuntimeLegacyMigrations(db);
		await ensureIndexes(db);
		await ensureLegacyDefaultProject(db);
	}

	await assertRequiredSchema(db);

	if (allowAdminBootstrap) {
		await runAdminBootstrap(db, env);
	}
}

const REQUIRED_SCHEMA_COLUMNS: Record<string, string[]> = {
	conversations: [
		"user_id",
		"project_id",
		"is_archived",
		"is_pinned",
		"pinned_at",
		"forked_from_conversation_id",
		"forked_from_message_id",
		"forked_at",
		"summary",
		"summary_updated_at",
		"summary_message_count",
		"reasoning_effort",
		"enable_thinking",
		"thinking_budget",
		"thinking_level",
		"output_tokens",
		"output_effort",
		"web_search",
		"xai_search_mode",
		"enable_tools",
	],
	messages: ["meta"],
	sessions: ["user_id", "expires_at"],
	projects: ["user_id", "is_default"],
	conversation_share_links: [
		"token",
		"conversation_id",
		"user_id",
		"revoked_at",
		"expires_at",
	],
	users: ["id", "username", "password_hash", "role"],
	invite_codes: ["code", "created_by", "created_at", "expires_at"],
	user_model_limits: ["user_id", "provider", "model", "enabled", "updated_at"],
};

async function ensureBaseTables(db: D1Database) {
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
				summary_message_count INTEGER,
				reasoning_effort TEXT,
				enable_thinking INTEGER,
				thinking_budget INTEGER,
				thinking_level TEXT,
				output_tokens INTEGER,
				output_effort TEXT,
				web_search INTEGER,
				xai_search_mode TEXT,
				enable_tools INTEGER
			)`,
		)
		.run();

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
				expires_at INTEGER,
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
}

async function runRuntimeLegacyMigrations(db: D1Database) {
	await db
		.prepare(
			"UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = 'default' AND name IN ('Default', '模型选择')",
		)
		.bind("默认项目", "默认工作区", Date.now())
		.run();

	const legacyStatements = [
		"ALTER TABLE conversations ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'",
		"ALTER TABLE conversations ADD COLUMN user_id TEXT",
		"ALTER TABLE messages ADD COLUMN meta TEXT",
		"ALTER TABLE conversations ADD COLUMN summary TEXT",
		"ALTER TABLE conversations ADD COLUMN summary_updated_at INTEGER",
		"ALTER TABLE conversations ADD COLUMN summary_message_count INTEGER",
		"ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT",
		"ALTER TABLE conversations ADD COLUMN enable_thinking INTEGER",
		"ALTER TABLE conversations ADD COLUMN thinking_budget INTEGER",
		"ALTER TABLE conversations ADD COLUMN thinking_level TEXT",
		"ALTER TABLE conversations ADD COLUMN output_tokens INTEGER",
		"ALTER TABLE conversations ADD COLUMN output_effort TEXT",
		"ALTER TABLE conversations ADD COLUMN web_search INTEGER",
		"ALTER TABLE conversations ADD COLUMN xai_search_mode TEXT",
		"ALTER TABLE conversations ADD COLUMN enable_tools INTEGER",
		"ALTER TABLE conversations ADD COLUMN forked_from_conversation_id TEXT",
		"ALTER TABLE conversations ADD COLUMN forked_from_message_id TEXT",
		"ALTER TABLE conversations ADD COLUMN forked_at INTEGER",
		"ALTER TABLE conversations ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE conversations ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE conversations ADD COLUMN pinned_at INTEGER",
		"ALTER TABLE sessions ADD COLUMN expires_at INTEGER NOT NULL",
		"ALTER TABLE sessions ADD COLUMN user_id TEXT",
		"ALTER TABLE projects ADD COLUMN user_id TEXT",
		"ALTER TABLE projects ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE conversation_share_links ADD COLUMN revoked_at INTEGER",
		"ALTER TABLE conversation_share_links ADD COLUMN expires_at INTEGER",
	];

	for (const sql of legacyStatements) {
		try {
			await db.prepare(sql).run();
		} catch {
			// Column already exists on upgraded schemas.
		}
	}
}

async function assertRequiredSchema(db: D1Database) {
	for (const [table, requiredColumns] of Object.entries(REQUIRED_SCHEMA_COLUMNS)) {
		const existingColumns = await listTableColumns(db, table);
		const missing = requiredColumns.filter((column) => !existingColumns.has(column));
		if (missing.length > 0) {
			throw new Error(
				`[initDatabase] Schema is missing columns for '${table}': ${missing.join(", ")}. Run D1 migrations before deploy, or enable DB_RUNTIME_MIGRATIONS once for legacy upgrade.`,
			);
		}
	}
}

async function listTableColumns(db: D1Database, table: string): Promise<Set<string>> {
	const result = await db.prepare(`PRAGMA table_info(${table})`).all();
	const columns = new Set<string>();
	for (const row of result.results || []) {
		const name = (row as { name?: unknown }).name;
		if (typeof name === "string" && name.length > 0) {
			columns.add(name);
		}
	}
	return columns;
}

async function ensureIndexes(db: D1Database) {
	const indexStatements = [
		"CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id)",
		"CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(is_archived)",
		"CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON conversations(is_pinned, pinned_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)",
		"CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id)",
		"CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)",
		"CREATE INDEX IF NOT EXISTS idx_messages_role_timestamp ON messages(role, timestamp)",
		"CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)",
		"CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
		"CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)",
		"CREATE INDEX IF NOT EXISTS idx_share_links_conversation_id ON conversation_share_links(conversation_id)",
		"CREATE INDEX IF NOT EXISTS idx_share_links_user_id ON conversation_share_links(user_id)",
		"CREATE INDEX IF NOT EXISTS idx_share_links_expires_at ON conversation_share_links(expires_at)",
		"CREATE INDEX IF NOT EXISTS idx_invite_codes_expires_at ON invite_codes(expires_at)",
		"CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by ON invite_codes(used_by)",
	];

	for (const sql of indexStatements) {
		await db.prepare(sql).run();
	}
}

async function runAdminBootstrap(db: D1Database, env?: Env) {
	const raw = (env ?? {}) as Record<string, unknown>;
	const adminUsername = resolveString(raw.ADMIN_USERNAME)?.trim() || "admin";
	const adminPassword =
		resolveString(raw.ADMIN_PASSWORD)?.trim() ||
		resolveString(raw.AUTH_PASSWORD)?.trim() ||
		"";
	if (!adminPassword) return;

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
			.prepare("SELECT id FROM projects WHERE user_id = ? AND is_default = 1 LIMIT 1")
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

async function ensureLegacyDefaultProject(db: D1Database) {
	await db
		.prepare(
			`INSERT OR IGNORE INTO projects (id, user_id, name, description, is_default, created_at, updated_at)
			VALUES ('default', 'legacy', '默认项目', '默认工作区', 1, ?, ?)`,
		)
		.bind(Date.now(), Date.now())
		.run();
}

function resolveString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

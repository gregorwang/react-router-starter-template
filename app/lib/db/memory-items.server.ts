/**
 * Structured Memory Items — L2 layer of the memory model.
 *
 * Stores user preferences, constraints, facts, decisions, and other
 * long-term knowledge items. These are injected into the prompt as
 * the 【长期记忆】 block via the Prompt Builder.
 *
 * Items can be:
 * - **auto**: extracted by the LLM from conversation (P5 background task)
 * - **manual**: created/edited by the user via the memory API
 */

export type MemoryCategory =
	| "preference"
	| "constraint"
	| "fact"
	| "decision"
	| "todo"
	| "custom";

export interface MemoryItem {
	id: string;
	userId: string;
	conversationId?: string;
	category: MemoryCategory;
	content: string;
	source: "auto" | "manual";
	importance: number;
	isActive: boolean;
	createdAt: number;
	updatedAt: number;
	expiresAt?: number;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function getActiveMemoryItems(
	db: D1Database,
	userId: string,
	limit = 50,
): Promise<MemoryItem[]> {
	const now = Date.now();
	const { results } = await db
		.prepare(
			`SELECT * FROM memory_items
			WHERE user_id = ? AND is_active = 1
			  AND (expires_at IS NULL OR expires_at > ?)
			ORDER BY importance DESC, updated_at DESC
			LIMIT ?`,
		)
		.bind(userId, now, limit)
		.all();

	return (results || []).map(mapMemoryItemRow);
}

export async function getMemoryItems(
	db: D1Database,
	userId: string,
	options?: {
		category?: MemoryCategory;
		includeInactive?: boolean;
		limit?: number;
	},
): Promise<MemoryItem[]> {
	const limit = options?.limit ?? 100;
	const includeInactive = options?.includeInactive ?? false;

	let sql = `SELECT * FROM memory_items WHERE user_id = ?`;
	const bindings: unknown[] = [userId];

	if (!includeInactive) {
		sql += ` AND is_active = 1`;
	}
	if (options?.category) {
		sql += ` AND category = ?`;
		bindings.push(options.category);
	}

	sql += ` ORDER BY importance DESC, updated_at DESC LIMIT ?`;
	bindings.push(limit);

	const stmt = db.prepare(sql);
	const bound = bindings.reduce<D1PreparedStatement>(
		(s, v, i) => {
			// D1 .bind() needs all params at once
			return s;
		},
		stmt,
	);
	// Use dynamic bind with all params
	const { results } = await stmt.bind(...bindings).all();

	return (results || []).map(mapMemoryItemRow);
}

export async function createMemoryItem(
	db: D1Database,
	item: Omit<MemoryItem, "createdAt" | "updatedAt">,
): Promise<void> {
	const now = Date.now();
	await db
		.prepare(
			`INSERT INTO memory_items
				(id, user_id, conversation_id, category, content, source, importance, is_active, created_at, updated_at, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			item.id,
			item.userId,
			item.conversationId ?? null,
			item.category,
			item.content,
			item.source,
			item.importance,
			item.isActive ? 1 : 0,
			now,
			now,
			item.expiresAt ?? null,
		)
		.run();
}

export async function updateMemoryItem(
	db: D1Database,
	userId: string,
	id: string,
	updates: {
		content?: string;
		category?: MemoryCategory;
		importance?: number;
		isActive?: boolean;
		expiresAt?: number | null;
	},
): Promise<boolean> {
	const now = Date.now();
	const setClauses: string[] = ["updated_at = ?"];
	const bindings: unknown[] = [now];

	if (updates.content !== undefined) {
		setClauses.push("content = ?");
		bindings.push(updates.content);
	}
	if (updates.category !== undefined) {
		setClauses.push("category = ?");
		bindings.push(updates.category);
	}
	if (updates.importance !== undefined) {
		setClauses.push("importance = ?");
		bindings.push(updates.importance);
	}
	if (updates.isActive !== undefined) {
		setClauses.push("is_active = ?");
		bindings.push(updates.isActive ? 1 : 0);
	}
	if (updates.expiresAt !== undefined) {
		setClauses.push("expires_at = ?");
		bindings.push(updates.expiresAt);
	}

	bindings.push(id, userId);

	const result = await db
		.prepare(
			`UPDATE memory_items SET ${setClauses.join(", ")} WHERE id = ? AND user_id = ?`,
		)
		.bind(...bindings)
		.run();

	return (result.meta?.rows_written ?? 0) > 0;
}

export async function deleteMemoryItem(
	db: D1Database,
	userId: string,
	id: string,
): Promise<boolean> {
	const result = await db
		.prepare(`DELETE FROM memory_items WHERE id = ? AND user_id = ?`)
		.bind(id, userId)
		.run();

	return (result.meta?.rows_written ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Format for prompt injection
// ---------------------------------------------------------------------------

/**
 * Format active memory items as text lines for the Prompt Builder's
 * structuredMemories parameter.
 */
export function formatMemoryItemsForPrompt(items: MemoryItem[]): string[] {
	const categoryLabels: Record<MemoryCategory, string> = {
		preference: "偏好",
		constraint: "约束",
		fact: "事实",
		decision: "决定",
		todo: "待办",
		custom: "备注",
	};

	return items.map((item) => {
		const label = categoryLabels[item.category] || item.category;
		return `[${label}] ${item.content}`;
	});
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function mapMemoryItemRow(row: any): MemoryItem {
	return {
		id: row.id,
		userId: row.user_id,
		conversationId: row.conversation_id ?? undefined,
		category: row.category as MemoryCategory,
		content: row.content,
		source: row.source as "auto" | "manual",
		importance: row.importance ?? 5,
		isActive: Boolean(row.is_active),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		expiresAt: row.expires_at ?? undefined,
	};
}

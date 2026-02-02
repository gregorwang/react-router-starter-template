import type { Conversation, Message } from "../llm/types";

// D1 Database interfaces
export interface DBConversation {
	id: string;
	project_id: string;
	title: string;
	provider: string;
	model: string;
	created_at: number;
	updated_at: number;
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
	projectId?: string,
): Promise<Conversation[]> {
	const baseQuery = `SELECT c.*,
			(SELECT json_group_array(
				json_object('id', m.id, 'role', m.role, 'content', m.content, 'meta', json(m.meta), 'timestamp', m.timestamp)
				ORDER BY m.timestamp
			) FROM messages m WHERE m.conversation_id = c.id) as messages
		FROM conversations c`;

	const statement = projectId
		? db.prepare(`${baseQuery} WHERE c.project_id = ? ORDER BY c.updated_at DESC`).bind(projectId)
		: db.prepare(`${baseQuery} ORDER BY c.updated_at DESC`);

	const { results } = await statement.all();

	return (results || []).map((row: any) => ({
		id: row.id,
		projectId: row.project_id,
		title: row.title,
		provider: row.provider,
		model: row.model,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		messages: JSON.parse(row.messages || "[]").map((message: any) => ({
			...message,
			meta:
				typeof message.meta === "string"
					? JSON.parse(message.meta || "null") ?? undefined
					: message.meta ?? undefined,
		})),
	}));
}

export async function getConversation(
	db: D1Database,
	id: string,
): Promise<Conversation | null> {
	const { results } = await db
		.prepare(
			`SELECT c.*,
				(SELECT json_group_array(
					json_object('id', m.id, 'role', m.role, 'content', m.content, 'meta', json(m.meta), 'timestamp', m.timestamp)
					ORDER BY m.timestamp
				) FROM messages m WHERE m.conversation_id = c.id) as messages
			FROM conversations c
			WHERE c.id = ?`,
		)
		.bind(id)
		.all();

	if (!results || results.length === 0) {
		return null;
	}

	const row = results[0] as any;
	return {
		id: row.id,
		projectId: row.project_id,
		title: row.title,
		provider: row.provider,
		model: row.model,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		messages: JSON.parse(row.messages || "[]").map((message: any) => ({
			...message,
			meta:
				typeof message.meta === "string"
					? JSON.parse(message.meta || "null") ?? undefined
					: message.meta ?? undefined,
		})),
	};
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
				`INSERT INTO conversations (id, project_id, title, provider, model, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				project_id = excluded.project_id,
				title = excluded.title,
				provider = excluded.provider,
				model = excluded.model,
				updated_at = excluded.updated_at`,
			)
			.bind(
				conversation.id,
				conversation.projectId ?? "default",
				conversation.title,
				conversation.provider,
				conversation.model,
				conversation.createdAt,
				conversation.updatedAt,
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
	await db.batch(statements);
}

export async function deleteConversation(db: D1Database, id: string): Promise<void> {
	// Messages will be deleted via CASCADE
	await db.prepare("DELETE FROM conversations WHERE id = ?").bind(id).run();
}

// Database initialization
export async function initDatabase(db: D1Database): Promise<void> {
	// Create conversations table
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS conversations (
				id TEXT PRIMARY KEY,
				project_id TEXT NOT NULL,
				title TEXT NOT NULL,
				provider TEXT NOT NULL,
				model TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
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
			"CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id)",
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS projects (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)`,
		)
		.run();

	// Best-effort migrations for existing schemas
	try {
		await db.prepare("ALTER TABLE conversations ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'").run();
	} catch {
		// Column already exists
	}

	try {
		await db.prepare("ALTER TABLE messages ADD COLUMN meta TEXT").run();
	} catch {
		// Column already exists
	}

	// Ensure default project exists
	await db
		.prepare(
			`INSERT OR IGNORE INTO projects (id, name, description, created_at, updated_at)
			VALUES ('default', '模型选择', '默认工作区', ?, ?)`,
		)
		.bind(Date.now(), Date.now())
		.run();
}

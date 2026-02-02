import type { Conversation, Message } from "../llm/types";

// D1 Database interfaces
export interface DBConversation {
	id: string;
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
	timestamp: number;
}

// Server-side database operations
export async function getConversations(db: D1Database): Promise<Conversation[]> {
	const { results } = await db
		.prepare(
			`SELECT c.*,
				(SELECT json_group_array(
					json_object('id', m.id, 'role', m.role, 'content', m.content, 'timestamp', m.timestamp)
					ORDER BY m.timestamp
				) FROM messages m WHERE m.conversation_id = c.id) as messages
			FROM conversations c
			ORDER BY c.updated_at DESC`,
		)
		.all();

	return (results || []).map((row: any) => ({
		id: row.id,
		title: row.title,
		provider: row.provider,
		model: row.model,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		messages: JSON.parse(row.messages || "[]"),
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
					json_object('id', m.id, 'role', m.role, 'content', m.content, 'timestamp', m.timestamp)
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
		title: row.title,
		provider: row.provider,
		model: row.model,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		messages: JSON.parse(row.messages || "[]"),
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
				`INSERT INTO conversations (id, title, provider, model, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				title = excluded.title,
				provider = excluded.provider,
				model = excluded.model,
				updated_at = excluded.updated_at`,
			)
			.bind(
				conversation.id,
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
					`INSERT INTO messages (id, conversation_id, role, content, timestamp)
				VALUES (?, ?, ?, ?, ?)`,
				)
				.bind(message.id, conversation.id, message.role, message.content, message.timestamp),
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
				timestamp INTEGER NOT NULL,
				FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
			)`,
		)
		.run();
}

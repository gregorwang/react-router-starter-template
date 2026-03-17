/**
 * Episodic Memory — Vectorize-backed semantic retrieval for conversation history.
 *
 * Uses Cloudflare Vectorize to store and retrieve conversation snippets
 * by semantic similarity (embeddings). This is the L3 layer of the memory model.
 *
 * ## Vectorize setup
 *
 * Before using this module, you must create a Vectorize index:
 *
 * ```bash
 * wrangler vectorize create chat-memory --dimensions 768 --metric cosine
 * ```
 *
 * And add the binding to `wrangler.json` under `vectorize`:
 *
 * ```json
 * { "binding": "VECTORIZE", "index_name": "chat-memory" }
 * ```
 *
 * ## Embedding model
 *
 * Uses Workers AI `@cf/baai/bge-base-en-v1.5` (768d, supports Chinese reasonably).
 * Can be replaced via `EMBEDDING_MODEL` env var when better models are available.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EpisodicMemoryEntry {
	/** Vectorize vector ID — `{conversationId}:{messageId}` */
	id: string;
	conversationId: string;
	userId: string;
	messageId: string;
	role: "user" | "assistant";
	/** Content snippet (stored as metadata, capped at 2000 chars) */
	snippet: string;
	/** Unix timestamp (ms) */
	timestamp: number;
}

export interface EpisodicMemorySearchResult {
	id: string;
	score: number;
	snippet: string;
	conversationId: string;
	role: string;
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const SNIPPET_MAX_CHARS = 2000;

/**
 * Generate embedding vector for a text snippet using Workers AI.
 */
export async function generateEmbedding(
	ai: Ai,
	text: string,
	model?: string,
): Promise<number[]> {
	const clippedText = text.length > SNIPPET_MAX_CHARS
		? text.slice(0, SNIPPET_MAX_CHARS)
		: text;

	const result = (await ai.run((model || DEFAULT_EMBEDDING_MODEL) as any, {
		text: [clippedText],
	})) as { data?: number[][] };

	if (!result.data || result.data.length === 0) {
		throw new Error("Failed to generate embedding: empty result");
	}
	return result.data[0];
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

/**
 * Upsert a conversation message into Vectorize for later semantic retrieval.
 */
export async function upsertEpisodicMemory(options: {
	vectorize: VectorizeIndex;
	ai: Ai;
	entry: EpisodicMemoryEntry;
	embeddingModel?: string;
}): Promise<void> {
	const { vectorize, ai, entry, embeddingModel } = options;
	const vector = await generateEmbedding(ai, entry.snippet, embeddingModel);

	await vectorize.upsert([
		{
			id: entry.id,
			values: vector,
			metadata: {
				conversationId: entry.conversationId,
				userId: entry.userId,
				messageId: entry.messageId,
				role: entry.role,
				snippet: entry.snippet.slice(0, SNIPPET_MAX_CHARS),
				timestamp: entry.timestamp,
			},
		},
	]);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search for semantically similar conversation snippets.
 *
 * @param query - The user's current question / context
 * @param userId - Strict filter to prevent cross-user data leaks
 * @param topK - Number of results to return (default: 5)
 * @param excludeConversationId - Optionally exclude the current conversation
 *        (to avoid retrieving the same conversation's recent turns)
 */
export async function searchEpisodicMemory(options: {
	vectorize: VectorizeIndex;
	ai: Ai;
	query: string;
	userId: string;
	topK?: number;
	excludeConversationId?: string;
	embeddingModel?: string;
}): Promise<EpisodicMemorySearchResult[]> {
	const { vectorize, ai, query, userId, topK = 5, excludeConversationId, embeddingModel } = options;
	const queryVector = await generateEmbedding(ai, query, embeddingModel);

	const filter: VectorizeVectorMetadataFilter = { userId };
	if (excludeConversationId) {
		// Vectorize filter format: exclude specific conversation
		// Note: Vectorize metadata filtering may have limited operators;
		// if $ne is not available, we filter client-side below.
	}

	const results = await vectorize.query(queryVector, {
		topK: Math.min(topK * 2, 20), // over-fetch to compensate for client-side filtering
		returnMetadata: "all",
		filter,
	});

	let matches = (results.matches || [])
		.filter((match) => match.metadata)
		.map((match) => ({
			id: match.id,
			score: match.score,
			snippet: String(match.metadata!.snippet || ""),
			conversationId: String(match.metadata!.conversationId || ""),
			role: String(match.metadata!.role || "unknown"),
			timestamp: Number(match.metadata!.timestamp || 0),
		}));

	// Client-side filter for excludeConversationId
	if (excludeConversationId) {
		matches = matches.filter((m) => m.conversationId !== excludeConversationId);
	}

	return matches.slice(0, topK);
}

// ---------------------------------------------------------------------------
// Batch upsert helper (for queue processing)
// ---------------------------------------------------------------------------

/**
 * Create an EpisodicMemoryEntry from a conversation message.
 */
export function createEpisodicMemoryEntry(options: {
	conversationId: string;
	userId: string;
	messageId: string;
	role: "user" | "assistant";
	content: string;
	timestamp: number;
}): EpisodicMemoryEntry {
	return {
		id: `${options.conversationId}:${options.messageId}`,
		conversationId: options.conversationId,
		userId: options.userId,
		messageId: options.messageId,
		role: options.role,
		snippet: options.content.slice(0, SNIPPET_MAX_CHARS),
		timestamp: options.timestamp,
	};
}

// ---------------------------------------------------------------------------
// Delete (for conversation deletion cascading)
// ---------------------------------------------------------------------------

/**
 * Delete all episodic memory vectors for a conversation.
 *
 * Note: Vectorize `deleteByMetadataFilter` may not be available;
 * this requires knowing all vector IDs. For now, this is a best-effort
 * implementation that relies on the caller providing IDs.
 */
export async function deleteEpisodicMemories(
	vectorize: VectorizeIndex,
	vectorIds: string[],
): Promise<void> {
	if (vectorIds.length === 0) return;
	// Vectorize supports batch delete by IDs
	await vectorize.deleteByIds(vectorIds);
}

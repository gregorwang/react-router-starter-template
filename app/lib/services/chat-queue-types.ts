/**
 * Chat Queue Job Types — discriminated union for all background tasks
 * processed via the CHAT_SUMMARY_QUEUE / CHAT_QUEUE queue binding.
 *
 * ## Usage
 *
 * Any new background task type should be added here.
 * The queue handler in `workers/app.ts` uses `job.type` to route
 * to the appropriate processor function.
 */

import type { ChatSummaryQueueJob } from "./chat-summary-queue.server";

// ---------------------------------------------------------------------------
// Future task types (P3, P5 will add concrete processors)
// ---------------------------------------------------------------------------

export interface ChatEmbeddingQueueJob {
	type: "chat_embedding";
	userId: string;
	conversationId: string;
	assistantMessageId: string;
	enqueuedAt: number;
}

export interface ChatMemoryExtractionQueueJob {
	type: "chat_memory_extraction";
	userId: string;
	conversationId: string;
	assistantMessageId: string;
	enqueuedAt: number;
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type ChatQueueJob =
	| ChatSummaryQueueJob
	| ChatEmbeddingQueueJob
	| ChatMemoryExtractionQueueJob;

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export function isChatQueueJob(value: unknown): value is ChatQueueJob {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { type?: string };
	return (
		candidate.type === "chat_summary" ||
		candidate.type === "chat_embedding" ||
		candidate.type === "chat_memory_extraction"
	);
}

export async function enqueueChatQueueJob(
	queue: Queue<ChatQueueJob> | undefined,
	job: ChatQueueJob,
) {
	if (!queue) return false;
	await queue.send(job);
	return true;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function trimRequired(value: string) {
	return value.trim();
}

export function createChatEmbeddingQueueJob(input: {
	userId: string;
	conversationId: string;
	assistantMessageId: string;
	enqueuedAt?: number;
}): ChatEmbeddingQueueJob {
	return {
		type: "chat_embedding",
		userId: trimRequired(input.userId),
		conversationId: trimRequired(input.conversationId),
		assistantMessageId: trimRequired(input.assistantMessageId),
		enqueuedAt:
			typeof input.enqueuedAt === "number" && Number.isFinite(input.enqueuedAt)
				? input.enqueuedAt
				: Date.now(),
	};
}

export function createChatMemoryExtractionQueueJob(input: {
	userId: string;
	conversationId: string;
	assistantMessageId: string;
	enqueuedAt?: number;
}): ChatMemoryExtractionQueueJob {
	return {
		type: "chat_memory_extraction",
		userId: trimRequired(input.userId),
		conversationId: trimRequired(input.conversationId),
		assistantMessageId: trimRequired(input.assistantMessageId),
		enqueuedAt:
			typeof input.enqueuedAt === "number" && Number.isFinite(input.enqueuedAt)
				? input.enqueuedAt
				: Date.now(),
	};
}

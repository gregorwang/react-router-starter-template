import { getMessagesInActiveContext, isChatTurnMessage } from "../chat/context-boundary";
import { invalidateConversationCaches } from "../cache/conversation-index.server";
import { getConversation, updateConversationSummary } from "../db/conversations.server";
import { summarizeConversation } from "../llm/summary.server";
import {
	applyConversationSessionState,
	resolveConversationSessionState,
} from "./chat-session-state.server";

export interface ChatSummaryQueueJob {
	type: "chat_summary";
	userId: string;
	conversationId: string;
	assistantMessageId: string;
	enqueuedAt: number;
}

export type ChatSummaryQueueResult =
	| { status: "conversation_missing" }
	| { status: "turn_not_visible" }
	| { status: "no_messages" }
	| { status: "up_to_date" }
	| { status: "summary_empty" }
	| { status: "updated"; summaryMessageCount: number; newMessagesCount: number };

function trimRequired(value: string) {
	return value.trim();
}

export function createChatSummaryQueueJob(input: {
	userId: string;
	conversationId: string;
	assistantMessageId: string;
	enqueuedAt?: number;
}): ChatSummaryQueueJob {
	return {
		type: "chat_summary",
		userId: trimRequired(input.userId),
		conversationId: trimRequired(input.conversationId),
		assistantMessageId: trimRequired(input.assistantMessageId),
		enqueuedAt:
			typeof input.enqueuedAt === "number" && Number.isFinite(input.enqueuedAt)
				? input.enqueuedAt
				: Date.now(),
	};
}

export function isChatSummaryQueueJob(value: unknown): value is ChatSummaryQueueJob {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<ChatSummaryQueueJob>;
	return (
		candidate.type === "chat_summary" &&
		typeof candidate.userId === "string" &&
		candidate.userId.trim().length > 0 &&
		typeof candidate.conversationId === "string" &&
		candidate.conversationId.trim().length > 0 &&
		typeof candidate.assistantMessageId === "string" &&
		candidate.assistantMessageId.trim().length > 0 &&
		typeof candidate.enqueuedAt === "number" &&
		Number.isFinite(candidate.enqueuedAt)
	);
}

export async function enqueueChatSummaryQueueJob(
	queue: Queue<ChatSummaryQueueJob> | undefined,
	job: ChatSummaryQueueJob,
) {
	if (!queue) return false;
	await queue.send(job);
	return true;
}

export async function processChatSummaryQueueJob(options: {
	env: Env;
	db: D1Database;
	job: ChatSummaryQueueJob;
}): Promise<ChatSummaryQueueResult> {
	const { env, db, job } = options;
	const conversation = await getConversation(db, job.userId, job.conversationId);
	if (!conversation) {
		return { status: "conversation_missing" };
	}

	const sessionState = await resolveConversationSessionState({
		env,
		userId: job.userId,
		conversation,
	});
	const conversationWithState = applyConversationSessionState(
		conversation,
		sessionState,
	);

	const activeMessages = getMessagesInActiveContext(conversationWithState.messages);
	const hasAssistantTurn = activeMessages.some(
		(message) => message.id === job.assistantMessageId && message.role === "assistant",
	);
	if (!hasAssistantTurn) {
		return { status: "turn_not_visible" };
	}

	const compactMessages = activeMessages
		.filter((message) => isChatTurnMessage(message))
		.map((message) => ({ role: message.role, content: message.content }));

	if (compactMessages.length === 0) {
		return { status: "no_messages" };
	}

	const baseSummary = conversationWithState.summary?.trim() || "";
	const summaryMessageCount = Math.max(
		0,
		Math.min(conversationWithState.summaryMessageCount ?? 0, compactMessages.length),
	);
	const newMessages = baseSummary
		? compactMessages.slice(summaryMessageCount)
		: compactMessages;

	if (baseSummary && newMessages.length === 0) {
		return { status: "up_to_date" };
	}

	const summary = await summarizeConversation({
		env,
		baseSummary,
		messages: newMessages.length > 0 ? newMessages : compactMessages,
	});
	const normalizedSummary = summary?.trim() || "";
	if (!normalizedSummary) {
		return { status: "summary_empty" };
	}

	const now = Date.now();
	const nextSummaryMessageCount = compactMessages.length;
	await updateConversationSummary(
		db,
		job.userId,
		job.conversationId,
		normalizedSummary,
		now,
		nextSummaryMessageCount,
	);
	await resolveConversationSessionState({
		env,
		userId: job.userId,
		conversation: conversationWithState,
		patch: {
			summary: normalizedSummary,
			summaryUpdatedAt: now,
			summaryMessageCount: nextSummaryMessageCount,
		},
	});

	if (env.SETTINGS_KV) {
		await invalidateConversationCaches(
			env.SETTINGS_KV,
			job.userId,
			conversationWithState.projectId,
		);
	}

	return {
		status: "updated",
		summaryMessageCount: nextSummaryMessageCount,
		newMessagesCount: newMessages.length,
	};
}

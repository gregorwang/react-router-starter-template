import { deriveConversationTitle } from "../llm/title.server";
import type { Attachment, LLMMessage, LLMProvider } from "../llm/types";
import { invalidateConversationCaches } from "../cache/conversation-index.server";
import { invalidateUsageStatsCache } from "../cache/usage-stats.server";
import {
	appendConversationMessages,
	getConversation,
} from "../db/conversations.server";
import { estimateUsage } from "./chat-action-guards.server";
import { collectSSEChatResult } from "./chat-stream.server";
import type { ConversationSessionState } from "./chat-session-state.shared";
import {
	createChatSummaryQueueJob,
	enqueueChatSummaryQueueJob,
	type ChatSummaryQueueJob,
} from "./chat-summary-queue.server";

export async function persistChatResult(options: {
	db: D1Database;
	kv?: KVNamespace;
	summaryQueue?: Queue<ChatSummaryQueueJob>;
	userId: string;
	conversationId: string;
	provider: LLMProvider;
	model: string;
	sessionState?: ConversationSessionState;
	userMessageId: string;
	assistantMessageId: string;
	requestMessages: LLMMessage[];
	inputMessages: LLMMessage[];
	storedAttachments?: Attachment[];
	saveStream: ReadableStream<Uint8Array>;
}) {
	const streamResult = await collectSSEChatResult(options.saveStream);
	const { fullContent, reasoning, credits, thinkingMs, searchMeta } = streamResult;
	let { usage } = streamResult;
	if (!usage) {
		usage = estimateUsage(options.requestMessages, fullContent);
	}

	const conversation = await getConversation(
		options.db,
		options.userId,
		options.conversationId,
	);
	if (!conversation) return;

	const lastMessage = options.inputMessages[options.inputMessages.length - 1];
	const attachmentsForMeta =
		options.storedAttachments && options.storedAttachments.length > 0
			? options.storedAttachments
			: undefined;
	const userMessage = {
		id: options.userMessageId,
		role: "user" as const,
		content: lastMessage.content,
		timestamp: Date.now(),
		meta: {
			model: options.model,
			provider: options.provider,
			attachments: attachmentsForMeta,
		},
	};
	const assistantMessage = {
		id: options.assistantMessageId,
		role: "assistant" as const,
		content: fullContent,
		timestamp: Date.now(),
		meta: {
			model: options.model,
			provider: options.provider,
			usage,
			credits,
			reasoning: reasoning || undefined,
			thinkingMs,
			webSearch: searchMeta,
		},
	};

	let nextTitle: string | undefined;
	if (
		conversation.messages.length === 0 &&
		(conversation.title === "New Chat" || conversation.title === "新对话")
	) {
		nextTitle = deriveConversationTitle([{ role: "user", content: lastMessage.content }]);
	}

	await appendConversationMessages(
		options.db,
		options.userId,
		conversation.id,
		{
			updatedAt: Date.now(),
			title: nextTitle,
			provider: options.sessionState?.provider ?? options.provider,
			model: options.sessionState?.model ?? options.model,
			reasoningEffort: options.sessionState?.reasoningEffort,
			enableThinking: options.sessionState?.enableThinking,
			thinkingBudget: options.sessionState?.thinkingBudget,
			thinkingLevel: options.sessionState?.thinkingLevel,
			outputTokens: options.sessionState?.outputTokens,
			outputEffort: options.sessionState?.outputEffort,
			webSearch: options.sessionState?.webSearch,
			xaiSearchMode: options.sessionState?.xaiSearchMode,
			enableTools: options.sessionState?.enableTools,
		},
		[userMessage, assistantMessage],
	);

	if (options.kv) {
		await Promise.all([
			invalidateConversationCaches(options.kv, options.userId, conversation.projectId),
			invalidateUsageStatsCache(options.kv, options.userId),
		]);
	}

	try {
		await enqueueChatSummaryQueueJob(
			options.summaryQueue,
			createChatSummaryQueueJob({
				userId: options.userId,
				conversationId: options.conversationId,
				assistantMessageId: options.assistantMessageId,
			}),
		);
	} catch (error) {
		console.error("[chat-summary-queue] failed to enqueue summary job", error);
	}
}

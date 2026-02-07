import type { Route } from "./+types/conversations.fork";
import { invalidateConversationCaches } from "../lib/cache/conversation-index.server";
import { invalidateUsageStatsCache } from "../lib/cache/usage-stats.server";
import { getConversation, saveConversation } from "../lib/db/conversations.server";
import type { Message } from "../lib/llm/types";
import { requireAuth } from "../lib/auth.server";
import {
	applyConversationSessionState,
	resolveConversationSessionState,
} from "../lib/services/chat-session-state.server";

const DEFAULT_FORK_SUFFIX = " (Branch)";
const MAX_TITLE_LENGTH = 120;

type ForkPayload = {
	conversationId?: string;
	messageId?: string;
	title?: string;
};

function resolveForkTitle(sourceTitle: string, customTitle?: string) {
	const normalized = (customTitle || "").trim();
	if (normalized) {
		return normalized.slice(0, MAX_TITLE_LENGTH);
	}
	const fallback = `${sourceTitle || "新对话"}${DEFAULT_FORK_SUFFIX}`;
	return fallback.slice(0, MAX_TITLE_LENGTH);
}

function cloneMessagesUntil(messages: Message[], endIndex: number): Message[] {
	return messages.slice(0, endIndex + 1).map((message) => ({
		...message,
		id: crypto.randomUUID(),
		meta: message.meta ? { ...message.meta } : undefined,
	}));
}

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	let payload: ForkPayload = {};
	if (request.headers.get("Content-Type")?.includes("application/json")) {
		try {
			payload = (await request.json()) as ForkPayload;
		} catch {
			return new Response("Invalid JSON", { status: 400 });
		}
	} else {
		const formData = await request.formData();
		payload.conversationId = (formData.get("conversationId") as string | null) || undefined;
		payload.messageId = (formData.get("messageId") as string | null) || undefined;
		payload.title = (formData.get("title") as string | null) || undefined;
	}

	const sourceConversationId = payload.conversationId?.trim();
	const sourceMessageId = payload.messageId?.trim();
	if (!sourceConversationId || !sourceMessageId) {
		return new Response("Missing conversationId or messageId", { status: 400 });
	}

	const sourceConversation = await getConversation(
		context.db,
		user.id,
		sourceConversationId,
	);
	if (!sourceConversation) {
		return new Response("Conversation not found", { status: 404 });
	}
	const sourceSession = await resolveConversationSessionState({
		env: context.cloudflare.env,
		userId: user.id,
		conversation: sourceConversation,
	});
	const sourceConversationWithState = applyConversationSessionState(
		sourceConversation,
		sourceSession,
	);

	const messageIndex = sourceConversationWithState.messages.findIndex(
		(message) => message.id === sourceMessageId,
	);
	if (messageIndex < 0) {
		return new Response("Message not found", { status: 404 });
	}
	const sourceMessage = sourceConversationWithState.messages[messageIndex];

	const forkedHistory = cloneMessagesUntil(sourceConversationWithState.messages, messageIndex);
	const now = Date.now();
	const forkedAt = sourceMessage.timestamp || now;
	const forkedConversation = {
		id: crypto.randomUUID(),
		userId: user.id,
		projectId: sourceConversationWithState.projectId,
		title: resolveForkTitle(sourceConversationWithState.title, payload.title),
		provider: sourceConversationWithState.provider,
		model: sourceConversationWithState.model,
		forkedFromConversationId: sourceConversationWithState.id,
		forkedFromMessageId: sourceMessageId,
		forkedAt,
		createdAt: now,
		updatedAt: now,
		summary: sourceConversationWithState.summary,
		summaryUpdatedAt: sourceConversationWithState.summaryUpdatedAt,
		summaryMessageCount: sourceConversationWithState.summaryMessageCount,
		reasoningEffort: sourceConversationWithState.reasoningEffort,
		enableThinking: sourceConversationWithState.enableThinking,
		thinkingBudget: sourceConversationWithState.thinkingBudget,
		thinkingLevel: sourceConversationWithState.thinkingLevel,
		outputTokens: sourceConversationWithState.outputTokens,
		outputEffort: sourceConversationWithState.outputEffort,
		webSearch: sourceConversationWithState.webSearch,
		xaiSearchMode: sourceConversationWithState.xaiSearchMode,
		enableTools: sourceConversationWithState.enableTools,
		messages: forkedHistory,
	} as const;

	await saveConversation(context.db, forkedConversation);
	await resolveConversationSessionState({
		env: context.cloudflare.env,
		userId: user.id,
		conversation: forkedConversation,
	});

	const kv = context.cloudflare.env.SETTINGS_KV;
	if (kv) {
		await Promise.all([
			invalidateConversationCaches(
				kv,
				user.id,
				forkedConversation.projectId,
			),
			invalidateUsageStatsCache(kv, user.id),
		]);
	}

	return Response.json(
		{
			ok: true,
			conversationId: forkedConversation.id,
			projectId: forkedConversation.projectId,
			forkedFromConversationId: sourceConversationWithState.id,
			forkedFromMessageId: sourceMessageId,
			forkedAt,
			importedMessages: forkedHistory.length,
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

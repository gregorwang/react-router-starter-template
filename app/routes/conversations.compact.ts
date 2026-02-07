import type { Route } from "./+types/conversations.compact";
import { getConversation, updateConversationSummary } from "../lib/db/conversations.server";
import { summarizeConversation } from "../lib/llm/summary.server";
import { requireAuth } from "../lib/auth.server";
import {
	getMessagesInActiveContext,
	isChatTurnMessage,
} from "../lib/chat/context-boundary";
import {
	applyConversationSessionState,
	resolveConversationSessionState,
} from "../lib/services/chat-session-state.server";

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	let conversationId: string | null = null;
	let payloadMessages:
		| Array<{
				role: string;
				content: string;
				meta?: {
					event?: { type?: string };
				};
		  }>
		| null = null;
	let payloadSummaryCount: number | null = null;
	const contentType = request.headers.get("Content-Type") || "";
	if (contentType.includes("application/json")) {
		const body = (await request.json()) as {
			conversationId?: string;
			messages?: Array<{
				role: string;
				content: string;
				meta?: { event?: { type?: string } };
			}>;
			summaryMessageCount?: number;
		};
		conversationId = body.conversationId?.trim() || null;
		payloadMessages = body.messages?.filter(Boolean) || null;
		payloadSummaryCount =
			typeof body.summaryMessageCount === "number"
				? body.summaryMessageCount
				: null;
	} else {
		const formData = await request.formData();
		conversationId = (formData.get("conversationId") as string | null)?.trim() || null;
	}

	if (!conversationId) {
		return new Response("Missing conversationId", { status: 400 });
	}

	const conversation = await getConversation(context.db, user.id, conversationId);
	if (!conversation) {
		return new Response("Conversation not found", { status: 404 });
	}
	const sessionState = await resolveConversationSessionState({
		env: context.cloudflare.env,
		userId: user.id,
		conversation,
	});
	const conversationWithState = applyConversationSessionState(
		conversation,
		sessionState,
	);

	const messagesSource = payloadMessages || conversationWithState.messages;
	const activeMessages = getMessagesInActiveContext(messagesSource);
	const compactMessages = activeMessages.filter(
		(message): message is { role: "user" | "assistant"; content: string } =>
			isChatTurnMessage(message),
	);
	if (!compactMessages.length) {
		return new Response("No messages to compact", { status: 400 });
	}

	const env = context.cloudflare.env;
	const summaryProvider = (env.SUMMARY_PROVIDER || "").toLowerCase();
	const wantsPoe = summaryProvider === "poe" || (!summaryProvider && env.POE_API_KEY);
	if (wantsPoe && !env.POE_API_KEY) {
		return new Response("POE_API_KEY not configured", { status: 500 });
	}
	if (!wantsPoe && !env.AI) {
		return new Response("Workers AI binding not configured", { status: 500 });
	}

	const now = Date.now();
	const baseSummary = conversationWithState.summary?.trim() || "";
	const startIndex = baseSummary
		? Math.max(
				0,
				typeof payloadSummaryCount === "number"
					? payloadSummaryCount
					: conversationWithState.summaryMessageCount ?? 0,
			)
		: 0;
	const boundedStartIndex = Math.min(startIndex, compactMessages.length);
	const newMessages = compactMessages.slice(boundedStartIndex);

	if (!newMessages.length && baseSummary) {
		return Response.json(
			{
				ok: true,
				summary: baseSummary,
				summaryUpdatedAt: conversation.summaryUpdatedAt ?? now,
				summaryMessageCount:
					conversation.summaryMessageCount ?? compactMessages.length,
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	}

	let archiveKey: string | undefined;
	if (env.CHAT_ARCHIVE) {
		const archiveBody = JSON.stringify(
			{
				...conversationWithState,
				messages: messagesSource,
				updatedAt: now,
			},
			null,
			2,
		);
		archiveKey = `conversations/${user.id}/${conversationId}/compact-${now}.json`;
		await env.CHAT_ARCHIVE.put(archiveKey, archiveBody, {
			httpMetadata: { contentType: "application/json" },
		});
	}

	const summary = await summarizeConversation({
		env,
		baseSummary,
		messages: newMessages.length ? newMessages : compactMessages,
	});

	if (!summary) {
		return new Response("Failed to generate summary", { status: 500 });
	}

	const summaryMessageCount = compactMessages.length;
	await updateConversationSummary(
		context.db,
		user.id,
		conversationId,
		summary,
		now,
		summaryMessageCount,
	);
	const nextState = await resolveConversationSessionState({
		env: context.cloudflare.env,
		userId: user.id,
		conversation: conversationWithState,
		patch: {
			summary,
			summaryUpdatedAt: now,
			summaryMessageCount,
		},
	});

	return Response.json(
		{
			ok: true,
			summary: nextState.summary,
			summaryUpdatedAt: nextState.summaryUpdatedAt,
			summaryMessageCount: nextState.summaryMessageCount,
			archiveKey,
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

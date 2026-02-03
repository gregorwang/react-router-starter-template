import type { Route } from "./+types/conversations.compact";
import { getConversation, updateConversationSummary } from "../lib/db/conversations.server";
import { summarizeConversation } from "../lib/llm/summary.server";
import { requireAuth } from "../lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
	await requireAuth(request, context.db);
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	let conversationId: string | null = null;
	let payloadMessages: Array<{ role: string; content: string }> | null = null;
	let payloadSummaryCount: number | null = null;
	const contentType = request.headers.get("Content-Type") || "";
	if (contentType.includes("application/json")) {
		const body = (await request.json()) as {
			conversationId?: string;
			messages?: Array<{ role: string; content: string }>;
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

	const conversation = await getConversation(context.db, conversationId);
	if (!conversation) {
		return new Response("Conversation not found", { status: 404 });
	}

	const messagesSource = payloadMessages || conversation.messages;
	if (!messagesSource.length) {
		return new Response("No messages to compact", { status: 400 });
	}

	const env = context.cloudflare.env;
	if (!env.AI) {
		return new Response("Workers AI binding not configured", { status: 500 });
	}

	const now = Date.now();
	const baseSummary = conversation.summary?.trim() || "";
	const startIndex = baseSummary
		? Math.max(
				0,
				typeof payloadSummaryCount === "number"
					? payloadSummaryCount
					: conversation.summaryMessageCount ?? 0,
			)
		: 0;
	const newMessages = messagesSource.slice(startIndex);

	if (!newMessages.length && baseSummary) {
		return Response.json(
			{
				ok: true,
				summary: baseSummary,
				summaryUpdatedAt: conversation.summaryUpdatedAt ?? now,
				summaryMessageCount:
					conversation.summaryMessageCount ?? messagesSource.length,
			},
			{ headers: { "Cache-Control": "no-store" } },
		);
	}

	let archiveKey: string | undefined;
	if (env.CHAT_ARCHIVE) {
		const archiveBody = JSON.stringify(
			{
				...conversation,
				messages: messagesSource,
				updatedAt: now,
			},
			null,
			2,
		);
		archiveKey = `conversations/${conversationId}/compact-${now}.json`;
		await env.CHAT_ARCHIVE.put(archiveKey, archiveBody, {
			httpMetadata: { contentType: "application/json" },
		});
	}

	const summary = await summarizeConversation({
		ai: env.AI,
		baseSummary,
		messages: newMessages.length ? newMessages : messagesSource,
	});

	if (!summary) {
		return new Response("Failed to generate summary", { status: 500 });
	}

	const summaryMessageCount = messagesSource.length;
	await updateConversationSummary(
		context.db,
		conversationId,
		summary,
		now,
		summaryMessageCount,
	);

	return Response.json(
		{
			ok: true,
			summary,
			summaryUpdatedAt: now,
			summaryMessageCount,
			archiveKey,
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}

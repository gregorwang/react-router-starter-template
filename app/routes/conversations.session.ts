import type { Route } from "./+types/conversations.session";
import { requireAuth } from "../lib/auth.server";
import {
	getConversation,
	updateConversationSessionSettings,
} from "../lib/db/conversations.server";
import { invalidateConversationCaches } from "../lib/cache/conversation-index.server";
import type { Conversation, LLMProvider } from "../lib/llm/types";
import { resolveConversationSessionState } from "../lib/services/chat-session-state.server";

type Payload = {
	conversationId?: string;
	projectId?: string;
	patch?: {
		projectId?: string;
		provider?: LLMProvider;
		model?: string;
		reasoningEffort?: "low" | "medium" | "high";
		enableThinking?: boolean;
		thinkingBudget?: number;
		thinkingLevel?: "low" | "medium" | "high";
		outputTokens?: number;
		outputEffort?: "low" | "medium" | "high" | "max";
		webSearch?: boolean;
		xaiSearchMode?: "x" | "web" | "both";
		enableTools?: boolean;
		clearSummary?: boolean;
	};
};

function buildPlaceholderConversation(
	userId: string,
	conversationId: string,
	payload: Payload,
): Conversation {
	const now = Date.now();
	const patch = payload.patch || {};
	return {
		id: conversationId,
		userId,
		projectId: patch.projectId || payload.projectId || "default",
		title: "新对话",
		provider: patch.provider || "poe",
		model: patch.model || "grok-4.1-fast-reasoning",
		createdAt: now,
		updatedAt: now,
		messages: [],
		isPersisted: false,
	};
}

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	if (request.method !== "POST" && request.method !== "PATCH") {
		return new Response("Method not allowed", { status: 405 });
	}

	let payload: Payload;
	try {
		payload = (await request.json()) as Payload;
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}

	const conversationId = payload.conversationId?.trim();
	if (!conversationId) {
		return new Response("Missing conversationId", { status: 400 });
	}

	const existingConversation = await getConversation(context.db, user.id, conversationId);
	const conversation =
		existingConversation ||
		buildPlaceholderConversation(user.id, conversationId, payload);
	const nextState = await resolveConversationSessionState({
		env: context.cloudflare.env,
		userId: user.id,
		conversation,
		patch: payload.patch || {},
	});

	if (existingConversation) {
		await updateConversationSessionSettings(context.db, user.id, conversationId, {
			updatedAt: Date.now(),
			projectId: nextState.projectId,
			provider: nextState.provider,
			model: nextState.model,
			reasoningEffort: nextState.reasoningEffort,
			enableThinking: nextState.enableThinking,
			thinkingBudget: nextState.thinkingBudget,
			thinkingLevel: nextState.thinkingLevel,
			outputTokens: nextState.outputTokens,
			outputEffort: nextState.outputEffort,
			webSearch: nextState.webSearch,
			xaiSearchMode: nextState.xaiSearchMode,
			enableTools: nextState.enableTools,
		});
		if (context.cloudflare.env.SETTINGS_KV) {
			await invalidateConversationCaches(
				context.cloudflare.env.SETTINGS_KV,
				user.id,
				existingConversation.projectId,
			);
			if (
				nextState.projectId &&
				existingConversation.projectId &&
				nextState.projectId !== existingConversation.projectId
			) {
				await invalidateConversationCaches(
					context.cloudflare.env.SETTINGS_KV,
					user.id,
					nextState.projectId,
				);
			}
		}
	}

	return Response.json(
		{
			ok: true,
			state: nextState,
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}


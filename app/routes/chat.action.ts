import type { Route } from "./+types/chat.action";
import { streamLLMFromServer } from "../lib/llm/llm-server";
import type { Attachment } from "../lib/llm/types";
import { getUserModelLimit } from "../lib/db/user-model-limits.server";
import { countModelCallsSince } from "../lib/db/user-usage.server";
import { requireAuth } from "../lib/auth.server";
import {
	CHAT_ACTION_MAX_BODY_BYTES,
	CHAT_MIN_CONTEXT_MESSAGES,
	CHAT_PROMPT_TOKEN_BUDGET,
	type ChatActionData,
	getMonthStartUtc,
	getWeekStartUtc,
	readJsonBodyWithLimit,
	toUserFacingError,
	validateChatActionData,
} from "../lib/services/chat-action-guards.server";
import {
	buildRequestMessages,
	resolveConversationForChat,
} from "../lib/services/chat-conversation.server";
import { persistAttachmentsToR2 } from "../lib/adapters/chat-media.server";
import { enforceRateLimit, resolveActorKey } from "../lib/services/chat-rate-limit.server";
import { persistChatResult } from "../lib/services/chat-persistence.server";
import {
	applyConversationSessionState,
	resolveConversationSessionState,
} from "../lib/services/chat-session-state.server";

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	try {
		let data: ChatActionData;
		const parsed = await readJsonBodyWithLimit<ChatActionData>(
			request,
			CHAT_ACTION_MAX_BODY_BYTES,
		);
		if (!parsed.ok) {
			return new Response(parsed.message, { status: parsed.status });
		}
		data = parsed.data;
		const validationError = validateChatActionData(data);
		if (validationError) {
			return new Response(validationError, { status: 400 });
		}

		const {
			conversationId,
			projectId,
			messages,
			messagesTrimmed,
			provider,
			model,
			userMessageId,
			assistantMessageId,
			reasoningEffort,
			enableThinking,
			thinkingBudget,
			thinkingLevel,
			outputTokens,
			outputEffort,
			webSearch,
			xaiSearchMode,
			enableTools,
		} = data;

		if (provider === "workers-ai") {
			return new Response(
				JSON.stringify({ error: "Workers AI 暂时不可用。" }),
				{
					status: 503,
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "no-store",
					},
				},
			);
		}

		if (user.role !== "admin") {
			const limit = await getUserModelLimit(context.db, user.id, provider, model);
			if (!limit || !limit.enabled) {
				return new Response(
					JSON.stringify({ error: "该模型未授权使用。" }),
					{
						status: 403,
						headers: {
							"Content-Type": "application/json",
							"Cache-Control": "no-store",
						},
					},
				);
			}

			const now = Date.now();
			if (typeof limit.weeklyLimit === "number") {
				const weekStart = getWeekStartUtc(now);
				const weekCalls = await countModelCallsSince(context.db, {
					userId: user.id,
					provider,
					model,
					startMs: weekStart,
				});
				if (weekCalls >= limit.weeklyLimit) {
					return new Response(
						JSON.stringify({ error: "本周该模型调用次数已用尽。" }),
						{
							status: 429,
							headers: {
								"Content-Type": "application/json",
								"Cache-Control": "no-store",
							},
						},
					);
				}
			}

			if (typeof limit.monthlyLimit === "number") {
				const monthStart = getMonthStartUtc(now);
				const monthCalls = await countModelCallsSince(context.db, {
					userId: user.id,
					provider,
					model,
					startMs: monthStart,
				});
				if (monthCalls >= limit.monthlyLimit) {
					return new Response(
						JSON.stringify({ error: "本月该模型调用次数已用尽。" }),
						{
							status: 429,
							headers: {
								"Content-Type": "application/json",
								"Cache-Control": "no-store",
							},
						},
					);
				}
			}
		}

		const actorKey = await resolveActorKey(request);
		const rateLimitResult = await enforceRateLimit(context.cloudflare.env, actorKey);
		if (!rateLimitResult.allowed) {
			return new Response(
				JSON.stringify({
					error: "Rate limit exceeded. Try again later.",
					retryAt: rateLimitResult.resetAt,
				}),
				{
					status: 429,
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "no-store",
					},
				},
			);
		}

		const conversationResolution = await resolveConversationForChat({
			db: context.db,
			userId: user.id,
			conversationId,
			projectId,
			provider,
			model,
		});
		if ("errorResponse" in conversationResolution) {
			return conversationResolution.errorResponse;
		}
		const existingConversation = conversationResolution.conversation;
		const sessionState = await resolveConversationSessionState({
			env: context.cloudflare.env,
			userId: user.id,
			conversation: existingConversation,
			patch: {
				projectId: projectId || existingConversation.projectId,
				provider,
				model,
				reasoningEffort,
				enableThinking,
				thinkingBudget,
				thinkingLevel,
				outputTokens,
				outputEffort,
				webSearch,
				xaiSearchMode,
				enableTools,
			},
		});
		const conversationForRequest = applyConversationSessionState(
			existingConversation,
			sessionState,
		);

		const requestMessages = buildRequestMessages({
			messages,
			messagesTrimmed,
			summary: conversationForRequest.summary,
			summaryMessageCount: conversationForRequest.summaryMessageCount,
			promptTokenBudget: CHAT_PROMPT_TOKEN_BUDGET,
			minContextMessages: CHAT_MIN_CONTEXT_MESSAGES,
		});

		const lastMessage = messages[messages.length - 1];
		let storedAttachments: Attachment[] | undefined;
		if (lastMessage?.attachments && lastMessage.attachments.length > 0) {
			storedAttachments = await persistAttachmentsToR2({
				env: context.cloudflare.env,
				userId: user.id,
				conversationId,
				attachments: lastMessage.attachments,
			});
		}

		// Start streaming LLM response
		const stream = await streamLLMFromServer(
			requestMessages,
			sessionState.provider,
			sessionState.model,
			context,
			{
			reasoningEffort: sessionState.reasoningEffort,
			enableThinking: sessionState.enableThinking,
			thinkingBudget: sessionState.thinkingBudget,
			thinkingLevel: sessionState.thinkingLevel,
			outputTokens: sessionState.outputTokens,
			outputEffort: sessionState.outputEffort,
			webSearch: sessionState.webSearch,
			xaiSearchMode: sessionState.xaiSearchMode,
			enableTools: sessionState.enableTools,
			},
		);

		// Use waitUntil to save the conversation after stream completes
		const ctx = context.cloudflare.ctx;

		// Create a tee of the stream - one for the response, one for saving
		const [responseStream, saveStream] = stream.tee();

		// Save conversation in background
		ctx.waitUntil(
			persistChatResult({
				db: context.db,
				kv: context.cloudflare.env.SETTINGS_KV,
				userId: user.id,
				conversationId,
				provider: sessionState.provider,
				model: sessionState.model,
				userMessageId,
				assistantMessageId,
				requestMessages,
				inputMessages: messages,
				storedAttachments,
				sessionState,
				saveStream,
			}),
		);

		return new Response(responseStream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-store, no-cache, no-transform",
				"Connection": "keep-alive",
				"X-Accel-Buffering": "no",
			},
		});
	} catch (error) {
		console.error("Chat action error:", error);
		return new Response(
			JSON.stringify({
				error: error instanceof Error ? toUserFacingError(error.message) : "Unknown error",
			}),
			{
				status: 500,
				headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
			},
		);
	}
}

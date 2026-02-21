import { useCallback, useRef, useState } from "react";
import { useChat as useChatContext } from "../contexts/ChatContext";
import {
	getContextSegmentStartIndex,
	isChatTurnMessage,
} from "../lib/chat/context-boundary";
import { consumeSSEJson } from "../lib/utils/sse";
import { POLO_DEFAULT_OUTPUT_TOKENS } from "../lib/llm/defaults";

import type { Attachment, LLMMessage, Message } from "../lib/llm/types";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatPayloadMessage = LLMMessage;

export type ChatIssueCategory =
	| "none"
	| "network"
	| "rate_limit"
	| "auth_config"
	| "payload_context"
	| "upstream_model"
	| "server"
	| "cancelled"
	| "unknown";

export type ChatRequestPhase =
	| "sending"
	| "streaming"
	| "success"
	| "error"
	| "aborted";

export type SummaryInactiveReason =
	| "none"
	| "missing_summary"
	| "context_boundary";

export interface ChatRequestInsight {
	id: string;
	phase: ChatRequestPhase;
	category: ChatIssueCategory;
	conversationId: string;
	provider: string;
	model: string;
	startedAt: number;
	endedAt?: number;
	durationMs?: number;
	firstTokenMs?: number;
	contextMessageCount: number;
	payloadMessageCount: number;
	summaryActive: boolean;
	summaryInactiveReason: SummaryInactiveReason;
	summaryMessageCount: number;
	serverSummaryInjected?: boolean;
	serverRequestMessageCount?: number;
	trimmed: boolean;
	outputTokens?: number;
	httpStatus?: number;
	detail?: string;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
}

class ChatSendError extends Error {
	category: ChatIssueCategory;
	httpStatus?: number;
	detail?: string;

	constructor(
		message: string,
		options: {
			category: ChatIssueCategory;
			httpStatus?: number;
			detail?: string;
		},
	) {
		super(message);
		this.name = "ChatSendError";
		this.category = options.category;
		this.httpStatus = options.httpStatus;
		this.detail = options.detail;
	}
}

function classifyHttpFailure(status: number): ChatIssueCategory {
	if (status === 401 || status === 403) return "auth_config";
	if (status === 429) return "rate_limit";
	if (status === 400 || status === 413 || status === 422) return "payload_context";
	if (status >= 500) return "server";
	return "upstream_model";
}

function isLikelyNetworkError(error: unknown) {
	if (!(error instanceof Error)) return false;
	const text = `${error.name} ${error.message}`.toLowerCase();
	return (
		text.includes("failed to fetch") ||
		text.includes("networkerror") ||
		text.includes("load failed") ||
		text.includes("network request failed") ||
		text.includes("fetch failed")
	);
}

function classifyByMessage(message: string): ChatIssueCategory {
	const text = message.toLowerCase();
	if (
		text.includes("rate limit") ||
		text.includes("429") ||
		text.includes("调用次数已用尽") ||
		text.includes("too many requests")
	) {
		return "rate_limit";
	}
	if (
		text.includes("api key") ||
		text.includes("未授权") ||
		text.includes("无权") ||
		text.includes("forbidden") ||
		text.includes("not configured") ||
		text.includes("密钥未配置")
	) {
		return "auth_config";
	}
	if (
		text.includes("payload") ||
		text.includes("missing messages") ||
		text.includes("message too large") ||
		text.includes("invalid payload") ||
		text.includes("上下文") ||
		text.includes("token")
	) {
		return "payload_context";
	}
	if (text.includes("server error") || text.includes("service unavailable")) {
		return "server";
	}
	if (text.includes("api error") || text.includes("upstream")) {
		return "upstream_model";
	}
	return "unknown";
}

function resolveSendError(error: unknown): {
	category: ChatIssueCategory;
	httpStatus?: number;
	detail: string;
} {
	if (error instanceof ChatSendError) {
		return {
			category: error.category,
			httpStatus: error.httpStatus,
			detail: error.detail || error.message,
		};
	}
	if (isLikelyNetworkError(error)) {
		return {
			category: "network",
			detail:
				"网络连接失败或中断，请检查本地网络、代理或 Cloudflare 边缘连通性。",
		};
	}
	if (error instanceof Error) {
		return {
			category: classifyByMessage(error.message),
			detail: error.message,
		};
	}
	return {
		category: "unknown",
		detail: "未知错误",
	};
}

export function useChat() {
	const {
		currentConversation,
		startConversation: startConv,
		addMessage: addMsg,
		updateLastMessage: updateMsg,
		setLoading,
		setStreaming,
		setCurrentConversation,
		isStreaming,
	} = useChatContext();

	const abortControllerRef = useRef<AbortController | null>(null);
	const autoCompactInFlightRef = useRef(false);
	const autoTitleInFlightRef = useRef(false);
	const [requestInsight, setRequestInsight] = useState<ChatRequestInsight | null>(
		null,
	);

	const AUTO_COMPACT_MESSAGE_THRESHOLD = 24;
	const AUTO_COMPACT_TOKEN_THRESHOLD = 12000;
	const AUTO_COMPACT_MIN_NEW_MESSAGES = 6;
	const SUMMARY_CONTEXT_OVERLAP_MESSAGES = 4;
	const MAX_PAYLOAD_CHARS = 100000;
	const MIN_CONTEXT_MESSAGES = 2;
	const AUTO_TITLE_MAX_CHARS = 2000;

	const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));
	const estimateMessageTokens = (messages: ChatMessage[]) =>
		messages.reduce((total, msg) => total + estimateTokens(msg.content), 0);
	const estimateMessageChars = <T extends { content: string }>(messages: T[]) =>
		messages.reduce((total, msg) => total + msg.content.length, 0);
	const clipText = (text: string, maxChars: number) =>
		text.length > maxChars ? text.slice(0, maxChars) : text;

	const trimMessagesToCharBudget = <T extends { content: string }>(
		messages: T[],
		budgetChars: number,
		minKeep: number,
	) => {
		if (messages.length === 0) return messages;

		const keepMin = Math.min(minKeep, messages.length);
		let totalChars = 0;
		const kept: T[] = [];

		for (let i = messages.length - 1; i >= 0; i -= 1) {
			const message = messages[i];
			const messageChars = message.content.length;
			if (kept.length >= keepMin && totalChars + messageChars > budgetChars) {
				break;
			}
			kept.unshift(message);
			totalChars += messageChars;
		}

		if (kept.length === 0) {
			return messages.slice(-1);
		}

		return kept;
	};

	const maybeAutoCompact = useCallback(
		async (
			conversationId: string,
			messages: ChatMessage[],
			summaryMessageCount: number,
		) => {
			if (autoCompactInFlightRef.current) return;

			const totalMessages = messages.length;
			const totalTokens = estimateMessageTokens(messages);
			const newMessagesCount = Math.max(0, totalMessages - summaryMessageCount);

			const shouldCompact =
				(totalMessages >= AUTO_COMPACT_MESSAGE_THRESHOLD ||
					totalTokens >= AUTO_COMPACT_TOKEN_THRESHOLD) &&
				newMessagesCount >= AUTO_COMPACT_MIN_NEW_MESSAGES;

			if (!shouldCompact) return;

			autoCompactInFlightRef.current = true;
			try {
				const response = await fetch("/conversations/compact", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						conversationId,
						messages,
						summaryMessageCount,
					}),
				});
				if (!response.ok) {
					autoCompactInFlightRef.current = false;
					return;
				}
				const data = (await response.json()) as {
					summary?: string;
					summaryUpdatedAt?: number;
					summaryMessageCount?: number;
				};
				setCurrentConversation((prev) => {
					if (!prev || prev.id !== conversationId) return prev;
					return {
						...prev,
						summary: data.summary ?? prev.summary,
						summaryUpdatedAt: data.summaryUpdatedAt ?? prev.summaryUpdatedAt,
						summaryMessageCount:
							data.summaryMessageCount ?? prev.summaryMessageCount,
					};
				});
			} catch {
				// Ignore auto-compact failures
			} finally {
				autoCompactInFlightRef.current = false;
			}
		},
		[
			setCurrentConversation,
			AUTO_COMPACT_MESSAGE_THRESHOLD,
			AUTO_COMPACT_TOKEN_THRESHOLD,
			AUTO_COMPACT_MIN_NEW_MESSAGES,
		],
	);

	const maybeAutoTitle = useCallback(
		async (
			conversationId: string,
			messages: ChatMessage[],
			existingTitle?: string,
		) => {
			if (autoTitleInFlightRef.current) return;

			const normalizedTitle = (existingTitle || "").trim();
			if (normalizedTitle && normalizedTitle !== "新对话" && normalizedTitle !== "New Chat") {
				return;
			}

			autoTitleInFlightRef.current = true;
			try {
				const response = await fetch("/conversations/title", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						conversationId,
						messages,
						force: true,
					}),
				});
				if (!response.ok) {
					autoTitleInFlightRef.current = false;
					return;
				}
			const data = (await response.json()) as { title?: string };
			const nextTitle = data.title?.trim();
			if (nextTitle) {
				setCurrentConversation((prev) => {
					if (!prev || prev.id !== conversationId) return prev;
					return { ...prev, title: nextTitle };
				});
			}
			} catch {
				// Ignore auto-title failures
			} finally {
				autoTitleInFlightRef.current = false;
			}
		},
		[setCurrentConversation],
	);

	const startConversation = useCallback(() => {
		startConv();
	}, [startConv]);

	const sendMessage = useCallback(
		async (content: string, attachments?: Attachment[]) => {
			if (!currentConversation) {
				startConversation();
				return;
			}

			const hasAttachments = Boolean(attachments?.length);
			if (!content.trim() && !hasAttachments) {
				return;
			}

			setLoading(true);
			setStreaming(true);
			const requestStartedAt = Date.now();

			const conversationId = currentConversation.id;
			const contextStartIndex = getContextSegmentStartIndex(
				currentConversation.messages,
			);
			const hasContextBoundary = contextStartIndex > 0;
			const summaryMessageCount = hasContextBoundary
				? 0
				: currentConversation.summaryMessageCount ?? 0;
			const isFirstTurn = currentConversation.messages.length === 0;

			// Create message IDs upfront
			const userMessageId = crypto.randomUUID();
			const assistantMessageId = crypto.randomUUID();

			// Add user message
			const userMessage: Message = {
				id: userMessageId,
				role: "user",
				content,
				timestamp: Date.now(),
				meta: {
					model: currentConversation.model,
					provider: currentConversation.provider,
					attachments: attachments?.length ? attachments : undefined,
				},
			};
			addMsg(userMessage);

			// Create empty assistant message
			const assistantMessage: Message = {
				id: assistantMessageId,
				role: "assistant",
				content: "",
				timestamp: Date.now(),
				meta: {
					model: currentConversation.model,
					provider: currentConversation.provider,
				},
			};
			addMsg(assistantMessage);

			// Create abort controller for this request
			abortControllerRef.current = new AbortController();

			try {
				// Prepare messages for LLM (exclude the empty assistant message we just added)
				const segmentMessages = currentConversation.messages
					.concat([userMessage])
					.slice(contextStartIndex)
					.filter(isChatTurnMessage);
				const rawMessages: ChatMessage[] = segmentMessages.map((msg) => ({
					role: msg.role,
					content: msg.content,
				}));
				const rawPayloadMessages: ChatPayloadMessage[] = segmentMessages.map((msg) => {
					const attachments = msg.meta?.attachments?.filter((item) => item.data);
					return {
						role: msg.role,
						content: msg.content,
						attachments: attachments && attachments.length > 0 ? attachments : undefined,
					};
				});
				let payloadMessages = rawPayloadMessages;
				let messagesTrimmed = false;

				if (!hasContextBoundary && currentConversation.summary) {
					const startIndex = Math.min(summaryMessageCount, rawMessages.length);
					const overlapStartIndex = Math.max(
						0,
						startIndex - SUMMARY_CONTEXT_OVERLAP_MESSAGES,
					);
					payloadMessages = rawPayloadMessages.slice(overlapStartIndex);
					messagesTrimmed = overlapStartIndex > 0;
				}

				if (estimateMessageChars(payloadMessages) > MAX_PAYLOAD_CHARS) {
					payloadMessages = trimMessagesToCharBudget(
						payloadMessages,
						MAX_PAYLOAD_CHARS,
						MIN_CONTEXT_MESSAGES,
					);
					messagesTrimmed = true;
				}

				// Call the server action instead of client-side LLM APIs
				const provider = currentConversation.provider;
				const model = currentConversation.model;
				const defaultWebSearch =
					provider === "xai" || provider === "poloai" || model === "gemini-3-pro";
				const payloadWebSearch =
					currentConversation.webSearch ?? (defaultWebSearch ? true : undefined);
				const payloadXaiSearchMode =
					provider === "xai" ? (currentConversation.xaiSearchMode ?? "x") : undefined;
				const payloadOutputTokens =
					provider === "poloai"
						? (currentConversation.outputTokens ?? POLO_DEFAULT_OUTPUT_TOKENS)
						: currentConversation.outputTokens;
				const payloadEnableTools =
					provider === "poloai"
						? (currentConversation.enableTools ?? true)
						: currentConversation.enableTools;
				const summaryInactiveReason: SummaryInactiveReason = hasContextBoundary
					? "context_boundary"
					: currentConversation.summary
						? "none"
						: "missing_summary";
				const summaryActive = summaryInactiveReason === "none";
				const requestInsightId = crypto.randomUUID();

				setRequestInsight({
					id: requestInsightId,
					phase: "sending",
					category: "none",
					conversationId,
					provider,
					model,
					startedAt: requestStartedAt,
					contextMessageCount: rawMessages.length,
					payloadMessageCount: payloadMessages.length,
					summaryActive,
					summaryInactiveReason,
					summaryMessageCount,
					trimmed: messagesTrimmed,
					outputTokens: payloadOutputTokens,
				});

				const response = await fetch("/chat/action", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						conversationId: currentConversation.id,
						projectId: currentConversation.projectId,
						messages: payloadMessages,
						messagesTrimmed,
						provider: currentConversation.provider,
						model: currentConversation.model,
						userMessageId,
						assistantMessageId,
						reasoningEffort: currentConversation.reasoningEffort,
						enableThinking: currentConversation.enableThinking,
						thinkingBudget: currentConversation.thinkingBudget,
						thinkingLevel: currentConversation.thinkingLevel,
						outputTokens: payloadOutputTokens,
						outputEffort: currentConversation.outputEffort,
						webSearch: payloadWebSearch,
						xaiSearchMode: payloadXaiSearchMode,
						enableTools: payloadEnableTools,
					}),
					signal: abortControllerRef.current.signal,
				});

				if (!response.ok) {
					let message = `Server error: ${response.status}`;
					try {
						const errorBody = (await response.json()) as { error?: string };
						if (errorBody?.error) {
							message = errorBody.error;
						}
					} catch {
						// Ignore parse errors
					}
					throw new ChatSendError(message, {
						category: classifyHttpFailure(response.status),
						httpStatus: response.status,
						detail: message,
					});
				}
				const serverSummaryInjected = response.headers.get("X-Chat-Summary-Injected");
				const serverRequestMessageCount = response.headers.get(
					"X-Chat-Request-Message-Count",
				);
				setRequestInsight((prev) => {
					if (!prev || prev.id !== requestInsightId) return prev;
					return {
						...prev,
						serverSummaryInjected: serverSummaryInjected === "1",
						serverRequestMessageCount:
							serverRequestMessageCount && Number.isFinite(Number(serverRequestMessageCount))
								? Number(serverRequestMessageCount)
								: undefined,
					};
				});

				if (!response.body) {
					throw new ChatSendError("No response body received", {
						category: "server",
						detail: "服务端未返回可读取的流响应。",
					});
				}

				let fullContent = "";
				let reasoning = "";
				const meta: Message["meta"] = {
					model: currentConversation.model,
					provider: currentConversation.provider,
				};
				const startedAt = Date.now();
				let gotFirstToken = false;
				await consumeSSEJson<any>(response.body, async (parsed) => {
					if (parsed.type === "delta" && parsed.content) {
						fullContent += parsed.content;
						if (!gotFirstToken) {
							gotFirstToken = true;
							meta.thinkingMs = meta.thinkingMs ?? Date.now() - startedAt;
							setRequestInsight((prev) => {
								if (!prev || prev.id !== requestInsightId) return prev;
								return {
									...prev,
									phase: "streaming",
									firstTokenMs: Date.now() - requestStartedAt,
								};
							});
						}
						updateMsg({ content: fullContent, meta: { ...meta } });
					}

					if (parsed.type === "reasoning" && parsed.content) {
						reasoning += parsed.content;
						if (!gotFirstToken) {
							gotFirstToken = true;
							meta.thinkingMs = meta.thinkingMs ?? Date.now() - startedAt;
							setRequestInsight((prev) => {
								if (!prev || prev.id !== requestInsightId) return prev;
								return {
									...prev,
									phase: "streaming",
									firstTokenMs: Date.now() - requestStartedAt,
								};
							});
						}
						meta.reasoning = reasoning;
						updateMsg({ content: fullContent, meta: { ...meta } });
					}

					if (parsed.type === "usage" && parsed.usage) {
						meta.usage = parsed.usage;
						updateMsg({ content: fullContent, meta: { ...meta } });
					}

					if (parsed.type === "credits" && parsed.credits) {
						meta.credits = parsed.credits;
						updateMsg({ content: fullContent, meta: { ...meta } });
					}

					if (parsed.type === "meta" && parsed.meta) {
						if (parsed.meta.thinkingMs) {
							meta.thinkingMs = parsed.meta.thinkingMs;
						}
						if (typeof parsed.meta.stopReason === "string" && parsed.meta.stopReason.trim()) {
							meta.stopReason = parsed.meta.stopReason.trim();
						}
						updateMsg({ content: fullContent, meta: { ...meta } });
					}

					if (parsed.type === "search" && parsed.search) {
						meta.webSearch = parsed.search;
						updateMsg({ content: fullContent, meta: { ...meta } });
					}

					if (parsed.type === "error" && parsed.content) {
						throw new ChatSendError(parsed.content, {
							category: "upstream_model",
							detail: parsed.content,
						});
					}
				});

				if (!meta.usage) {
					const estimateTokens = (text: string) =>
						Math.max(1, Math.ceil(text.length / 4));
					const promptTokens = rawMessages.reduce(
						(total, msg) => total + estimateTokens(msg.content),
						0,
					);
					const completionTokens = estimateTokens(fullContent);
					meta.usage = {
						promptTokens,
						completionTokens,
						totalTokens: promptTokens + completionTokens,
						estimated: true,
					};
				}

				updateMsg({ content: fullContent, meta: { ...meta } });
				setRequestInsight((prev) => {
					if (!prev || prev.id !== requestInsightId) return prev;
					const endedAt = Date.now();
					return {
						...prev,
						phase: "success",
						category: "none",
						endedAt,
						durationMs: endedAt - requestStartedAt,
						promptTokens: meta.usage?.promptTokens,
						completionTokens: meta.usage?.completionTokens,
						totalTokens: meta.usage?.totalTokens,
					};
				});
				setCurrentConversation((prev) => {
					if (!prev || prev.id !== conversationId || prev.isPersisted) return prev;
					return { ...prev, isPersisted: true };
				});

				const assistantMessage = {
					role: "assistant" as const,
					content: fullContent,
				};
				const messagesForSummary = rawMessages.concat([assistantMessage]);
				void maybeAutoCompact(
					conversationId,
					messagesForSummary,
					summaryMessageCount,
				);

				if (isFirstTurn) {
					const titleMessages: ChatMessage[] = [
						{
							role: "user",
							content: clipText(userMessage.content, AUTO_TITLE_MAX_CHARS),
						},
						{
							role: "assistant",
							content: clipText(fullContent, AUTO_TITLE_MAX_CHARS),
						},
					];
					void maybeAutoTitle(conversationId, titleMessages, currentConversation.title);
				}
			} catch (error) {
				if ((error as Error).name === "AbortError") {
					console.log("Request aborted");
					setRequestInsight((prev) => {
						if (!prev || prev.conversationId !== conversationId) return prev;
						const endedAt = Date.now();
						return {
							...prev,
							phase: "aborted",
							category: "cancelled",
							detail: "已手动停止生成。",
							endedAt,
							durationMs: endedAt - requestStartedAt,
						};
					});
				} else {
					const resolved = resolveSendError(error);
					setRequestInsight((prev) => {
						if (!prev || prev.conversationId !== conversationId) return prev;
						const endedAt = Date.now();
						return {
							...prev,
							phase: "error",
							category: resolved.category,
							httpStatus: resolved.httpStatus,
							detail: resolved.detail,
							endedAt,
							durationMs: endedAt - requestStartedAt,
						};
					});
					console.error("Error sending message:", error);
					throw error;
				}
			} finally {
				setLoading(false);
				setStreaming(false);
				abortControllerRef.current = null;
			}
		},
		[
			currentConversation,
			startConversation,
			addMsg,
			updateMsg,
			setCurrentConversation,
			setLoading,
			setStreaming,
			maybeAutoCompact,
			maybeAutoTitle,
		],
	);

	const abortGeneration = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}
	}, []);

	const dismissRequestInsight = useCallback(() => {
		setRequestInsight(null);
	}, []);

	return {
		currentConversation,
		sendMessage,
		abortGeneration,
		startConversation,
		isStreaming,
		requestInsight,
		dismissRequestInsight,
	};
}

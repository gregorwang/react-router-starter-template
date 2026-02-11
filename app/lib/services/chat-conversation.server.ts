import type { Conversation, LLMMessage, LLMProvider } from "../llm/types";
import {
	getConversation,
	saveConversation,
} from "../db/conversations.server";
import { ensureDefaultProject, getProject } from "../db/projects.server";

const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));
const SUMMARY_CONTEXT_OVERLAP_MESSAGES = 4;

export async function resolveConversationForChat(options: {
	db: D1Database;
	userId: string;
	conversationId: string;
	projectId?: string;
	provider: LLMProvider;
	model: string;
}): Promise<{ conversation: Conversation } | { errorResponse: Response }> {
	let resolvedProjectId = options.projectId || undefined;
	if (resolvedProjectId) {
		const project = await getProject(options.db, resolvedProjectId, options.userId);
		if (!project) {
			resolvedProjectId = undefined;
		}
	}
	if (!resolvedProjectId) {
		const fallback = await ensureDefaultProject(options.db, options.userId);
		resolvedProjectId = fallback.id;
	}

	let existingConversation = await getConversation(
		options.db,
		options.userId,
		options.conversationId,
	);
	if (!existingConversation) {
		const { results: conflict } = await options.db
			.prepare("SELECT user_id FROM conversations WHERE id = ?")
			.bind(options.conversationId)
			.all();
		if (
			conflict &&
			conflict.length > 0 &&
			conflict[0]?.user_id !== options.userId
		) {
			return {
				errorResponse: new Response(JSON.stringify({ error: "无权访问该对话。" }), {
					status: 403,
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "no-store",
					},
				}),
			};
		}

		const now = Date.now();
		const nextConversation: Conversation = {
			id: options.conversationId,
			projectId: resolvedProjectId,
			title: "新对话",
			userId: options.userId,
			provider: options.provider,
			model: options.model,
			createdAt: now,
			updatedAt: now,
			messages: [],
		};
		await saveConversation(options.db, nextConversation);
		existingConversation = nextConversation;
	}

	return { conversation: existingConversation };
}

export function buildRequestMessages(options: {
	messages: LLMMessage[];
	messagesTrimmed?: boolean;
	summary?: string;
	summaryMessageCount?: number;
	promptTokenBudget: number;
	minContextMessages: number;
}): LLMMessage[] {
	const payloadTrimmed = options.messagesTrimmed === true;
	let contextMessages = options.messages;
	let summaryMessage: LLMMessage | null = null;

	if (options.summary) {
		let trimmed = options.messages;
		if (!payloadTrimmed) {
			const summaryMessageCount = Math.min(
				options.summaryMessageCount ?? 0,
				options.messages.length,
			);
			const startIndex =
				summaryMessageCount > 0
					? Math.max(0, summaryMessageCount - SUMMARY_CONTEXT_OVERLAP_MESSAGES)
					: 0;
			trimmed = options.messages.slice(startIndex);
		}
		if (trimmed.length === 0 && options.messages.length > 0) {
			trimmed = options.messages.slice(-Math.max(1, options.minContextMessages));
		}
		summaryMessage = {
			role: "system",
			content: `以下是对话摘要（用于继续上下文，不要逐字引用）：\n${options.summary}`,
		};
		contextMessages = trimmed;
	}

	const budget = Math.max(
		500,
		options.promptTokenBudget -
			(summaryMessage ? estimateTokens(summaryMessage.content) : 0),
	);
	const trimmedMessages = trimMessagesToBudget(
		contextMessages,
		budget,
		options.minContextMessages,
	);

	return summaryMessage ? [summaryMessage, ...trimmedMessages] : trimmedMessages;
}

function trimMessagesToBudget(
	messages: LLMMessage[],
	budget: number,
	minKeep: number,
) {
	if (messages.length === 0) return messages;

	const keepMin = Math.min(minKeep, messages.length);
	let totalTokens = 0;
	const kept: LLMMessage[] = [];

	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		const messageTokens = estimateTokens(message.content);
		if (kept.length >= keepMin && totalTokens + messageTokens > budget) {
			break;
		}
		kept.unshift(message);
		totalTokens += messageTokens;
	}

	if (kept.length === 0) {
		return messages.slice(-1);
	}

	return kept;
}

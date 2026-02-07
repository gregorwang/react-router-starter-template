import type { Conversation, LLMProvider, XAISearchMode } from "../llm/types";

const VALID_PROVIDERS = new Set<LLMProvider>([
	"deepseek",
	"xai",
	"poe",
	"workers-ai",
	"poloai",
	"ark",
]);
const VALID_REASONING_EFFORT = new Set(["low", "medium", "high"]);
const VALID_THINKING_LEVEL = new Set(["low", "medium", "high"]);
const VALID_OUTPUT_EFFORT = new Set(["low", "medium", "high", "max"]);
const VALID_XAI_SEARCH_MODE = new Set<XAISearchMode>(["x", "web", "both"]);

export const DEFAULT_OUTPUT_TOKENS = 2048;

type SessionManagedConversationFields = Pick<
	Conversation,
	| "projectId"
	| "provider"
	| "model"
	| "summary"
	| "summaryUpdatedAt"
	| "summaryMessageCount"
	| "reasoningEffort"
	| "enableThinking"
	| "thinkingBudget"
	| "thinkingLevel"
	| "outputTokens"
	| "outputEffort"
	| "webSearch"
	| "xaiSearchMode"
	| "enableTools"
>;

export type ConversationSessionPatch = Partial<SessionManagedConversationFields> & {
	clearSummary?: boolean;
};

export interface ConversationSessionBootstrap extends SessionManagedConversationFields {
	conversationId: string;
	userId: string;
	updatedAt: number;
	createdAt: number;
}

export interface ConversationSessionState extends SessionManagedConversationFields {
	conversationId: string;
	userId: string;
	updatedAt: number;
	createdAt: number;
	version: number;
}

function clampInt(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, Math.floor(value)));
}

function shouldDefaultWebSearch(provider: LLMProvider, model: string) {
	return provider === "xai" || provider === "poloai" || model === "gemini-3-pro";
}

function applyProviderInvariants(
	fields: SessionManagedConversationFields,
): SessionManagedConversationFields {
	const next = { ...fields };
	const provider = next.provider;
	if (provider === "xai") {
		next.xaiSearchMode = next.xaiSearchMode ?? "x";
	}
	if (provider !== "xai") {
		next.xaiSearchMode = undefined;
	}
	if (provider === "poloai") {
		next.outputTokens = next.outputTokens ?? DEFAULT_OUTPUT_TOKENS;
		next.enableTools = next.enableTools ?? true;
	}
	if (provider && next.model) {
		if (next.webSearch === undefined && shouldDefaultWebSearch(provider, next.model)) {
			next.webSearch = true;
		}
	}
	return next;
}

export function sanitizeConversationSessionPatch(
	patch: ConversationSessionPatch,
): ConversationSessionPatch {
	const next: ConversationSessionPatch = {};
	if (typeof patch.projectId === "string" && patch.projectId.trim()) {
		next.projectId = patch.projectId.trim();
	}
	if (typeof patch.provider === "string" && VALID_PROVIDERS.has(patch.provider as LLMProvider)) {
		next.provider = patch.provider as LLMProvider;
	}
	if (typeof patch.model === "string" && patch.model.trim()) {
		next.model = patch.model.trim();
	}
	if (typeof patch.summary === "string") {
		next.summary = patch.summary;
	}
	if (typeof patch.clearSummary === "boolean") {
		next.clearSummary = patch.clearSummary;
	}
	if (typeof patch.summaryUpdatedAt === "number" && Number.isFinite(patch.summaryUpdatedAt)) {
		next.summaryUpdatedAt = patch.summaryUpdatedAt;
	}
	if (
		typeof patch.summaryMessageCount === "number" &&
		Number.isFinite(patch.summaryMessageCount)
	) {
		next.summaryMessageCount = Math.max(0, Math.floor(patch.summaryMessageCount));
	}
	if (
		typeof patch.reasoningEffort === "string" &&
		VALID_REASONING_EFFORT.has(patch.reasoningEffort)
	) {
		next.reasoningEffort = patch.reasoningEffort;
	}
	if (typeof patch.enableThinking === "boolean") {
		next.enableThinking = patch.enableThinking;
	}
	if (typeof patch.thinkingBudget === "number" && Number.isFinite(patch.thinkingBudget)) {
		next.thinkingBudget = clampInt(patch.thinkingBudget, 1024, 32768);
	}
	if (
		typeof patch.thinkingLevel === "string" &&
		VALID_THINKING_LEVEL.has(patch.thinkingLevel)
	) {
		next.thinkingLevel = patch.thinkingLevel;
	}
	if (typeof patch.outputTokens === "number" && Number.isFinite(patch.outputTokens)) {
		next.outputTokens = clampInt(patch.outputTokens, 256, 32768);
	}
	if (
		typeof patch.outputEffort === "string" &&
		VALID_OUTPUT_EFFORT.has(patch.outputEffort)
	) {
		next.outputEffort = patch.outputEffort;
	}
	if (typeof patch.webSearch === "boolean") {
		next.webSearch = patch.webSearch;
	}
	if (
		typeof patch.xaiSearchMode === "string" &&
		VALID_XAI_SEARCH_MODE.has(patch.xaiSearchMode as XAISearchMode)
	) {
		next.xaiSearchMode = patch.xaiSearchMode as XAISearchMode;
	}
	if (typeof patch.enableTools === "boolean") {
		next.enableTools = patch.enableTools;
	}
	return next;
}

export function buildConversationSessionBootstrap(
	conversation: Conversation,
	userId: string,
): ConversationSessionBootstrap {
	const baseFields = applyProviderInvariants({
		projectId: conversation.projectId,
		provider: conversation.provider,
		model: conversation.model,
		summary: conversation.summary,
		summaryUpdatedAt: conversation.summaryUpdatedAt,
		summaryMessageCount: conversation.summaryMessageCount,
		reasoningEffort: conversation.reasoningEffort,
		enableThinking: conversation.enableThinking,
		thinkingBudget: conversation.thinkingBudget,
		thinkingLevel: conversation.thinkingLevel,
		outputTokens: conversation.outputTokens,
		outputEffort: conversation.outputEffort,
		webSearch: conversation.webSearch,
		xaiSearchMode: conversation.xaiSearchMode,
		enableTools: conversation.enableTools,
	});
	return {
		conversationId: conversation.id,
		userId,
		createdAt: conversation.createdAt,
		updatedAt: conversation.updatedAt,
		...baseFields,
	};
}

export function mergeConversationSessionState(
	base: ConversationSessionState,
	patch: ConversationSessionPatch,
	updatedAt: number,
): ConversationSessionState {
	const sanitized = sanitizeConversationSessionPatch(patch);
	if (sanitized.clearSummary) {
		sanitized.summary = undefined;
		sanitized.summaryUpdatedAt = undefined;
		sanitized.summaryMessageCount = undefined;
	}
	const { clearSummary, ...effectivePatch } = sanitized;
	const merged = applyProviderInvariants({ ...base, ...effectivePatch });
	if (Object.keys(effectivePatch).length === 0) {
		return base;
	}
	return {
		...base,
		...merged,
		updatedAt: Math.max(updatedAt, base.updatedAt),
		version: base.version + 1,
	};
}

export function mergeConversationWithSessionState(
	conversation: Conversation,
	state: ConversationSessionState,
): Conversation {
	return {
		...conversation,
		projectId: state.projectId ?? conversation.projectId,
		provider: state.provider ?? conversation.provider,
		model: state.model ?? conversation.model,
		summary: state.summary ?? conversation.summary,
		summaryUpdatedAt: state.summaryUpdatedAt ?? conversation.summaryUpdatedAt,
		summaryMessageCount: state.summaryMessageCount ?? conversation.summaryMessageCount,
		reasoningEffort: state.reasoningEffort ?? conversation.reasoningEffort,
		enableThinking: state.enableThinking ?? conversation.enableThinking,
		thinkingBudget: state.thinkingBudget ?? conversation.thinkingBudget,
		thinkingLevel: state.thinkingLevel ?? conversation.thinkingLevel,
		outputTokens: state.outputTokens ?? conversation.outputTokens,
		outputEffort: state.outputEffort ?? conversation.outputEffort,
		webSearch: state.webSearch ?? conversation.webSearch,
		xaiSearchMode: state.xaiSearchMode ?? conversation.xaiSearchMode,
		enableTools: state.enableTools ?? conversation.enableTools,
		updatedAt: Math.max(conversation.updatedAt, state.updatedAt),
	};
}

export function bootstrapStateToPersistedState(
	bootstrap: ConversationSessionBootstrap,
): ConversationSessionState {
	const { conversationId, userId, createdAt, updatedAt, ...fields } = bootstrap;
	return {
		conversationId,
		userId,
		createdAt,
		updatedAt,
		...applyProviderInvariants(fields),
		version: 1,
	};
}

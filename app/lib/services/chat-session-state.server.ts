import type { Conversation } from "../llm/types";
import {
	buildConversationSessionBootstrap,
	bootstrapStateToPersistedState,
	mergeConversationSessionState,
	mergeConversationWithSessionState,
	sanitizeConversationSessionPatch,
	type ConversationSessionBootstrap,
	type ConversationSessionPatch,
	type ConversationSessionState,
} from "./chat-session-state.shared";

type GetOrBootstrapRequest = {
	op: "get_or_bootstrap";
	userId: string;
	bootstrap: ConversationSessionBootstrap;
};

type PatchRequest = {
	op: "patch";
	userId: string;
	bootstrap: ConversationSessionBootstrap;
	patch: ConversationSessionPatch;
};

export type ConversationSessionDORequest = GetOrBootstrapRequest | PatchRequest;

export type ConversationSessionDOResponse =
	| { ok: true; state: ConversationSessionState }
	| { ok: false; error: string };

async function callConversationSessionDO(
	env: Env,
	conversationId: string,
	payload: ConversationSessionDORequest,
): Promise<ConversationSessionState | null> {
	if (!env.CHAT_SESSION_DO) return null;
	const id = env.CHAT_SESSION_DO.idFromName(conversationId);
	const stub = env.CHAT_SESSION_DO.get(id);
	const response = await stub.fetch("https://chat-session/state", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `ChatSessionDO error: ${response.status}`);
	}
	const json = (await response.json()) as ConversationSessionDOResponse;
	if (!json.ok) {
		throw new Error(json.error || "ChatSessionDO request failed");
	}
	return json.state;
}

function fallbackState(
	conversation: Conversation,
	userId: string,
	patch?: ConversationSessionPatch,
): ConversationSessionState {
	const bootstrap = buildConversationSessionBootstrap(conversation, userId);
	const base = bootstrapStateToPersistedState(bootstrap);
	if (!patch) return base;
	return mergeConversationSessionState(base, patch, Date.now());
}

export async function resolveConversationSessionState(options: {
	env: Env;
	userId: string;
	conversation: Conversation;
	patch?: ConversationSessionPatch;
}): Promise<ConversationSessionState> {
	const bootstrap = buildConversationSessionBootstrap(
		options.conversation,
		options.userId,
	);
	const patch = options.patch
		? sanitizeConversationSessionPatch(options.patch)
		: undefined;
	try {
		const payload: ConversationSessionDORequest = patch
			? {
					op: "patch",
					userId: options.userId,
					bootstrap,
					patch,
				}
			: {
					op: "get_or_bootstrap",
					userId: options.userId,
					bootstrap,
				};
		const state = await callConversationSessionDO(
			options.env,
			options.conversation.id,
			payload,
		);
		if (state) return state;
	} catch (error) {
		console.error("[chat-session] failed to resolve DO state", error);
	}
	return fallbackState(options.conversation, options.userId, patch);
}

export function applyConversationSessionState(
	conversation: Conversation,
	state: ConversationSessionState,
) {
	return mergeConversationWithSessionState(conversation, state);
}


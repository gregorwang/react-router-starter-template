import type { Conversation, LLMProvider } from "../llm/types";

const STORAGE_KEY = "conversation_store";
const ACTIVE_KEY = "conversation_active";

function loadStore(): Conversation[] {
	if (typeof window === "undefined") return [];
	const raw = window.localStorage.getItem(STORAGE_KEY);
	if (!raw) return [];
	try {
		return JSON.parse(raw) as Conversation[];
	} catch {
		return [];
	}
}

function saveStore(conversations: Conversation[]) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

export function getConversations(): Conversation[] {
	return loadStore();
}

export function getConversation(id: string): Conversation | undefined {
	return loadStore().find((conv) => conv.id === id);
}

export function createConversation(
	title: string,
	provider: LLMProvider,
	model: string,
): Conversation {
	const conversation: Conversation = {
		id: crypto.randomUUID(),
		title,
		messages: [],
		provider,
		model,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	const conversations = loadStore();
	conversations.unshift(conversation);
	saveStore(conversations);
	return conversation;
}

export function saveConversation(conversation: Conversation) {
	const conversations = loadStore();
	const idx = conversations.findIndex((c) => c.id === conversation.id);
	if (idx >= 0) {
		conversations[idx] = conversation;
	} else {
		conversations.unshift(conversation);
	}
	saveStore(conversations);
}

export function deleteConversation(id: string) {
	const conversations = loadStore().filter((c) => c.id !== id);
	saveStore(conversations);
}

export function setActiveConversation(id: string) {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(ACTIVE_KEY, id);
}

export function getActiveConversationId(): string | null {
	if (typeof window === "undefined") return null;
	return window.localStorage.getItem(ACTIVE_KEY);
}

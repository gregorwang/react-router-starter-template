import type { Conversation } from "../llm/types";
import { getItem, setItem, removeItem } from "./local-storage";

const CONVERSATIONS_KEY = "llm_conversations";
const ACTIVE_CONVERSATION_KEY = "llm_active_conversation";

export function getConversations(): Conversation[] {
	return getItem<Conversation[]>(CONVERSATIONS_KEY, []);
}

export function getConversation(id: string): Conversation | undefined {
	const conversations = getConversations();
	return conversations.find((c) => c.id === id);
}

export function saveConversation(conversation: Conversation): void {
	const conversations = getConversations();
	const index = conversations.findIndex((c) => c.id === conversation.id);

	if (index >= 0) {
		conversations[index] = conversation;
	} else {
		conversations.push(conversation);
	}

	// Sort by updated date descending
	conversations.sort((a, b) => b.updatedAt - a.updatedAt);

	setItem(CONVERSATIONS_KEY, conversations);
}

export function deleteConversation(id: string): void {
	const conversations = getConversations();
	const filtered = conversations.filter((c) => c.id !== id);
	setItem(CONVERSATIONS_KEY, filtered);
	setActiveConversation(null);
}

export function getActiveConversationId(): string | null {
	return getItem<string | null>(ACTIVE_CONVERSATION_KEY, null);
}

export function setActiveConversation(id: string | null): void {
	setItem(ACTIVE_CONVERSATION_KEY, id);
}

export function createConversation(
	title: string,
	provider: string,
	model: string,
): Conversation {
	return {
		id: crypto.randomUUID(),
		title,
		messages: [],
		provider: provider as any,
		model,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}

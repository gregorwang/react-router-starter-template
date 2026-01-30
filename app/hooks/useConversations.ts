import { useCallback, useEffect, useState } from "react";
import type { Conversation } from "../lib/llm/types";
import {
	getConversations,
	getConversation,
	deleteConversation as deleteConv,
	setActiveConversation,
	getActiveConversationId,
} from "../lib/storage/conversation-store";

export function useConversations() {
	const [conversations, setConversations] = useState<Conversation[]>(() => {
		// Initialize from localStorage on client
		if (typeof window === "undefined") {
			return [];
		}
		return getConversations();
	});
	const [activeId, setActiveId] = useState<string | null>(() => {
		if (typeof window === "undefined") {
			return null;
		}
		return getActiveConversationId();
	});

	const refresh = useCallback(() => {
		if (typeof window === "undefined") {
			return;
		}
		setConversations(getConversations());
	}, []);

	const loadConversation = useCallback((id: string) => {
		if (typeof window === "undefined") {
			return;
		}
		const conv = getConversation(id);
		if (conv) {
			setActiveId(id);
			setActiveConversation(id);
			return conv;
		}
		return undefined;
	}, []);

	const deleteConversation = useCallback((id: string) => {
		if (typeof window === "undefined") {
			return;
		}
		deleteConv(id);
		refresh();
		if (activeId === id) {
			setActiveId(null);
		}
	}, [activeId, refresh]);

	return {
		conversations,
		activeId,
		refresh,
		loadConversation,
		deleteConversation,
	};
}

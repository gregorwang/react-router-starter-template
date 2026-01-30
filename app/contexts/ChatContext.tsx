import { createContext, useContext, useState, useCallback } from "react";
import type { Conversation, Message, LLMProvider } from "../lib/llm/types";
import {
	createConversation,
	getConversation,
	saveConversation,
	setActiveConversation,
} from "../lib/storage/conversation-store";

interface ChatContextValue {
	conversations: Conversation[];
	currentConversation: Conversation | null;
	isLoading: boolean;
	isStreaming: boolean;
	startConversation: () => void;
	loadConversation: (id: string) => void;
	addMessage: (message: Message) => void;
	updateLastMessage: (content: string) => void;
	setLoading: (loading: boolean) => void;
	setStreaming: (streaming: boolean) => void;
	deleteConversation: (id: string) => void;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
	const [conversations, setConversations] = useState<Conversation[]>(() => {
		if (typeof window === "undefined") {
			return [];
		}
		return [] as Conversation[];
	});

	const [currentConversation, setCurrentConversation] =
		useState<Conversation | null>(null);

	const [isLoading, setIsLoading] = useState(false);
	const [isStreaming, setIsStreaming] = useState(false);

	const refreshConversations = useCallback(() => {
		if (typeof window === "undefined") {
			return;
		}
		const all = [];
		// We'll rely on the individual components to fetch conversations
		setConversations(all);
	}, []);

	const startConversation = useCallback(() => {
		if (typeof window === "undefined") {
			return;
		}

		const newConv = createConversation("New Chat", "openai", "gpt-4o");
		saveConversation(newConv);
		setActiveConversation(newConv.id);
		setCurrentConversation(newConv);
		refreshConversations();
	}, [refreshConversations]);

	const loadConversation = useCallback((id: string) => {
		if (typeof window === "undefined") {
			return;
		}

		const conv = getConversation(id);
		if (conv) {
			setCurrentConversation(conv);
			setActiveConversation(id);
		}
	}, []);

	const addMessage = useCallback((message: Message) => {
		setCurrentConversation((prev) => {
			if (!prev) return prev;

			const updated = {
				...prev,
				messages: [...prev.messages, message],
				updatedAt: Date.now(),
			};

			saveConversation(updated);
			return updated;
		});
	}, []);

	const updateLastMessage = useCallback((content: string) => {
		setCurrentConversation((prev) => {
			if (!prev || prev.messages.length === 0) return prev;

			const updated = {
				...prev,
				messages: [
					...prev.messages.slice(0, -1),
					{ ...prev.messages[prev.messages.length - 1], content },
				],
				updatedAt: Date.now(),
			};

			// Don't save during streaming to avoid race conditions
			return updated;
		});
	}, []);

	const deleteConversation = useCallback((id: string) => {
		if (typeof window === "undefined") {
			return;
		}

		if (currentConversation?.id === id) {
			setCurrentConversation(null);
		}

		// Delete from localStorage
		const all = [];
		const filtered = all.filter((c) => c.id !== id);
		setConversations(filtered);

		refreshConversations();
	}, [currentConversation, refreshConversations]);

	return (
		<ChatContext.Provider
			value={{
				conversations,
				currentConversation,
				isLoading,
				isStreaming,
				startConversation,
				loadConversation,
				addMessage,
				updateLastMessage,
				setLoading: setIsLoading,
				setStreaming: setIsStreaming,
				deleteConversation,
			}}
		>
			{children}
		</ChatContext.Provider>
	);
}

export function useChat(): ChatContextValue {
	const context = useContext(ChatContext);
	if (!context) {
		throw new Error("useChat must be used within a ChatProvider");
	}
	return context;
}

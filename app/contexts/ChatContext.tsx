import { createContext, useContext, useState, useCallback } from "react";
import type { Conversation, Message } from "../lib/llm/types";

interface ChatContextValue {
	currentConversation: Conversation | null;
	isLoading: boolean;
	isStreaming: boolean;
	setCurrentConversation: (conversation: Conversation | null) => void;
	loadConversation: (id: string) => void;
	addMessage: (message: Message) => void;
	updateLastMessage: (content: string) => void;
	setLoading: (loading: boolean) => void;
	setStreaming: (streaming: boolean) => void;
	startConversation: () => void;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
	const [currentConversation, setCurrentConversation] =
		useState<Conversation | null>(null);

	const [isLoading, setIsLoading] = useState(false);
	const [isStreaming, setIsStreaming] = useState(false);

	// Load conversation sets the current conversation from server data
	// This is called by route components when they receive loader data
	const loadConversation = useCallback((id: string) => {
		// This is now a no-op - conversation loading happens via React Router loaders
		// The route component should call setCurrentConversation directly with loader data
		console.log("loadConversation called with id:", id);
	}, []);

	const addMessage = useCallback((message: Message) => {
		setCurrentConversation((prev) => {
			if (!prev) return prev;

			return {
				...prev,
				messages: [...prev.messages, message],
				updatedAt: Date.now(),
			};
		});
	}, []);

	const updateLastMessage = useCallback((content: string) => {
		setCurrentConversation((prev) => {
			if (!prev || prev.messages.length === 0) return prev;

			return {
				...prev,
				messages: [
					...prev.messages.slice(0, -1),
					{ ...prev.messages[prev.messages.length - 1], content },
				],
				updatedAt: Date.now(),
			};
		});
	}, []);

	const startConversation = useCallback(() => {
		setCurrentConversation({
			id: crypto.randomUUID(),
			title: "New Chat",
			messages: [],
			provider: "deepseek",
			model: "deepseek-chat",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	}, []);

	return (
		<ChatContext.Provider
			value={{
				currentConversation,
				isLoading,
				isStreaming,
				setCurrentConversation,
				loadConversation,
				addMessage,
				updateLastMessage,
				setLoading: setIsLoading,
				setStreaming: setIsStreaming,
				startConversation,
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

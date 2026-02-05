import {
	createContext,
	useContext,
	useState,
	useCallback,
	type Dispatch,
	type SetStateAction,
} from "react";
import type { Conversation, Message } from "../lib/llm/types";

interface ChatContextValue {
	currentConversation: Conversation | null;
	isLoading: boolean;
	isStreaming: boolean;
	setCurrentConversation: Dispatch<SetStateAction<Conversation | null>>;
	addMessage: (message: Message) => void;
	updateLastMessage: (update: Partial<Message>) => void;
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

	const updateLastMessage = useCallback((update: Partial<Message>) => {
		setCurrentConversation((prev) => {
			if (!prev || prev.messages.length === 0) return prev;

			const last = prev.messages[prev.messages.length - 1];
			const nextMeta = mergeMessageMeta(last.meta, update.meta);

			return {
				...prev,
				messages: [
					...prev.messages.slice(0, -1),
					{ ...last, ...update, meta: nextMeta },
				],
				updatedAt: Date.now(),
			};
		});
	}, []);

	const startConversation = useCallback(() => {
		setCurrentConversation({
			id: crypto.randomUUID(),
			title: "新对话",
			messages: [],
			provider: "poe",
			model: "grok-4.1-fast-reasoning",
			enableTools: true,
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

function mergeMessageMeta(
	base?: Message["meta"],
	next?: Message["meta"],
): Message["meta"] {
	if (!base) return next;
	if (!next) return base;

	return {
		...base,
		...next,
		usage: next.usage ?? base.usage,
		webSearch: next.webSearch ?? base.webSearch,
		attachments: next.attachments ?? base.attachments,
	};
}

export function useChat(): ChatContextValue {
	const context = useContext(ChatContext);
	if (!context) {
		throw new Error("useChat must be used within a ChatProvider");
	}
	return context;
}

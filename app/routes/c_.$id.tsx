import type { Route } from "./+types/c.$id";
import { ChatContainer } from "../components/chat/ChatContainer";
import { Sidebar } from "../components/layout/Sidebar";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useChat } from "../hooks/useChat";
import { useConversations } from "../hooks/useConversations";
import { createConversation, setActiveConversation } from "../lib/storage/conversation-store";

export default function Conversation({ params }: Route.ComponentProps) {
	const navigate = useNavigate();
	const { loadConversation } = useChat();
	const { conversations } = useConversations();
	const conversationId = params.id;

	const handleNewChat = () => {
		const newConv = createConversation("New Chat", "openai", "gpt-4o");
		setActiveConversation(newConv.id);
		saveConversation(newConv);
		navigate(`/c/${newConv.id}`);
	};

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		// Load the conversation
		const conv = conversations.find((c) => c.id === conversationId);
		if (conv) {
			loadConversation(conversationId);
		} else {
			// Navigate to a new conversation
			handleNewChat();
		}
	}, [conversationId, conversations, loadConversation, handleNewChat]);

	return (
		<div className="flex h-screen">
			<Sidebar onNewChat={handleNewChat} />
			<ChatContainer />
		</div>
	);
}

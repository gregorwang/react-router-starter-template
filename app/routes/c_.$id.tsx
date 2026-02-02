import type { Route } from "./+types/c.$id";
import { ChatContainer } from "../components/chat/ChatContainer";
import { Sidebar } from "../components/layout/Sidebar";
import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router";
import { useChat } from "../contexts/ChatContext";
import {
	getConversation,
	getConversations,
	saveConversation,
} from "../lib/db/conversations.server";
import type { Conversation } from "../lib/llm/types";

// Server loader - runs in Cloudflare Worker with D1 database
export async function loader({ context, params }: Route.LoaderArgs) {
	const conversationId = params.id;
	const conversations = await getConversations(context.db);
	let conversation = await getConversation(context.db, conversationId);

	// If conversation doesn't exist, create a new one
	if (!conversation) {
		conversation = {
			id: conversationId,
			title: "New Chat",
			provider: "deepseek",
			model: "deepseek-chat",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
		};
		await saveConversation(context.db, conversation);
	}

	return {
		conversationId,
		conversations,
		conversation,
	};
}

export default function Conversation({ loaderData }: Route.ComponentProps) {
	const navigate = useNavigate();
	const { setCurrentConversation } = useChat();
	const { conversationId, conversation, conversations } = loaderData;

	// Load conversation into context when component mounts or conversation changes
	useEffect(() => {
		if (conversation) {
			setCurrentConversation(conversation);
		}
		return () => {
			// Clear conversation when unmounting
			setCurrentConversation(null);
		};
	}, [conversation, setCurrentConversation]);

	const handleNewChat = useCallback(() => {
		// Generate new UUID and navigate
		const newId = crypto.randomUUID();
		navigate(`/c/${newId}`);
	}, [navigate]);

	return (
		<div className="flex h-screen">
			<Sidebar onNewChat={handleNewChat} conversations={conversations} />
			<ChatContainer />
		</div>
	);
}

import { Outlet, useNavigate } from "react-router";
import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import {
	createConversation,
	getActiveConversationId,
	setActiveConversation,
} from "../../lib/storage/conversation-store";

export function ChatLayout() {
	const navigate = useNavigate();

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		// Check if we have an active conversation
		const activeId = getActiveConversationId();

		if (!activeId) {
			// Create a new conversation and navigate to it
			const newConv = createConversation("New Chat", "openai", "gpt-4o");
			setActiveConversation(newConv.id);
			navigate(`/c/${newConv.id}`, { replace: true });
		} else {
			// Navigate to the active conversation
			navigate(`/c/${activeId}`, { replace: true });
		}
	}, [navigate]);

	return (
		<div className="flex h-screen">
			<Sidebar onNewChat={() => navigate("/")} />
			<Outlet />
		</div>
	);
}

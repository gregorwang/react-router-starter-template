import { useEffect, useRef } from "react";
import { useChat } from "../../hooks/useChat";
import { MessageBubble } from "./MessageBubble";

export function MessageList() {
	const { currentConversation } = useChat();
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [currentConversation?.messages]);

	if (!currentConversation?.messages.length) {
		return (
			<div className="flex items-center justify-center h-full">
				<p className="text-gray-500 dark:text-gray-400">
					Start a conversation by typing a message below
				</p>
			</div>
		);
	}

	return (
		<div ref={scrollRef} className="max-w-4xl mx-auto py-8 px-4 space-y-6">
			{currentConversation.messages.map((message) => (
				<MessageBubble key={message.id} message={message} />
			))}
		</div>
	);
}

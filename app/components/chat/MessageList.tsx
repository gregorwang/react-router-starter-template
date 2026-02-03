import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "../../hooks/useChat";
import { MessageBubble } from "./MessageBubble";

export function MessageList() {
	const { currentConversation } = useChat();
	const scrollRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);

	const updateScrollState = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const threshold = 80;
		const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
		setIsAtBottom(distance < threshold);
	}, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		updateScrollState();
		el.addEventListener("scroll", updateScrollState);
		return () => el.removeEventListener("scroll", updateScrollState);
	}, [updateScrollState]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		if (isAtBottom) {
			el.scrollTop = el.scrollHeight;
		}
	}, [currentConversation?.messages.length, isAtBottom]);

	const scrollToBottom = () => {
		const el = scrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
		setIsAtBottom(true);
	};

	if (!currentConversation?.messages.length) {
		return (
			<div className="flex items-center justify-center h-full">
				<p className="text-gray-500 dark:text-gray-400">
					在下面输入内容开始对话
				</p>
			</div>
		);
	}

	return (
		<div className="relative h-full min-h-0">
			<div
				ref={scrollRef}
				className="w-full max-w-4xl mx-auto py-8 px-4 space-y-6 h-full min-h-0 overflow-y-auto"
			>
				{currentConversation.messages.map((message) => (
					<MessageBubble
						key={message.id}
						message={message}
						modelName={!message.role.includes("user") ? currentConversation.model : undefined}
					/>
				))}
			</div>
			{!isAtBottom && (
				<button
					type="button"
					onClick={scrollToBottom}
					aria-label="回到底部"
					className="absolute bottom-4 right-4 text-xs px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 shadow-sm"
				>
					回到底部
				</button>
			)}
		</div>
	);
}

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
			<div className="flex items-center justify-center h-full px-4">
				<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl px-6 py-6 shadow-sm text-center">
					<p className="text-neutral-600 dark:text-neutral-300 text-sm">
						在下面输入内容开始对话
					</p>
				</div>
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
						modelName={
							message.role === "assistant"
								? message.meta?.model ?? currentConversation.model
								: undefined
						}
					/>
				))}
			</div>
			{!isAtBottom && (
				<button
					type="button"
					onClick={scrollToBottom}
					aria-label="回到底部"
					className="absolute bottom-4 right-4 text-xs px-3 py-2 rounded-full border border-white/60 dark:border-neutral-700/70 bg-white/80 dark:bg-neutral-900/80 text-neutral-600 dark:text-neutral-300 shadow-md backdrop-blur transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
				>
					回到底部
				</button>
			)}
		</div>
	);
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "../../hooks/useChat";
import { MessageBubble } from "./MessageBubble";
import { format } from "date-fns";
import { isContextClearedEventMessage } from "../../lib/chat/context-boundary";
import { useNavigate } from "react-router";

export function MessageList() {
	const { currentConversation, isStreaming } = useChat();
	const scrollRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const [branchingFromMessageId, setBranchingFromMessageId] = useState<string | null>(
		null,
	);
	const navigate = useNavigate();

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

	const handleForkFromMessage = useCallback(
		async (messageId: string) => {
			if (!currentConversation || branchingFromMessageId) return;

			const customTitle = window.prompt("分支名称（可选，留空自动命名）", "");
			if (customTitle === null) return;

			setBranchingFromMessageId(messageId);
			try {
				const response = await fetch("/conversations/fork", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						conversationId: currentConversation.id,
						messageId,
						title: customTitle.trim() || undefined,
					}),
				});
				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(errorText || `Server error: ${response.status}`);
				}
				const data = (await response.json()) as {
					conversationId: string;
					projectId?: string;
				};
				if (!data.conversationId) {
					throw new Error("Missing fork conversation id");
				}
				const projectId = data.projectId || currentConversation.projectId || "default";
				navigate(`/c/${data.conversationId}?project=${projectId}`);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "创建分支失败";
				alert(message);
			} finally {
				setBranchingFromMessageId(null);
			}
		},
		[currentConversation, branchingFromMessageId, navigate],
	);

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

	const lastMessageId =
		currentConversation.messages[currentConversation.messages.length - 1]?.id;

	return (
		<div className="relative h-full min-h-0">
			<div
				ref={scrollRef}
				className="w-full max-w-4xl mx-auto py-8 px-4 space-y-6 h-full min-h-0 overflow-y-auto"
			>
				{currentConversation.messages.map((message) => (
					isContextClearedEventMessage(message) ? (
						<div
							key={message.id}
							className="flex items-center justify-center py-1"
						>
							<div className="px-4 py-2 rounded-full border border-dashed border-neutral-300/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/60 text-[11px] text-neutral-500 dark:text-neutral-400 tracking-wide">
								—— 上下文已清除（
								{format(
									new Date(message.meta?.event?.at ?? message.timestamp),
									"yyyy-MM-dd HH:mm:ss",
								)}
								）——
							</div>
						</div>
					) : (
						<MessageBubble
							key={message.id}
							message={message}
							isStreaming={isStreaming && message.id === lastMessageId}
							onForkFromMessage={isStreaming ? undefined : handleForkFromMessage}
							isForking={Boolean(branchingFromMessageId)}
							modelName={
								message.role === "assistant"
									? message.meta?.model ?? currentConversation.model
									: undefined
							}
						/>
					)
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

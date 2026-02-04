import { useState, useRef, useEffect } from "react";
import { useChat } from "../../hooks/useChat";
import { useChat as useChatContext } from "../../contexts/ChatContext";
import { SendButton } from "./SendButton";
import { cn } from "../../lib/utils/cn";

export function InputArea({ providerAvailable = true }: { providerAvailable?: boolean }) {
	const [input, setInput] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const { sendMessage, currentConversation, abortGeneration } = useChat();
	const { isStreaming } = useChatContext();

	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
		}
	}, [input]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!input.trim() || isStreaming) return;

		const message = input.trim();
		setInput("");

		try {
			await sendMessage(message);
		} catch (error) {
			console.error("Error sending message:", error);
			const msg =
				error instanceof Error
					? error.message
					: "Failed to send message. Please check your API key.";
			alert(msg);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit(e);
		}
	};

	if (!currentConversation) {
		return null;
	}

	return (
		<form onSubmit={handleSubmit} className="relative">
			<textarea
				ref={textareaRef}
				value={input}
				onChange={(e) => setInput(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="输入消息..."
				className={cn(
					"w-full pl-4 py-4 rounded-2xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/80 dark:bg-neutral-900/70 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/40 shadow-sm transition-all duration-200 resize-none overflow-hidden",
					isStreaming ? "pr-24" : "pr-12",
				)}
				rows={1}
				disabled={isStreaming || !providerAvailable}
			/>
			<div className="absolute right-2 top-1/2 -translate-y-1/2">
				<div className="flex items-center gap-2">
					{isStreaming && (
						<button
							type="button"
							onClick={abortGeneration}
							className="text-xs px-3 py-2 rounded-lg border border-neutral-200/70 dark:border-neutral-700/70 text-neutral-600 dark:text-neutral-300 bg-white/70 dark:bg-neutral-900/60 shadow-sm hover:border-brand-400/60 hover:text-brand-700 dark:hover:text-brand-200 transition-all duration-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
						>
							停止
						</button>
					)}
					<SendButton disabled={!input.trim() || isStreaming || !providerAvailable} />
				</div>
			</div>
			{!providerAvailable && (
				<p className="mt-2 text-xs text-rose-500">
					当前模型密钥未配置，请在环境变量中设置。
				</p>
			)}
		</form>
	);
}

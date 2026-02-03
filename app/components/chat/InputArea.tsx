import { useState, useRef, useEffect } from "react";
import { useChat } from "../../hooks/useChat";
import { useChat as useChatContext } from "../../contexts/ChatContext";
import { SendButton } from "./SendButton";

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
				className="w-full pr-12 pl-4 py-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none overflow-hidden"
				rows={1}
				disabled={isStreaming || !providerAvailable}
			/>
			<div className="absolute right-2 top-1/2 -translate-y-1/2">
				<div className="flex items-center gap-2">
					{isStreaming && (
						<button
							type="button"
							onClick={abortGeneration}
							className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
						>
							停止
						</button>
					)}
					<SendButton disabled={!input.trim() || isStreaming || !providerAvailable} />
				</div>
			</div>
			{!providerAvailable && (
				<p className="mt-2 text-xs text-red-500">
					当前模型密钥未配置，请在环境变量中设置。
				</p>
			)}
		</form>
	);
}

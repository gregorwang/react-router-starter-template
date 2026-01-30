import { useChat } from "../../hooks/useChat";

export function StreamingIndicator() {
	const { isStreaming } = useChat();

	if (!isStreaming) return null;

	return (
		<div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mt-2">
			<span className="flex gap-1">
				<span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
				<span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
				<span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
			</span>
			<span>Thinking...</span>
		</div>
	);
}

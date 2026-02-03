import { useChat } from "../../contexts/ChatContext";

export function StreamingIndicator() {
	const { isStreaming } = useChat();

	if (!isStreaming) return null;

	return (
		<div className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400 text-sm mt-4">
			<span className="flex gap-1">
				<span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
				<span className="w-2 h-2 bg-secondary-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
				<span className="w-2 h-2 bg-accent-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
			</span>
			<span>思考中...</span>
		</div>
	);
}

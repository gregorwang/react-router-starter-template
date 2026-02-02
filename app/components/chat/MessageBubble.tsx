import { parseMarkdown, hasCodeBlock } from "../../lib/utils/markdown";
import { CodeBlock } from "./CodeBlock";
import type { Message as MessageType } from "../../lib/llm/types";
import { cn } from "../../lib/utils/cn";

interface MessageBubbleProps {
	message: MessageType;
	modelName?: string;
}

export function MessageBubble({ message, modelName }: MessageBubbleProps) {
	const isUser = message.role === "user";
	const hasCode = hasCodeBlock(message.content);

	return (
		<div
			className={cn(
				"flex gap-4 w-full",
				isUser ? "flex-row-reverse" : "flex-row",
			)}
		>
			{/* Avatar */}
			<div className="flex-shrink-0">
				<div
					className={cn(
						"w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
						isUser
							? "bg-orange-500 text-white"
							: "bg-blue-600 text-white",
					)}
				>
					{isUser ? "U" : "AI"}
				</div>
			</div>

			<div
				className={cn(
					"max-w-3xl rounded-lg px-4 py-3 overflow-hidden",
					isUser
						? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
						: "bg-transparent text-gray-900 dark:text-gray-100 font-sans",
				)}
			>
				{/* Role Label */}
				<div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
					{isUser ? "You" : (modelName || "Assistant")}
				</div>
				{isUser ? (
					<p className="whitespace-pre-wrap">{message.content}</p>
				) : (
					<div className="prose dark:prose-invert max-w-none">
						{hasCode ? (
							<CodeBlock content={message.content} />
						) : (
							<div
								dangerouslySetInnerHTML={{
									__html: parseMarkdown(message.content),
								}}
							/>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

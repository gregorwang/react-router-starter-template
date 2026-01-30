import { parseMarkdown, hasCodeBlock } from "../../lib/utils/markdown";
import { CodeBlock } from "./CodeBlock";
import type { Message as MessageType } from "../../lib/llm/types";
import { cn } from "../../lib/utils/cn";

interface MessageBubbleProps {
	message: MessageType;
}

export function MessageBubble({ message }: MessageBubbleProps) {
	const isUser = message.role === "user";
	const hasCode = hasCodeBlock(message.content);

	return (
		<div
			className={cn(
				"flex",
				isUser ? "justify-end" : "justify-start",
			)}
		>
			<div
				className={cn(
					"max-w-3xl rounded-lg px-4 py-3",
					isUser
						? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
						: "bg-transparent text-gray-900 dark:text-gray-100",
				)}
			>
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

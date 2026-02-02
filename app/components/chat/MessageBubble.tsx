import { parseMarkdown, hasCodeBlock } from "../../lib/utils/markdown";
import { CodeBlock } from "./CodeBlock";
import type { Message as MessageType } from "../../lib/llm/types";
import { cn } from "../../lib/utils/cn";
import { useMemo, useState } from "react";

interface MessageBubbleProps {
	message: MessageType;
	modelName?: string;
}

export function MessageBubble({ message, modelName }: MessageBubbleProps) {
	const isUser = message.role === "user";
	const hasCode = hasCodeBlock(message.content);
	const [copied, setCopied] = useState(false);
	const usage = message.meta?.usage;
	const thinkingMs = message.meta?.thinkingMs;

	const formattedThinking = useMemo(() => {
		if (!thinkingMs) return null;
		if (thinkingMs < 1000) return `${thinkingMs}ms`;
		return `${(thinkingMs / 1000).toFixed(1)}s`;
	}, [thinkingMs]);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(message.content);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Ignore copy failures
		}
	};

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
					{isUser ? "我" : "AI"}
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
				<div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
					<span>{isUser ? "你" : (modelName || "助手")}</span>
					<button
						type="button"
						onClick={handleCopy}
						className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
					>
						{copied ? "已复制" : "复制"}
					</button>
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
				{message.meta?.reasoning && message.meta.reasoning.trim().length > 0 && (
					<details className="mt-3 text-xs text-gray-500 dark:text-gray-400">
						<summary className="cursor-pointer select-none">
							思考链
						</summary>
						<pre className="mt-2 whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-300">
							{message.meta.reasoning}
						</pre>
					</details>
				)}
				{(formattedThinking || usage || message.meta?.credits) && (
					<div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
						{formattedThinking && <span>思考用时：{formattedThinking}</span>}
						{usage && (
							<span>
								Tokens：输入 {usage.promptTokens} • 输出 {usage.completionTokens}{" "}
								• 总计 {usage.totalTokens}
								{usage.estimated ? "（估算）" : ""}
							</span>
						)}
						{message.meta?.credits && (
							<span>Poe 积分：{message.meta.credits}</span>
						)}
					</div>
				)}
				{message.meta?.webSearch?.results?.length ? (
					<div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
						<div className="font-medium text-gray-600 dark:text-gray-300 mb-1">
							X 搜索结果
						</div>
						<ul className="space-y-1">
							{message.meta.webSearch.results.map((result, index) => (
								<li key={`${result.id ?? index}`}>
									{result.author ? `@${result.author}: ` : ""}
									{result.text}
								</li>
							))}
						</ul>
					</div>
				) : null}
			</div>
		</div>
	);
}

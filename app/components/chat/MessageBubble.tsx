import type { Message as MessageType } from "../../lib/llm/types";
import { cn } from "../../lib/utils/cn";
import { useMemo, useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageBubbleProps {
	message: MessageType;
	modelName?: string;
}

export function MessageBubble({ message, modelName }: MessageBubbleProps) {
	const isUser = message.role === "user";
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
							? "bg-brand-600 text-white"
							: "bg-secondary-600 text-white",
					)}
				>
					{isUser ? "我" : "AI"}
				</div>
			</div>

			<div
				className={cn(
					"max-w-3xl rounded-2xl px-4 py-4 overflow-hidden border transition-shadow duration-200 hover:shadow-md",
					isUser
						? "bg-brand-600 text-white border-brand-500/30 shadow-md shadow-brand-600/20"
						: "bg-white/80 dark:bg-neutral-900/70 text-neutral-900 dark:text-neutral-100 border-white/60 dark:border-neutral-800/60 shadow-sm backdrop-blur",
				)}
			>
				{/* Role Label */}
				<div
					className={cn(
						"flex items-center justify-between text-xs mb-1",
						isUser
							? "text-white/70"
							: "text-neutral-500 dark:text-neutral-400",
					)}
				>
					<span>{isUser ? "你" : (modelName || "助手")}</span>
					<button
						type="button"
						onClick={handleCopy}
						className={cn(
							"text-xs transition-colors",
							isUser
								? "text-white/70 hover:text-white"
								: "text-neutral-400 hover:text-brand-600 dark:hover:text-brand-200",
						)}
					>
						{copied ? "已复制" : "复制"}
					</button>
				</div>
				{isUser ? (
					<p className="whitespace-pre-wrap">{message.content}</p>
				) : (
					<MarkdownRenderer content={message.content} />
				)}
				{message.meta?.reasoning && message.meta.reasoning.trim().length > 0 && (
					<details className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
						<summary className="cursor-pointer select-none">
							思考链
						</summary>
						<pre className="mt-2 whitespace-pre-wrap text-xs text-neutral-600 dark:text-neutral-300">
							{message.meta.reasoning}
						</pre>
					</details>
				)}
				{(formattedThinking || usage || message.meta?.credits) && (
					<div className="mt-2 flex flex-wrap gap-4 text-xs text-neutral-500 dark:text-neutral-400">
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
					<div className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
						<div className="font-medium text-neutral-600 dark:text-neutral-300 mb-1">
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

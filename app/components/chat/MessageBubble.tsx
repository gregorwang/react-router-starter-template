import type { Message as MessageType } from "../../lib/llm/types";
import { cn } from "../../lib/utils/cn";
import { useMemo, useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageBubbleProps {
	message: MessageType;
	modelName?: string;
	isStreaming?: boolean;
	onForkFromMessage?: (messageId: string) => void;
	isForking?: boolean;
}

export function MessageBubble({
	message,
	modelName,
	isStreaming,
	onForkFromMessage,
	isForking = false,
}: MessageBubbleProps) {
	const isUser = message.role === "user";
	const [copied, setCopied] = useState(false);
	const usage = message.meta?.usage;
	const thinkingMs = message.meta?.thinkingMs;
	const normalizedContent = useMemo(() => {
		if (!message.content) return message.content;
		return message.content.replace(/\)\s*\[\[/g, ") [[");
	}, [message.content]);
	const hasReasoning = Boolean(message.meta?.reasoning?.trim());
	const showThinkingStatus =
		!isUser && (isStreaming || hasReasoning || Boolean(thinkingMs));
	const showStreamingPlaceholder =
		!isUser &&
		isStreaming &&
		message.content.trim().length === 0;

	const formattedThinking = useMemo(() => {
		if (!thinkingMs) return null;
		if (thinkingMs < 1000) return `${thinkingMs}ms`;
		return `${(thinkingMs / 1000).toFixed(1)}s`;
	}, [thinkingMs]);
	const attachments = message.meta?.attachments || [];
	const citationUrls = useMemo(() => {
		const urls = message.meta?.webSearch?.citations || [];
		return urls.filter((url) => /^https?:\/\//i.test(url));
	}, [message.meta?.webSearch?.citations]);
	const searchProviderLabel =
		message.meta?.webSearch?.provider === "claude"
			? "Claude 搜索"
			: message.meta?.webSearch?.provider === "xai"
				? "xAI 搜索"
				: "X 搜索";

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
				"flex items-start gap-4 w-full min-w-0",
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
					"min-w-0 max-w-[calc(100%-3rem)] sm:max-w-3xl rounded-2xl px-4 py-4 overflow-visible border transition-shadow duration-200 hover:shadow-md",
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
					<div className="flex items-center gap-2">
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
						{onForkFromMessage && (
							<details className="relative">
								<summary
									className={cn(
										"list-none cursor-pointer select-none text-xs transition-colors",
										isUser
											? "text-white/70 hover:text-white"
											: "text-neutral-400 hover:text-brand-600 dark:hover:text-brand-200",
									)}
								>
									⋯
								</summary>
								<div className="absolute right-0 mt-1 min-w-36 rounded-lg border border-neutral-200/80 dark:border-neutral-700/80 bg-white dark:bg-neutral-900 shadow-lg z-10 p-1">
									<button
										type="button"
										onClick={() => onForkFromMessage(message.id)}
										disabled={isForking}
										className="w-full text-left text-xs px-2 py-1.5 rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{isForking ? "创建中..." : "从这里创建分支"}
									</button>
								</div>
							</details>
						)}
					</div>
				</div>
				{showThinkingStatus && (
					<div className="mb-2 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
						<span
							className={cn(
								"inline-flex items-center gap-1.5",
								isStreaming ? "text-amber-500" : "text-emerald-500",
							)}
						>
							<span
								className={cn(
									"w-1.5 h-1.5 rounded-full",
									isStreaming ? "bg-amber-400 animate-pulse" : "bg-emerald-400",
								)}
							/>
							<span>{isStreaming ? "思考中..." : "思考完成"}</span>
						</span>
					</div>
				)}
				{message.meta?.reasoning && message.meta.reasoning.trim().length > 0 && (
					<div className="mb-3 rounded-xl border border-amber-200/60 dark:border-amber-500/20 bg-amber-50/70 dark:bg-amber-950/30 px-3 py-2">
						<div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700/80 dark:text-amber-300/80">
							思维链
						</div>
						<pre className="mt-2 whitespace-pre-wrap overflow-x-auto text-xs text-amber-900 dark:text-amber-100">
							{message.meta.reasoning}
						</pre>
					</div>
				)}
				{attachments.length > 0 && (
					<div className="mb-3 flex flex-wrap gap-2">
						{attachments.map((attachment) => {
							const src = attachment.data
								? `data:${attachment.mimeType};base64,${attachment.data}`
								: attachment.url;
							if (!src) return null;
							if (!attachment.mimeType.startsWith("image/")) {
								return (
									<a
										key={attachment.id}
										href={src}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/40 dark:border-neutral-800/60 bg-white/70 dark:bg-neutral-900/60 text-xs text-neutral-700 dark:text-neutral-200 hover:border-brand-400/60"
									>
										<span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-200/70 dark:bg-neutral-700/70">
											FILE
										</span>
										<span className="truncate max-w-40">
											{attachment.name || "附件"}
										</span>
									</a>
								);
							}
							return (
								<img
									key={attachment.id}
									src={src}
									alt={attachment.name || "上传图片"}
									className="w-28 h-28 rounded-xl object-cover border border-white/40 dark:border-neutral-800/60"
									loading="lazy"
								/>
							);
						})}
					</div>
				)}
				{isUser ? (
					message.content.trim().length > 0 && (
						<p className="whitespace-pre-wrap break-words">{message.content}</p>
					)
				) : showStreamingPlaceholder ? (
					<div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
						<span className="flex gap-1">
							<span className="w-2 h-2 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
							<span className="w-2 h-2 bg-secondary-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
							<span className="w-2 h-2 bg-accent-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
						</span>
						<span>思考中...</span>
					</div>
				) : (
					<MarkdownRenderer content={normalizedContent} />
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
							{searchProviderLabel}结果
						</div>
						<ul className="space-y-1">
							{message.meta.webSearch.results.map((result, index) => (
								<li key={`${result.id ?? index}`}>
									{result.author ? `@${result.author}: ` : ""}
									{result.title || result.text || ""}
									{result.url ? (
										<>
											{" "}
											<a
												href={result.url}
												target="_blank"
												rel="noopener noreferrer"
												className="text-brand-600 hover:underline dark:text-brand-300"
											>
												{result.url}
											</a>
										</>
									) : null}
								</li>
							))}
						</ul>
					</div>
				) : null}
				{citationUrls.length > 0 ? (
					<div className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
						<div className="font-medium text-neutral-600 dark:text-neutral-300 mb-1">
							{searchProviderLabel}引用
						</div>
						<ul className="space-y-1">
							{citationUrls.map((url, index) => (
								<li key={`${url}-${index}`}>
									<a
										href={url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-brand-600 hover:underline dark:text-brand-300"
									>
										{url}
									</a>
								</li>
							))}
						</ul>
					</div>
				) : null}
			</div>
		</div>
	);
}

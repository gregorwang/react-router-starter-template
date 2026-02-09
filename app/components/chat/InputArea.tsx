import { useState, useRef, useEffect, useCallback } from "react";
import { useChat } from "../../hooks/useChat";
import { useChat as useChatContext } from "../../contexts/ChatContext";
import { SendButton } from "./SendButton";
import { cn } from "../../lib/utils/cn";
import type { Attachment } from "../../lib/llm/types";
import { outlineActionButtonClass } from "../shared/form-styles";

const MAX_INPUT_CHARS = 20000;
const MIN_TEXTAREA_HEIGHT = 56;
const MAX_TEXTAREA_HEIGHT = MIN_TEXTAREA_HEIGHT * 2;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 4;
const XAI_ALLOWED_ATTACHMENT_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"application/pdf",
	"text/plain",
	"text/markdown",
	"text/csv",
	"application/json",
]);
const POLO_ALLOWED_ATTACHMENT_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"application/pdf",
]);

function formatMs(ms?: number) {
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}

function phaseLabel(phase: string) {
	switch (phase) {
		case "sending":
			return "请求已发出，等待服务端响应";
		case "streaming":
			return "模型正在流式返回";
		case "success":
			return "本轮请求完成";
		case "aborted":
			return "已手动停止";
		case "error":
			return "本轮请求失败";
		default:
			return "请求状态未知";
	}
}

function categoryLabel(category: string) {
	switch (category) {
		case "network":
			return "网络/连接";
		case "rate_limit":
			return "限流/额度";
		case "auth_config":
			return "鉴权/配置";
		case "payload_context":
			return "上下文/参数";
		case "upstream_model":
			return "模型上游";
		case "server":
			return "服务端";
		case "cancelled":
			return "用户中止";
		case "none":
			return "正常";
		default:
			return "未知";
	}
}

function insightToneClass(phase: string, category: string) {
	if (phase === "success") {
		return "border-emerald-200/80 dark:border-emerald-700/70 bg-emerald-50/70 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300";
	}
	if (phase === "sending" || phase === "streaming") {
		return "border-sky-200/80 dark:border-sky-700/70 bg-sky-50/70 dark:bg-sky-950/20 text-sky-700 dark:text-sky-300";
	}
	if (phase === "aborted" || category === "cancelled") {
		return "border-neutral-200/80 dark:border-neutral-700/70 bg-neutral-50/70 dark:bg-neutral-900/60 text-neutral-600 dark:text-neutral-300";
	}
	return "border-rose-200/80 dark:border-rose-700/70 bg-rose-50/70 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300";
}

export function InputArea({
	providerAvailable = true,
	providerUnavailableMessage,
}: {
	providerAvailable?: boolean;
	providerUnavailableMessage?: string;
}) {
	const [input, setInput] = useState("");
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const {
		sendMessage,
		currentConversation,
		abortGeneration,
		requestInsight,
		dismissRequestInsight,
	} = useChat();
	const { isStreaming } = useChatContext();
	const isXAIConversation = currentConversation?.provider === "xai";
	const canUploadAttachment =
		currentConversation?.provider === "poloai" ||
		currentConversation?.provider === "xai";
	const allowedAttachmentTypes = isXAIConversation
		? XAI_ALLOWED_ATTACHMENT_TYPES
		: POLO_ALLOWED_ATTACHMENT_TYPES;
	const acceptedAttachmentTypes = isXAIConversation
		? "image/png,image/jpeg,application/pdf,text/plain,text/markdown,text/csv,application/json"
		: "image/png,image/jpeg,image/webp,image/gif,application/pdf";
	const attachmentFormatHint = isXAIConversation
		? "JPG/PNG/PDF/TXT/MD/CSV/JSON"
		: "JPG/PNG/GIF/WebP/PDF";

	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			const nextHeight = Math.min(
				Math.max(textareaRef.current.scrollHeight, MIN_TEXTAREA_HEIGHT),
				MAX_TEXTAREA_HEIGHT,
			);
			textareaRef.current.style.height = `${nextHeight}px`;
			textareaRef.current.style.overflowY =
				textareaRef.current.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
		}
	}, [input]);

	const submitMessage = useCallback(async () => {
		const trimmed = input.trim();
		if ((!trimmed && attachments.length === 0) || isStreaming) return;

		if (trimmed.length > MAX_INPUT_CHARS) {
			alert(`输入过长，最多支持 ${MAX_INPUT_CHARS} 个字符。`);
			return;
		}
		const attachmentsToSend = attachments;
		setInput("");
		setAttachments([]);
		setAttachmentError(null);

		try {
			await sendMessage(trimmed, attachmentsToSend);
		} catch (error) {
			setInput(trimmed);
			setAttachments(attachmentsToSend);
			console.error("Error sending message:", error);
		}
	}, [attachments, input, isStreaming, sendMessage]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		await submitMessage();
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void submitMessage();
		}
	};

	const isTooLong = input.length > MAX_INPUT_CHARS;

	const handleAttachmentClick = () => {
		if (isStreaming || !canUploadAttachment) return;
		fileInputRef.current?.click();
	};

	const addAttachmentFiles = useCallback(
		async (files: File[]) => {
			if (files.length === 0) return;

			setAttachmentError(null);

			const remaining = Math.max(0, MAX_IMAGES - attachments.length);
			const queue = files.slice(0, remaining);
			const overshoot = files.length - queue.length;
			if (overshoot > 0) {
				setAttachmentError(`最多支持 ${MAX_IMAGES} 个附件，已忽略多余文件。`);
			}

			const next: Attachment[] = [];
			const currentTotalBytes = attachments.reduce(
				(total, item) => total + (item.size || 0),
				0,
			);
			let nextTotalBytes = currentTotalBytes;
			for (const file of queue) {
				if (!allowedAttachmentTypes.has(file.type)) {
					setAttachmentError(`仅支持 ${attachmentFormatHint} 格式。`);
					continue;
				}
				if (file.size > MAX_IMAGE_BYTES) {
					setAttachmentError("单个附件不能超过 5MB。");
					continue;
				}
				if (nextTotalBytes + file.size > MAX_TOTAL_IMAGE_BYTES) {
					setAttachmentError("附件总大小不能超过 10MB。");
					continue;
				}

				const base64 = await new Promise<string>((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => {
						const result = String(reader.result || "");
						const [, data] = result.split(",", 2);
						resolve(data || "");
					};
					reader.onerror = () => reject(new Error("读取图片失败"));
					reader.readAsDataURL(file);
				});

				if (!base64) {
					setAttachmentError("附件读取失败，请重试。");
					continue;
				}

				next.push({
					id: crypto.randomUUID(),
					mimeType: file.type as Attachment["mimeType"],
					data: base64,
					name: file.name,
					size: file.size,
				});
				nextTotalBytes += file.size;
			}

			if (next.length) {
				setAttachments((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
			}
		},
		[attachments, allowedAttachmentTypes, attachmentFormatHint],
	);

	const handleAttachmentChange = async (
		e: React.ChangeEvent<HTMLInputElement>,
	) => {
		const files = Array.from(e.target.files || []);
		await addAttachmentFiles(files);

		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		if (!canUploadAttachment || !providerAvailable || isStreaming) return;
		const items = Array.from(e.clipboardData.items || []);
		const files = items
			.filter((item) => item.kind === "file")
			.map((item) => item.getAsFile())
			.filter((file): file is File => Boolean(file));
		const imageFiles = files.filter((file) =>
			file.type.startsWith("image/"),
		);
		if (imageFiles.length === 0) return;
		e.preventDefault();
		void addAttachmentFiles(imageFiles);
	};

	const handleRemoveAttachment = (id: string) => {
		setAttachments((prev) => prev.filter((item) => item.id !== id));
	};

	if (!currentConversation) {
		return null;
	}
	const visibleInsight =
		requestInsight && requestInsight.conversationId === currentConversation.id
			? requestInsight
			: null;

	return (
		<form onSubmit={handleSubmit} className="relative">
			<div className="relative rounded-2xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/80 dark:bg-neutral-900/70 shadow-sm transition-all duration-200 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-400/40">
				{attachments.length > 0 && (
					<div className="px-3 pt-3 pr-16 flex flex-wrap gap-2">
						{attachments.map((attachment) => (
							attachment.mimeType.startsWith("image/") ? (
								<div
									key={attachment.id}
									className="relative w-20 h-20 rounded-xl overflow-hidden border border-neutral-200/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/60"
								>
									<img
										src={`data:${attachment.mimeType};base64,${attachment.data}`}
										alt={attachment.name || "上传图片"}
										className="w-full h-full object-cover"
									/>
									<button
										type="button"
										onClick={() => handleRemoveAttachment(attachment.id)}
										className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
										aria-label="移除附件"
									>
										×
									</button>
								</div>
							) : (
								<div
									key={attachment.id}
									className="relative h-20 min-w-40 max-w-52 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/60 px-3 py-2 pr-8 flex items-center gap-2"
								>
									<div className="w-8 h-8 rounded-lg bg-neutral-200/80 dark:bg-neutral-700/80 flex items-center justify-center text-[10px] font-semibold text-neutral-700 dark:text-neutral-200">
										FILE
									</div>
									<div className="min-w-0">
										<p className="text-xs text-neutral-700 dark:text-neutral-200 truncate">
											{attachment.name || "附件"}
										</p>
										<p className="text-[11px] text-neutral-600 dark:text-neutral-300 truncate">
											{attachment.mimeType}
										</p>
									</div>
									<button
										type="button"
										onClick={() => handleRemoveAttachment(attachment.id)}
										className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
										aria-label="移除附件"
									>
										×
									</button>
								</div>
							)
						))}
					</div>
				)}
				<textarea
					ref={textareaRef}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					onPaste={handlePaste}
					placeholder="输入消息..."
					className={cn(
						"w-full min-h-[56px] pl-4 py-4 rounded-2xl bg-transparent text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none resize-none overflow-y-auto overflow-x-hidden",
						isStreaming ? "pr-24" : "pr-16",
					)}
					rows={1}
					disabled={isStreaming || !providerAvailable}
				/>
				<div className="absolute right-2 bottom-2">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={handleAttachmentClick}
							disabled={!canUploadAttachment || isStreaming || !providerAvailable}
							className={cn(
								"w-9 h-9 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 text-neutral-600 dark:text-neutral-300 bg-white/70 dark:bg-neutral-900/60 shadow-sm hover:border-brand-400/60 hover:text-brand-700 dark:hover:text-brand-200 transition-all duration-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950",
								(!canUploadAttachment || !providerAvailable) &&
									"opacity-50 cursor-not-allowed",
							)}
							aria-label="上传附件"
							title={canUploadAttachment ? "上传附件" : "当前模型不支持附件输入"}
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="w-4 h-4 mx-auto"
							>
								<rect x="3" y="5" width="18" height="14" rx="2" />
								<circle cx="8.5" cy="10" r="1.5" />
								<path d="M21 15l-4.5-4.5a2 2 0 0 0-2.8 0L5 19" />
							</svg>
						</button>
						{isStreaming && (
							<button
								type="button"
								onClick={abortGeneration}
								className={outlineActionButtonClass}
							>
								停止
							</button>
						)}
						<SendButton
							disabled={
								(!input.trim() && attachments.length === 0) ||
								isStreaming ||
								!providerAvailable ||
								isTooLong
							}
						/>
					</div>
				</div>
			</div>
			<input
				ref={fileInputRef}
				type="file"
				accept={acceptedAttachmentTypes}
				multiple
				className="hidden"
				onChange={handleAttachmentChange}
			/>
			{visibleInsight && (
				<div
					className={cn(
						"mt-2 rounded-xl border px-3 py-2",
						insightToneClass(visibleInsight.phase, visibleInsight.category),
					)}
				>
					<div className="flex items-start justify-between gap-2">
						<div className="text-xs font-semibold leading-5">
							{phaseLabel(visibleInsight.phase)}
						</div>
						<button
							type="button"
							onClick={dismissRequestInsight}
							className="text-xs opacity-70 hover:opacity-100 transition-opacity"
							aria-label="隐藏状态"
						>
							关闭
						</button>
					</div>
					<div className="mt-1 text-[11px] leading-5">
						可能原因：{categoryLabel(visibleInsight.category)}
						{visibleInsight.httpStatus ? ` · HTTP ${visibleInsight.httpStatus}` : ""}
					</div>
					{visibleInsight.detail && (
						<div className="mt-1 text-[11px] leading-5 break-words">
							详情：{visibleInsight.detail}
						</div>
					)}
					<div className="mt-2 flex flex-wrap gap-1.5 text-[11px] leading-5">
						<span className="px-2 py-0.5 rounded-full border border-current/20">
							上下文 {visibleInsight.payloadMessageCount}/{visibleInsight.contextMessageCount} 条
						</span>
						<span className="px-2 py-0.5 rounded-full border border-current/20">
							摘要 {visibleInsight.summaryActive ? "开启" : "关闭"}
						</span>
						{visibleInsight.trimmed && (
							<span className="px-2 py-0.5 rounded-full border border-current/20">
								已裁剪
							</span>
						)}
						{typeof visibleInsight.outputTokens === "number" && (
							<span className="px-2 py-0.5 rounded-full border border-current/20">
								输出预算 {(visibleInsight.outputTokens / 1024).toFixed(1).replace(/\.0$/, "")}k
							</span>
						)}
						{formatMs(visibleInsight.firstTokenMs) && (
							<span className="px-2 py-0.5 rounded-full border border-current/20">
								首 Token {formatMs(visibleInsight.firstTokenMs)}
							</span>
						)}
						{formatMs(visibleInsight.durationMs) && (
							<span className="px-2 py-0.5 rounded-full border border-current/20">
								总耗时 {formatMs(visibleInsight.durationMs)}
							</span>
						)}
						{typeof visibleInsight.totalTokens === "number" && (
							<span className="px-2 py-0.5 rounded-full border border-current/20">
								总 Token {visibleInsight.totalTokens}
							</span>
						)}
					</div>
				</div>
			)}
			{!providerAvailable && (
				<p className="mt-2 text-xs text-rose-500">
					{providerUnavailableMessage || "当前模型密钥未配置，请在环境变量中设置。"}
				</p>
			)}
			{attachmentError && (
				<p className="mt-2 text-xs text-amber-600">{attachmentError}</p>
			)}
			{isTooLong && (
				<p className="mt-2 text-xs text-amber-600">
					当前输入 {input.length} 字符，已超过上限 {MAX_INPUT_CHARS}。
				</p>
			)}
			{canUploadAttachment && (
				<p className="mt-2 text-xs text-neutral-500 dark:text-neutral-300">
					最多 {MAX_IMAGES} 个附件，支持上传（图片支持粘贴），单个不超过 5MB，总计不超过 10MB（{attachmentFormatHint}）。
				</p>
			)}
		</form>
	);
}

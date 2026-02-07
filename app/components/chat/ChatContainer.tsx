import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import { cn } from "../../lib/utils/cn";
import { useChat } from "../../contexts/ChatContext";
import {
	PROVIDER_MODELS,
	PROVIDER_NAMES,
	type LLMProvider,
	type Message,
	type XAISearchMode,
} from "../../lib/llm/types";
import { useTheme } from "../../hooks/useTheme";
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Button } from "../shared/Button";
import { selectBaseClass, selectCompactClass } from "../shared/form-styles";
import {
	createContextClearedEventMessage,
	getMessagesInActiveContext,
	isChatTurnMessage,
} from "../../lib/chat/context-boundary";

interface ChatContainerProps {
	className?: string;
	onOpenSidebar?: () => void;
	onToggleSidebar?: () => void;
	isSidebarCollapsed?: boolean;
	activeProjectName?: string;
	providerAvailability?: Partial<Record<LLMProvider, boolean>>;
	modelAvailability?: Record<string, { available: boolean; reason?: string }>;
}

type SessionStatePayload = {
	projectId?: string;
	provider?: LLMProvider;
	model?: string;
	reasoningEffort?: "low" | "medium" | "high";
	enableThinking?: boolean;
	thinkingBudget?: number;
	thinkingLevel?: "low" | "medium" | "high";
	outputTokens?: number;
	outputEffort?: "low" | "medium" | "high" | "max";
	webSearch?: boolean;
	xaiSearchMode?: XAISearchMode;
	enableTools?: boolean;
};

export function ChatContainer({
	className,
	onOpenSidebar,
	onToggleSidebar,
	isSidebarCollapsed = false,
	activeProjectName,
	providerAvailability,
	modelAvailability,
}: ChatContainerProps) {
	const { currentConversation, setCurrentConversation, isStreaming } = useChat();
	const { theme, toggleTheme } = useTheme();
	const [isCompacting, setIsCompacting] = useState(false);
	const [isArchiving, setIsArchiving] = useState(false);
	const [isClearingContext, setIsClearingContext] = useState(false);
	const sessionSyncTimerRef = useRef<number | null>(null);
	const lastSessionSyncSignatureRef = useRef<string>("");

	const isProviderAvailable = (provider: LLMProvider) => {
		if (!providerAvailability) return true;
		return providerAvailability[provider] !== false;
	};
	const currentProviderAvailable = currentConversation
		? isProviderAvailable(currentConversation.provider)
		: true;
	const isModelAvailable = (provider: LLMProvider, model: string) => {
		if (!modelAvailability) return true;
		const entry = modelAvailability[`${provider}:${model}`];
		if (!entry) return true;
		return entry.available !== false;
	};
	const getModelUnavailableLabel = (provider: LLMProvider, model: string) => {
		const entry = modelAvailability?.[`${provider}:${model}`];
		if (!entry || entry.available !== false) return null;
		return entry.reason || "未授权";
	};
	const currentModelAvailable = currentConversation
		? currentProviderAvailable &&
			isModelAvailable(currentConversation.provider, currentConversation.model)
		: true;
	const getUnavailableLabel = (provider: LLMProvider) =>
		provider === "workers-ai" ? "暂时不可用" : "未配置";
	const getUnavailableMessage = (provider: LLMProvider) =>
		provider === "workers-ai"
			? "Workers AI 暂时不可用。"
			: "当前模型密钥未配置，请在环境变量中设置。";
	const currentUnavailableNotice =
		currentConversation && !currentModelAvailable
			? !currentProviderAvailable
				? currentConversation.provider === "workers-ai"
					? "Workers AI 暂时不可用"
					: "当前模型密钥未配置"
				: "当前模型未授权"
			: null;
	const currentUnavailableMessage =
		currentConversation && !currentModelAvailable
			? !currentProviderAvailable
				? getUnavailableMessage(currentConversation.provider)
				: "当前模型未授权或已被管理员禁用。"
			: undefined;
	const activeContextMessageCount = currentConversation
		? getMessagesInActiveContext(currentConversation.messages).filter(isChatTurnMessage)
				.length
		: 0;
	const isConversationPersisted = Boolean(currentConversation?.isPersisted);

	const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		if (!currentConversation) return;
		const [provider, model] = e.target.value.split(":");
		const nextProvider = provider as LLMProvider;
		setCurrentConversation({
			...currentConversation,
			provider: nextProvider,
			model: model,
			xaiSearchMode:
				nextProvider === "xai" ? (currentConversation.xaiSearchMode ?? "x") : undefined,
		});
	};

	const handleCompact = async () => {
		if (!currentConversation || !isConversationPersisted || isCompacting) return;
		setIsCompacting(true);
		try {
			const response = await fetch("/conversations/compact", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ conversationId: currentConversation.id }),
			});
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(errorText || `Server error: ${response.status}`);
			}
			const data = (await response.json()) as {
				summary?: string;
				summaryUpdatedAt?: number;
				summaryMessageCount?: number;
			};
			setCurrentConversation((prev) => {
				if (!prev) return prev;
				return {
					...prev,
					summary: data.summary ?? prev.summary,
					summaryUpdatedAt: data.summaryUpdatedAt ?? prev.summaryUpdatedAt,
					summaryMessageCount:
						data.summaryMessageCount ?? prev.summaryMessageCount,
				};
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "记忆压缩失败";
			alert(message);
		} finally {
			setIsCompacting(false);
		}
	};

	const handleArchive = async () => {
		if (!currentConversation || !isConversationPersisted || isArchiving) return;
		setIsArchiving(true);
		try {
			const response = await fetch("/conversations/archive", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ conversationId: currentConversation.id }),
			});
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(errorText || `Server error: ${response.status}`);
			}
			const data = (await response.json()) as { key?: string };
			alert(data.key ? `已归档：${data.key}` : "已归档");
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "归档失败";
			alert(message);
		} finally {
			setIsArchiving(false);
		}
	};

	const handleClearContext = async () => {
		if (
			!currentConversation ||
			!isConversationPersisted ||
			isClearingContext ||
			isStreaming
		) {
			return;
		}

		const confirmed =
			currentConversation.messages.length === 0 ||
			window.confirm(
				"清除后，后续回复将不再使用当前分隔线之前的对话上下文。是否继续？",
			);
		if (!confirmed) return;

		setIsClearingContext(true);
		try {
			const response = await fetch("/conversations/clear-context", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ conversationId: currentConversation.id }),
			});
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(errorText || `Server error: ${response.status}`);
			}

			const data = (await response.json()) as {
				message?: Message;
				clearedAt?: number;
			};
			const marker =
				data.message ||
				createContextClearedEventMessage(data.clearedAt || Date.now());
			setCurrentConversation((prev) => {
				if (!prev || prev.id !== currentConversation.id) return prev;
				return {
					...prev,
					messages: [...prev.messages, marker],
					summary: undefined,
					summaryUpdatedAt: undefined,
					summaryMessageCount: undefined,
					updatedAt: marker.timestamp,
				};
			});
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "清除上下文失败";
			alert(message);
		} finally {
			setIsClearingContext(false);
		}
	};

	const summaryLabel =
		currentConversation?.summaryUpdatedAt
			? `已压缩 ${format(
					new Date(currentConversation.summaryUpdatedAt),
					"yyyy-MM-dd HH:mm",
				)} · 覆盖 ${currentConversation.summaryMessageCount ?? 0} 条`
			: null;
	const forkNotice =
		currentConversation?.forkedFromConversationId &&
		currentConversation?.forkedFromMessageId
			? `Forked from ${currentConversation.forkedFromConversationId} at message ${currentConversation.forkedFromMessageId}${
					currentConversation.forkedAt
						? ` (${format(new Date(currentConversation.forkedAt), "yyyy-MM-dd HH:mm:ss")})`
						: ""
				}`
			: null;

	const sessionConversationId = currentConversation?.id;
	const sessionPatch = useMemo(() => {
		if (!sessionConversationId || !currentConversation) return null;
		return {
			projectId: currentConversation.projectId,
			provider: currentConversation.provider,
			model: currentConversation.model,
			reasoningEffort: currentConversation.reasoningEffort,
			enableThinking: currentConversation.enableThinking,
			thinkingBudget: currentConversation.thinkingBudget,
			thinkingLevel: currentConversation.thinkingLevel,
			outputTokens: currentConversation.outputTokens,
			outputEffort: currentConversation.outputEffort,
			webSearch: currentConversation.webSearch,
			xaiSearchMode: currentConversation.xaiSearchMode,
			enableTools: currentConversation.enableTools,
		};
	}, [
		sessionConversationId,
		currentConversation?.projectId,
		currentConversation?.provider,
		currentConversation?.model,
		currentConversation?.reasoningEffort,
		currentConversation?.enableThinking,
		currentConversation?.thinkingBudget,
		currentConversation?.thinkingLevel,
		currentConversation?.outputTokens,
		currentConversation?.outputEffort,
		currentConversation?.webSearch,
		currentConversation?.xaiSearchMode,
		currentConversation?.enableTools,
	]);

	const sessionPatchSignature = sessionPatch ? JSON.stringify(sessionPatch) : "";

	useEffect(() => {
		if (!sessionConversationId || !sessionPatch) return;
		if (sessionPatchSignature === lastSessionSyncSignatureRef.current) return;

		if (sessionSyncTimerRef.current) {
			window.clearTimeout(sessionSyncTimerRef.current);
		}

		sessionSyncTimerRef.current = window.setTimeout(() => {
			void (async () => {
				try {
					const response = await fetch("/conversations/session", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							conversationId: currentConversation.id,
							projectId: sessionPatch.projectId,
							patch: sessionPatch,
						}),
					});
					if (!response.ok) return;
					const data = (await response.json()) as {
						ok?: boolean;
						state?: SessionStatePayload;
					};
					if (!data.ok || !data.state) return;
					lastSessionSyncSignatureRef.current = sessionPatchSignature;
					setCurrentConversation((prev) => {
						if (!prev || prev.id !== sessionConversationId) return prev;
						return {
							...prev,
							projectId: data.state?.projectId ?? prev.projectId,
							provider: data.state?.provider ?? prev.provider,
							model: data.state?.model ?? prev.model,
							reasoningEffort: data.state?.reasoningEffort ?? prev.reasoningEffort,
							enableThinking: data.state?.enableThinking ?? prev.enableThinking,
							thinkingBudget: data.state?.thinkingBudget ?? prev.thinkingBudget,
							thinkingLevel: data.state?.thinkingLevel ?? prev.thinkingLevel,
							outputTokens: data.state?.outputTokens ?? prev.outputTokens,
							outputEffort: data.state?.outputEffort ?? prev.outputEffort,
							webSearch: data.state?.webSearch ?? prev.webSearch,
							xaiSearchMode: data.state?.xaiSearchMode ?? prev.xaiSearchMode,
							enableTools: data.state?.enableTools ?? prev.enableTools,
						};
					});
				} catch {
					// Ignore session sync failures and keep local state.
				}
			})();
		}, 350);

		return () => {
			if (sessionSyncTimerRef.current) {
				window.clearTimeout(sessionSyncTimerRef.current);
				sessionSyncTimerRef.current = null;
			}
		};
	}, [sessionConversationId, sessionPatch, sessionPatchSignature, setCurrentConversation]);

	return (
		<div className={cn("flex flex-col flex-1 min-h-0 relative", className)}>
			{/* Header with Model Selector */}
			<div className="h-16 border-b border-white/60 dark:border-neutral-800/70 flex items-center px-4 md:px-6 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl sticky top-0 z-20">
				<div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto md:overflow-visible">
					{onOpenSidebar && (
						<button
							type="button"
							onClick={onOpenSidebar}
							className="md:hidden p-2 -ml-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60 transition-colors focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
							aria-label="打开侧边栏"
						>
							☰
						</button>
					)}
					{onToggleSidebar && (
						<button
							type="button"
							onClick={onToggleSidebar}
							className="hidden md:inline-flex p-2 -ml-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60 transition-colors focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
							aria-label={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
						>
							{isSidebarCollapsed ? (
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="w-5 h-5"
								>
									<polyline points="9 18 15 12 9 6"></polyline>
								</svg>
							) : (
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									className="w-5 h-5"
								>
									<polyline points="15 18 9 12 15 6"></polyline>
								</svg>
							)}
						</button>
					)}
					{activeProjectName && (
						<span className="text-[10px] uppercase tracking-[0.25em] text-neutral-400 hidden sm:block">
							{activeProjectName}
						</span>
					)}
					<select
						className={cn(selectBaseClass, "cursor-pointer font-semibold")}
						value={currentConversation ? `${currentConversation.provider}:${currentConversation.model}` : ""}
						onChange={handleModelChange}
						disabled={!currentConversation}
					>
						{Object.entries(PROVIDER_MODELS).flatMap(([provider, models]) => {
							const available = isProviderAvailable(provider as LLMProvider);
							return models.map((model) => (
								<option
									key={`${provider}:${model}`}
									value={`${provider}:${model}`}
									disabled={
										!available ||
										!isModelAvailable(provider as LLMProvider, model)
									}
								>
									{PROVIDER_NAMES[provider as LLMProvider]} - {model}
									{!available
										? `（${getUnavailableLabel(provider as LLMProvider)}）`
										: getModelUnavailableLabel(
													provider as LLMProvider,
													model,
												)
											? `（${getModelUnavailableLabel(
													provider as LLMProvider,
													model,
												)}）`
											: ""}
								</option>
							));
						})}
					</select>

					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleClearContext}
						disabled={
							!currentConversation ||
							!isConversationPersisted ||
							isStreaming ||
							isClearingContext
						}
						className="ml-2 text-neutral-600 dark:text-neutral-300 disabled:opacity-40"
						title="开始新的上下文段，后续请求不再携带此前消息"
					>
						{isClearingContext ? "清除中..." : "清除上下文"}
					</Button>

					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleCompact}
						disabled={
							!currentConversation ||
							!isConversationPersisted ||
							isStreaming ||
							isCompacting ||
							activeContextMessageCount < 2
						}
						className="ml-2 text-neutral-600 dark:text-neutral-300 disabled:opacity-40"
						title="将当前对话压缩为摘要，用于后续上下文"
					>
						{isCompacting ? "压缩中..." : "记忆压缩"}
					</Button>

					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={handleArchive}
						disabled={
							!currentConversation ||
							!isConversationPersisted ||
							isStreaming ||
							isArchiving
						}
						className="ml-2 text-neutral-600 dark:text-neutral-300 disabled:opacity-40"
						title="将当前对话完整归档到 R2"
					>
						{isArchiving ? "归档中..." : "一键归档"}
					</Button>

					{summaryLabel && (
						<span className="text-xs text-neutral-400 ml-2 hidden sm:block">
							{summaryLabel}
						</span>
					)}
					{currentConversation && !currentProviderAvailable && (
						<span className="text-xs text-rose-500 ml-2">
							{currentUnavailableNotice}
						</span>
					)}

					{currentConversation?.model === "o3" && (
						<select
							className={cn(selectCompactClass, "cursor-pointer ml-2 text-neutral-600 dark:text-neutral-300")}
							value={currentConversation.reasoningEffort || "high"}
							onChange={(e) => setCurrentConversation({ ...currentConversation, reasoningEffort: e.target.value as "low" | "medium" | "high" })}
						>
							<option value="low">推理强度：低</option>
							<option value="medium">推理强度：中</option>
							<option value="high">推理强度：高</option>
						</select>
					)}

					{currentConversation?.model === "kimi-k2.5" && (
						<label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none">
							<input
								type="checkbox"
								className="w-3.5 h-3.5 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
								checked={currentConversation.enableThinking ?? true}
								onChange={(e) => setCurrentConversation({ ...currentConversation, enableThinking: e.target.checked })}
							/>
							<span className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">允许思考</span>
						</label>
					)}

					{currentConversation?.provider === "ark" && (
						<label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none">
							<input
								type="checkbox"
								className="w-3.5 h-3.5 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
								checked={currentConversation.enableThinking ?? true}
								onChange={(e) => setCurrentConversation({ ...currentConversation, enableThinking: e.target.checked })}
							/>
							<span className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">思考</span>
						</label>
					)}

					{currentConversation?.model === "claude-sonnet-4.5" && (
						<div className="flex items-center gap-2 ml-2">
							<span className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">思考预算：</span>
							<input
								type="range"
								min="1024"
								max="32768"
								step="1024"
								className="w-24 h-1.5 bg-neutral-200 rounded-lg appearance-none cursor-pointer dark:bg-neutral-700 accent-brand-600"
								value={currentConversation.thinkingBudget || 12288}
								onChange={(e) => setCurrentConversation({ ...currentConversation, thinkingBudget: parseInt(e.target.value) })}
								title={`思考预算：${currentConversation.thinkingBudget || 12288} tokens`}
							/>
							<span className="text-xs text-neutral-500 w-12 text-right">
								{(currentConversation.thinkingBudget || 12288) / 1024}k
							</span>
						</div>
					)}

					{currentConversation?.model === "gemini-3-pro" && (
						<>
							<select
								className={cn(selectCompactClass, "cursor-pointer ml-2 text-neutral-600 dark:text-neutral-300")}
								value={currentConversation.thinkingLevel || "high"}
								onChange={(e) => setCurrentConversation({ ...currentConversation, thinkingLevel: e.target.value as "low" | "medium" | "high" })}
							>
								<option value="low">思考强度：低</option>
								<option value="medium">思考强度：中</option>
								<option value="high">思考强度：高</option>
							</select>

							<label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none">
								<input
									type="checkbox"
									className="w-3.5 h-3.5 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
									checked={currentConversation.webSearch ?? true}
									onChange={(e) => setCurrentConversation({ ...currentConversation, webSearch: e.target.checked })}
								/>
								<span className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">网络搜索</span>
							</label>
						</>
					)}

					{currentConversation?.provider === "xai" && (
						<>
							<label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none">
								<input
									type="checkbox"
									className="w-3.5 h-3.5 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
									checked={currentConversation.webSearch ?? true}
									onChange={(e) =>
										setCurrentConversation({
											...currentConversation,
											webSearch: e.target.checked,
											xaiSearchMode: currentConversation.xaiSearchMode ?? "x",
										})
									}
								/>
								<span className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">
									启用搜索
								</span>
							</label>
							{(currentConversation.webSearch ?? true) && (
								<select
									className={cn(selectCompactClass, "cursor-pointer ml-2 text-neutral-600 dark:text-neutral-300")}
									value={currentConversation.xaiSearchMode ?? "x"}
									onChange={(e) =>
										setCurrentConversation({
											...currentConversation,
											xaiSearchMode: e.target.value as XAISearchMode,
										})
									}
								>
									<option value="x">仅 X 帖子</option>
									<option value="web">仅网页</option>
									<option value="both">网页 + X</option>
								</select>
							)}
						</>
					)}

					{currentConversation?.provider === "poloai" &&
						currentConversation.model.startsWith("claude-opus") && (
							<select
								className={cn(selectCompactClass, "cursor-pointer ml-2 text-neutral-600 dark:text-neutral-300")}
								value={currentConversation.outputEffort || "max"}
								onChange={(e) =>
									setCurrentConversation({
										...currentConversation,
										outputEffort: e.target.value as
											| "low"
											| "medium"
											| "high"
											| "max",
									})
								}
							>
								<option value="low">输出强度：低</option>
								<option value="medium">输出强度：中</option>
								<option value="high">输出强度：高</option>
								<option value="max">输出强度：最大</option>
							</select>
						)}

					{currentConversation?.provider === "poloai" && (
						<div className="flex items-center gap-2 ml-2">
							<span className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">
								输出预算：
							</span>
							<input
								type="range"
								min="512"
								max="32768"
								step="512"
								className="w-24 h-1.5 bg-neutral-200 rounded-lg appearance-none cursor-pointer dark:bg-neutral-700 accent-brand-600"
								value={currentConversation.outputTokens || 2048}
								onChange={(e) =>
									setCurrentConversation({
										...currentConversation,
										outputTokens: parseInt(e.target.value),
									})
								}
								title={`输出预算：${currentConversation.outputTokens || 2048} tokens`}
							/>
							<span className="text-xs text-neutral-500 w-12 text-right">
								{(() => {
									const value = currentConversation.outputTokens || 2048;
									const kValue = value / 1024;
									const label = kValue.toFixed(1).replace(/\.0$/, "");
									return `${label}k`;
								})()}
							</span>
						</div>
					)}

					{currentConversation?.provider === "poloai" && (
						<label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none">
							<input
								type="checkbox"
								className="w-3.5 h-3.5 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
								checked={currentConversation.webSearch ?? true}
								onChange={(e) =>
									setCurrentConversation({
										...currentConversation,
										webSearch: e.target.checked,
									})
								}
							/>
							<span className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">
								网络搜索
							</span>
						</label>
					)}
					{currentConversation?.provider === "poloai" && (
						<label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none">
							<input
								type="checkbox"
								className="w-3.5 h-3.5 rounded border-neutral-300 text-brand-600 focus:ring-brand-500"
								checked={currentConversation.enableTools ?? true}
								onChange={(e) =>
									setCurrentConversation({
										...currentConversation,
										enableTools: e.target.checked,
									})
								}
							/>
							<span className="text-xs text-neutral-600 dark:text-neutral-400 font-medium">
								函数调用
							</span>
						</label>
					)}
				</div>
				<button
					type="button"
					onClick={toggleTheme}
					aria-label="切换明暗模式"
					className="ml-3 w-10 h-10 rounded-full border border-white/60 dark:border-neutral-700/70 bg-white/80 dark:bg-neutral-900/70 text-neutral-600 dark:text-neutral-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
				>
					{theme === "dark" ? (
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="w-5 h-5"
						>
							<circle cx="12" cy="12" r="4"></circle>
							<line x1="12" y1="2" x2="12" y2="4"></line>
							<line x1="12" y1="20" x2="12" y2="22"></line>
							<line x1="4.93" y1="4.93" x2="6.34" y2="6.34"></line>
							<line x1="17.66" y1="17.66" x2="19.07" y2="19.07"></line>
							<line x1="2" y1="12" x2="4" y2="12"></line>
							<line x1="20" y1="12" x2="22" y2="12"></line>
							<line x1="4.93" y1="19.07" x2="6.34" y2="17.66"></line>
							<line x1="17.66" y1="6.34" x2="19.07" y2="4.93"></line>
						</svg>
					) : (
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="w-5 h-5"
						>
							<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 1 0 9.8 9.8z"></path>
						</svg>
					)}
				</button>
			</div>
			{forkNotice && (
				<div className="px-4 md:px-6 py-2 border-b border-white/60 dark:border-neutral-800/70 bg-amber-50/70 dark:bg-amber-950/20 text-xs text-amber-700 dark:text-amber-300">
					{forkNotice}
				</div>
			)}

			<div className="flex-1 min-h-0 overflow-hidden">
				<MessageList />
			</div>
			<div className="border-t border-white/60 dark:border-neutral-800/70 p-4 md:p-6 bg-white/60 dark:bg-neutral-900/60 backdrop-blur-xl">
				<InputArea
					providerAvailable={currentModelAvailable}
					providerUnavailableMessage={currentUnavailableMessage}
				/>
			</div>
		</div>
	);
}

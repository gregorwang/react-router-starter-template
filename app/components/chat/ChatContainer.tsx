import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import { StreamingIndicator } from "./StreamingIndicator";
import { cn } from "../../lib/utils/cn";
import { useChat } from "../../contexts/ChatContext";
import { PROVIDER_MODELS, PROVIDER_NAMES, type LLMProvider } from "../../lib/llm/types";

interface ChatContainerProps {
	className?: string;
	onOpenSidebar?: () => void;
	activeProjectName?: string;
}

export function ChatContainer({
	className,
	onOpenSidebar,
	activeProjectName,
}: ChatContainerProps) {
	const { currentConversation, setCurrentConversation } = useChat();

	const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		if (!currentConversation) return;
		const [provider, model] = e.target.value.split(":");
		setCurrentConversation({
			...currentConversation,
			provider: provider as LLMProvider,
			model: model,
		});
	};

	return (
		<div className={cn("flex flex-col flex-1 h-full", className)}>
			{/* Header with Model Selector */}
			<div className="h-14 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 bg-white dark:bg-gray-900 relative">
				<div className="flex items-center gap-2 flex-1">
					{onOpenSidebar && (
						<button
							type="button"
							onClick={onOpenSidebar}
							className="md:hidden p-2 -ml-2 text-gray-600 dark:text-gray-300"
							aria-label="打开侧边栏"
						>
							☰
						</button>
					)}
					{activeProjectName && (
						<span className="text-xs uppercase tracking-wide text-gray-400 hidden sm:block">
							{activeProjectName}
						</span>
					)}
					<select
						className="text-sm border-none bg-transparent text-gray-700 dark:text-gray-300 focus:ring-0 cursor-pointer font-medium"
						value={currentConversation ? `${currentConversation.provider}:${currentConversation.model}` : ""}
						onChange={handleModelChange}
						disabled={!currentConversation}
					>
						{Object.entries(PROVIDER_MODELS).flatMap(([provider, models]) =>
							models.map((model) => (
								<option key={`${provider}:${model}`} value={`${provider}:${model}`}>
									{PROVIDER_NAMES[provider as LLMProvider]} - {model}
								</option>
							))
						)}
					</select>

					{currentConversation?.model === "o3" && (
						<select
							className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-transparent text-gray-600 dark:text-gray-400 focus:ring-1 cursor-pointer ml-2"
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
								className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
								checked={currentConversation.enableThinking ?? true}
								onChange={(e) => setCurrentConversation({ ...currentConversation, enableThinking: e.target.checked })}
							/>
							<span className="text-xs text-gray-600 dark:text-gray-400 font-medium">允许思考</span>
						</label>
					)}

					{currentConversation?.model === "claude-sonnet-4.5" && (
						<div className="flex items-center gap-2 ml-2">
							<span className="text-xs text-gray-600 dark:text-gray-400 font-medium">思考预算：</span>
							<input
								type="range"
								min="1024"
								max="32768"
								step="1024"
								className="w-24 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
								value={currentConversation.thinkingBudget || 12288}
								onChange={(e) => setCurrentConversation({ ...currentConversation, thinkingBudget: parseInt(e.target.value) })}
								title={`思考预算：${currentConversation.thinkingBudget || 12288} tokens`}
							/>
							<span className="text-xs text-gray-500 w-12 text-right">
								{(currentConversation.thinkingBudget || 12288) / 1024}k
							</span>
						</div>
					)}

					{currentConversation?.model === "gemini-3-pro" && (
						<>
							<select
								className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-transparent text-gray-600 dark:text-gray-400 focus:ring-1 cursor-pointer ml-2"
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
									className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
									checked={currentConversation.webSearch ?? true}
									onChange={(e) => setCurrentConversation({ ...currentConversation, webSearch: e.target.checked })}
								/>
								<span className="text-xs text-gray-600 dark:text-gray-400 font-medium">网络搜索</span>
							</label>
						</>
					)}

					{currentConversation?.provider === "xai" && (
						<label className="flex items-center gap-1.5 ml-2 cursor-pointer select-none">
							<input
								type="checkbox"
								className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
								checked={currentConversation.webSearch ?? true}
								onChange={(e) =>
									setCurrentConversation({
										...currentConversation,
										webSearch: e.target.checked,
									})
								}
							/>
							<span className="text-xs text-gray-600 dark:text-gray-400 font-medium">
								X 搜索
							</span>
						</label>
					)}
				</div>
			</div>

			<div className="flex-1 overflow-y-auto">
				<MessageList />
			</div>
			<div className="border-t border-gray-200 dark:border-gray-800 p-4">
				<InputArea />
				<StreamingIndicator />
			</div>
		</div>
	);
}

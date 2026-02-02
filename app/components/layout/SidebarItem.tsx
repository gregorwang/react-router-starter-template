import { Link, useFetcher } from "react-router";
import type { Conversation } from "../../lib/llm/types";
import { cn } from "../../lib/utils/cn";

interface SidebarItemProps {
	conversation: Conversation;
	active: boolean;
}

export function SidebarItem({
	conversation,
	active,
}: SidebarItemProps) {
	const fetcher = useFetcher();
	const isDeleting = fetcher.state !== "idle";
	const projectParam = conversation.projectId
		? `?project=${conversation.projectId}`
		: "";

	return (
		<div className="group relative flex items-center">
			<Link
				to={`/c/${conversation.id}${projectParam}`}
				className={cn(
					"flex-1 flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors pr-8",
					active
						? "bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
						: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
				)}
			>
				<span className="truncate">{conversation.title}</span>
			</Link>
			<fetcher.Form
				method="delete"
				action="/conversations/delete"
				className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity"
			>
				<input type="hidden" name="conversationId" value={conversation.id} />
				<input
					type="hidden"
					name="projectId"
					value={conversation.projectId || ""}
				/>
				<button
					type="submit"
					disabled={isDeleting}
					className="p-1 text-gray-400 hover:text-red-500 rounded"
					title="删除对话"
					onClick={(e) => {
						if (!confirm("确定要删除这条对话吗？")) {
							e.preventDefault();
						}
					}}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<polyline points="3 6 5 6 21 6"></polyline>
						<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
					</svg>
				</button>
			</fetcher.Form>
		</div>
	);
}

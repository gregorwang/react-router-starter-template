import { Link } from "react-router";
import type { Conversation } from "../../lib/llm/types";
import { cn } from "../../lib/utils/cn";

interface SidebarItemProps {
	conversation: Conversation;
	active: boolean;
	onDelete: () => void;
}

export function SidebarItem({
	conversation,
	active,
	onDelete,
}: SidebarItemProps) {
	const handleDelete = (e: React.MouseEvent) => {
		e.preventDefault();
		if (confirm("Delete this conversation?")) {
			onDelete();
		}
	};

	return (
		<Link
			to={`/c/${conversation.id}`}
			className={cn(
				"flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors group",
				active
					? "bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
					: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
			)}
		>
			<span className="truncate flex-1">{conversation.title}</span>
			<button
				onClick={handleDelete}
				className="opacity-0 group-hover:opacity-100 ml-2 text-gray-500 hover:text-red-500 transition-opacity"
				title="Delete conversation"
			>
				<svg
					className="w-4 h-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
					/>
				</svg>
			</button>
		</Link>
	);
}

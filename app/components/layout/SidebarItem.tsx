import { Link } from "react-router";
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
		</Link>
	);
}

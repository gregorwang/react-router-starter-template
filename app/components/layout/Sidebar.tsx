import { Link, useLocation } from "react-router";
import { Button } from "../shared/Button";
import { SidebarItem } from "./SidebarItem";
import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils/cn";
import type { Conversation } from "../../lib/llm/types";

interface SidebarProps {
	className?: string;
	onNewChat?: () => void;
	conversations?: Conversation[];
}

export function Sidebar({ className, onNewChat, conversations = [] }: SidebarProps) {
	const location = useLocation();
	const { theme, toggleTheme } = useTheme();

	const isActive = (path: string) => {
		return location.pathname === path;
	};

	return (
		<aside
			className={cn(
				"w-72 h-screen bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col",
				className,
			)}
		>
			<div className="p-4">
				<Button onClick={onNewChat} className="w-full">
					New Chat
				</Button>
			</div>

			<nav className="flex-1 overflow-y-auto px-2">
				{conversations.length === 0 ? (
					<p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">
						No conversations yet
					</p>
				) : (
					<ul className="space-y-1">
						{conversations.map((conv) => (
							<li key={conv.id}>
								<SidebarItem
									conversation={conv}
									active={isActive(`/c/${conv.id}`)}
								/>
							</li>
						))}
					</ul>
				)}
			</nav>

			<div className="p-4 border-t border-gray-200 dark:border-gray-800">
				<ul className="space-y-1">
					<li>
						<Link
							to="/conversations"
							className={cn(
								"block px-3 py-2 rounded-md text-sm font-medium transition-colors",
								isActive("/conversations")
									? "bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
									: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
							)}
						>
							All Conversations
						</Link>
					</li>
					<li>
						<Link
							to="/settings"
							className={cn(
								"block px-3 py-2 rounded-md text-sm font-medium transition-colors",
								isActive("/settings")
									? "bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
									: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
							)}
						>
							Settings
						</Link>
					</li>
					<li>
						<button
							onClick={toggleTheme}
							className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
						>
							{theme === "dark" ? "Light Mode" : "Dark Mode"}
						</button>
					</li>
				</ul>
			</div>
		</aside>
	);
}

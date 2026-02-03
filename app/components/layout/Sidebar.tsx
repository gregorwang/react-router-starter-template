import { Form, Link, useLocation } from "react-router";
import { Button } from "../shared/Button";
import { SidebarItem } from "./SidebarItem";
import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils/cn";
import type { Conversation, Project } from "../../lib/llm/types";

interface SidebarProps {
	className?: string;
	onNewChat?: () => void;
	conversations?: Conversation[];
	projects?: Project[];
	activeProjectId?: string;
	onProjectChange?: (projectId: string) => void;
	onNewProject?: () => void;
	isOpen?: boolean;
	onClose?: () => void;
}

export function Sidebar({
	className,
	onNewChat,
	conversations = [],
	projects = [],
	activeProjectId,
	onProjectChange,
	onNewProject,
	isOpen = true,
	onClose,
}: SidebarProps) {
	const location = useLocation();
	const { theme, toggleTheme } = useTheme();

	const isActive = (path: string) => {
		return location.pathname === path;
	};

	return (
		<aside
			className={cn(
				"w-72 h-screen bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col transition-transform duration-200 md:translate-x-0",
				isOpen ? "translate-x-0" : "-translate-x-full",
				className,
			)}
		>
			<div className="p-4 space-y-3">
				<div className="flex items-center justify-between md:justify-start">
					<Button onClick={onNewChat} className="w-full">
						新对话
					</Button>
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							aria-label="关闭侧边栏"
							className="md:hidden ml-3 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
						>
							✕
						</button>
					)}
				</div>

				{projects.length > 0 && (
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
								项目
							</span>
							{onNewProject && (
								<button
									type="button"
									onClick={onNewProject}
									className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
								>
									+ 新建
								</button>
							)}
						</div>
						<select
							className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-transparent text-gray-700 dark:text-gray-200"
							value={activeProjectId || projects[0]?.id || ""}
							onChange={(e) => onProjectChange?.(e.target.value)}
						>
							{projects.map((project) => (
								<option key={project.id} value={project.id}>
									{project.name}
								</option>
							))}
						</select>
					</div>
				)}
			</div>

			<nav className="flex-1 overflow-y-auto px-2">
				{conversations.length === 0 ? (
					<p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">
						暂无对话
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
							历史聊天记录
						</Link>
					</li>
					<li>
						<Link
							to="/usage"
							className={cn(
								"block px-3 py-2 rounded-md text-sm font-medium transition-colors",
								isActive("/usage")
									? "bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
									: "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800",
							)}
						>
							用量
						</Link>
					</li>
					<li>
						<Form method="post" action="/logout">
							<button
								type="submit"
								className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
							>
								退出登录
							</button>
						</Form>
					</li>

					<li>
						<button
							onClick={toggleTheme}
							className="w-full text-left px-3 py-2 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
						>
							{theme === "dark" ? "亮色模式" : "深色模式"}
						</button>
					</li>
				</ul>
			</div>
		</aside>
	);
}

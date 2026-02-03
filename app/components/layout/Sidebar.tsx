import { Form, Link, useLocation } from "react-router";
import { Button } from "../shared/Button";
import { SidebarItem } from "./SidebarItem";
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

	const isActive = (path: string) => {
		return location.pathname === path;
	};

	return (
		<aside
			className={cn(
				"w-72 md:w-80 h-screen bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl border-r border-white/60 dark:border-neutral-800/70 shadow-lg shadow-neutral-900/5 flex flex-col transition-transform duration-300 ease-out md:translate-x-0",
				isOpen ? "translate-x-0" : "-translate-x-full",
				className,
			)}
		>
			<div className="p-4 space-y-4">
				<div className="flex items-center justify-between md:justify-start">
					<Button onClick={onNewChat} className="w-full">
						新对话
					</Button>
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							aria-label="关闭侧边栏"
							className="md:hidden ml-3 text-neutral-500 hover:text-brand-600 dark:hover:text-brand-300 transition-colors focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950 rounded-full"
						>
							✕
						</button>
					)}
				</div>

				{projects.length > 0 && (
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<span className="text-xs uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
								项目
							</span>
							{onNewProject && (
								<button
									type="button"
									onClick={onNewProject}
									className="text-xs text-neutral-500 hover:text-brand-600 dark:hover:text-brand-300 transition-colors focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950 rounded-md"
								>
									+ 新建
								</button>
							)}
						</div>
						<select
							className="w-full text-sm border border-neutral-200/70 dark:border-neutral-700/70 rounded-xl px-3 py-2 bg-white/70 dark:bg-neutral-900/60 text-neutral-700 dark:text-neutral-200 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50 hover:border-brand-300/60 dark:hover:border-brand-700/50"
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

			<nav className="flex-1 overflow-y-auto px-4">
				{conversations.length === 0 ? (
					<p className="text-neutral-500 dark:text-neutral-400 text-sm text-center py-4">
						暂无对话
					</p>
				) : (
					<ul className="space-y-2">
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

			<div className="p-4 border-t border-white/60 dark:border-neutral-800/70">
				<ul className="space-y-2">
					<li>
						<Link
							to="/conversations"
							className={cn(
								"block px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950",
								isActive("/conversations")
									? "bg-brand-50/80 text-brand-700 shadow-sm dark:bg-brand-900/30 dark:text-brand-200"
									: "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60",
							)}
						>
							历史聊天记录
						</Link>
					</li>
					<li>
						<Link
							to="/usage"
							className={cn(
								"block px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950",
								isActive("/usage")
									? "bg-brand-50/80 text-brand-700 shadow-sm dark:bg-brand-900/30 dark:text-brand-200"
									: "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60",
							)}
						>
							用量
						</Link>
					</li>

					<li>
						<Form method="post" action="/logout">
							<button
								type="submit"
								className="w-full text-left px-4 py-2 rounded-xl text-sm font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
							>
								退出登录
							</button>
						</Form>
					</li>
				</ul>
			</div>
		</aside>
	);
}

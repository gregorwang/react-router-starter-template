import { Form, Link, useLocation, useNavigate } from "react-router";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { format } from "date-fns";
import { Button } from "../shared/Button";
import { cn } from "../../lib/utils/cn";
import type { Conversation, Project, User } from "../../lib/llm/types";

type ChatFilter = "all" | "recent" | "pinned" | "archived";
type SearchScope = "project" | "all";

type SearchResult = {
	id: string;
	projectId: string;
	title: string;
	updatedAt: number;
	isArchived: boolean;
	isPinned: boolean;
	snippet?: string;
};

interface SidebarProps {
	className?: string;
	onNewChat?: () => void;
	conversations?: Conversation[];
	onConversationsChange?: (next: Conversation[]) => void;
	projects?: Project[];
	onProjectsChange?: (next: Project[]) => void;
	projectCounts?: Record<string, number>;
	onProjectCountsChange?: (next: Record<string, number>) => void;
	currentUser?: User | null;
	activeConversationId?: string;
	activeProjectId?: string;
	onProjectChange?: (projectId: string) => void;
	onNewProject?: () => void;
	isAdmin?: boolean;
	isOpen?: boolean;
	isCollapsed?: boolean;
	onClose?: () => void;
}

const CHAT_ROW_HEIGHT = 62;
const CHAT_OVERSCAN = 8;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SEARCH_LIMIT = 30;

function buildConversationHref(conversationId: string, projectId?: string) {
	const search = projectId ? `?project=${projectId}` : "";
	return `/c/${conversationId}${search}`;
}

export function Sidebar({
	className,
	onNewChat,
	conversations = [],
	onConversationsChange,
	projects = [],
	onProjectsChange,
	projectCounts = {},
	onProjectCountsChange,
	currentUser,
	activeConversationId,
	activeProjectId,
	onProjectChange,
	onNewProject,
	isAdmin = false,
	isOpen = true,
	isCollapsed = false,
	onClose,
}: SidebarProps) {
	const location = useLocation();
	const navigate = useNavigate();

	const [chatFilter, setChatFilter] = useState<ChatFilter>("all");
	const [projectCollapsed, setProjectCollapsed] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchScope, setSearchScope] = useState<SearchScope>("project");
	const [searchLoading, setSearchLoading] = useState(false);
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [activeConversationMenuId, setActiveConversationMenuId] = useState<string | null>(
		null,
	);
	const [activeProjectMenuId, setActiveProjectMenuId] = useState<string | null>(null);
	const [chatScrollTop, setChatScrollTop] = useState(0);
	const [chatViewportHeight, setChatViewportHeight] = useState(440);
	const chatListRef = useRef<HTMLDivElement | null>(null);
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	const isActivePath = (path: string) => location.pathname === path;

	const projectById = useMemo(() => {
		const map = new Map<string, Project>();
		for (const project of projects) map.set(project.id, project);
		return map;
	}, [projects]);

	const applyConversations = (updater: (prev: Conversation[]) => Conversation[]) => {
		onConversationsChange?.(updater(conversations));
	};

	const applyProjects = (updater: (prev: Project[]) => Project[]) => {
		onProjectsChange?.(updater(projects));
	};

	const applyProjectCounts = (
		updater: (prev: Record<string, number>) => Record<string, number>,
	) => {
		onProjectCountsChange?.(updater(projectCounts));
	};

	const filteredConversations = useMemo(() => {
		const now = Date.now();
		if (chatFilter === "archived") {
			return conversations.filter((item) => item.isArchived);
		}
		if (chatFilter === "pinned") {
			return conversations.filter((item) => !item.isArchived && item.isPinned);
		}
		if (chatFilter === "recent") {
			return conversations.filter(
				(item) => !item.isArchived && now - item.updatedAt <= RECENT_WINDOW_MS,
			);
		}
		return conversations.filter((item) => !item.isArchived);
	}, [chatFilter, conversations]);

	const shouldVirtualizeChats = filteredConversations.length > 80;
	const virtualStart = shouldVirtualizeChats
		? Math.max(0, Math.floor(chatScrollTop / CHAT_ROW_HEIGHT) - CHAT_OVERSCAN)
		: 0;
	const virtualVisibleCount = shouldVirtualizeChats
		? Math.ceil(chatViewportHeight / CHAT_ROW_HEIGHT) + CHAT_OVERSCAN * 2
		: filteredConversations.length;
	const virtualEnd = Math.min(
		filteredConversations.length,
		virtualStart + virtualVisibleCount,
	);
	const virtualSlice = filteredConversations.slice(virtualStart, virtualEnd);
	const totalChatHeight = filteredConversations.length * CHAT_ROW_HEIGHT;

	useEffect(() => {
		if (!searchOpen) return;
		searchInputRef.current?.focus();
	}, [searchOpen]);

	useEffect(() => {
		if (!searchOpen) return;
		const query = searchQuery.trim();
		if (!query) {
			setSearchResults([]);
			setSearchLoading(false);
			return;
		}

		const controller = new AbortController();
		const timeout = window.setTimeout(async () => {
			setSearchLoading(true);
			try {
				const url = new URL("/conversations/search", window.location.origin);
				url.searchParams.set("q", query);
				url.searchParams.set("scope", searchScope);
				if (activeProjectId) {
					url.searchParams.set("projectId", activeProjectId);
				}
				url.searchParams.set("limit", String(DEFAULT_SEARCH_LIMIT));
				const response = await fetch(url.toString(), { signal: controller.signal });
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const data = (await response.json()) as { results?: SearchResult[] };
				setSearchResults(data.results ?? []);
			} catch (error) {
				if ((error as Error).name !== "AbortError") {
					setSearchResults([]);
				}
			} finally {
				setSearchLoading(false);
			}
		}, 220);

		return () => {
			controller.abort();
			window.clearTimeout(timeout);
		};
	}, [searchOpen, searchQuery, searchScope, activeProjectId]);

	useEffect(() => {
		const element = chatListRef.current;
		if (!element) return;
		const observer = new ResizeObserver(() => {
			setChatViewportHeight(element.clientHeight);
		});
		observer.observe(element);
		setChatViewportHeight(element.clientHeight);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const handleWindowClick = () => {
			setActiveConversationMenuId(null);
			setActiveProjectMenuId(null);
		};
		window.addEventListener("click", handleWindowClick);
		return () => window.removeEventListener("click", handleWindowClick);
	}, []);

	const updateConversation = async (
		conversation: Conversation,
		action: "rename" | "pin" | "unpin",
		title?: string,
	) => {
		const response = await fetch("/conversations/update", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				conversationId: conversation.id,
				action,
				title,
			}),
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(text || "更新失败");
		}
		const data = (await response.json()) as {
			title: string;
			isArchived: boolean;
			isPinned: boolean;
			updatedAt: number;
		};

		applyConversations((prev) => {
			const next = prev.map((item) => {
				if (item.id !== conversation.id) return item;
				return {
					...item,
					title: data.title,
					isArchived: data.isArchived,
					isPinned: data.isPinned,
					pinnedAt: data.isPinned ? data.updatedAt : undefined,
					updatedAt: data.updatedAt,
				};
			});
			return next.sort((a, b) => {
				const pinDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
				if (pinDiff !== 0) return pinDiff;
				const bPinnedAt = b.pinnedAt || 0;
				const aPinnedAt = a.pinnedAt || 0;
				if (bPinnedAt !== aPinnedAt) return bPinnedAt - aPinnedAt;
				return b.updatedAt - a.updatedAt;
			});
		});
	};

	const deleteConversation = async (conversation: Conversation) => {
		const confirmed = window.confirm("确定删除该对话？此操作不可撤销。");
		if (!confirmed) return;
		const response = await fetch("/conversations/delete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				conversationId: conversation.id,
				projectId: conversation.projectId || activeProjectId || "",
			}),
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(text || "删除失败");
		}

		applyConversations((prev) => prev.filter((item) => item.id !== conversation.id));
		applyProjectCounts((prev) => {
			const key = conversation.projectId || activeProjectId || "";
			if (!key) return prev;
			const next = { ...prev };
			next[key] = Math.max(0, (next[key] || 0) - 1);
			return next;
		});

		if (activeConversationId === conversation.id) {
			const project = conversation.projectId || activeProjectId;
			const href = buildConversationHref(crypto.randomUUID(), project);
			navigate(href);
		}
	};

	const copyConversationLink = async (conversation: Conversation) => {
		const response = await fetch("/conversations/share", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ conversationId: conversation.id }),
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(text || "分享链接生成失败");
		}
		const data = (await response.json()) as { url?: string };
		if (!data.url) {
			throw new Error("分享链接生成失败");
		}
		await navigator.clipboard.writeText(data.url);
	};

	const handleProjectRename = async (project: Project) => {
		const nextName = window.prompt("新项目名称", project.name);
		if (!nextName?.trim()) return;
		const response = await fetch("/projects/update", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: project.id, name: nextName.trim() }),
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(text || "项目重命名失败");
		}
		applyProjects((prev) =>
			prev.map((item) =>
				item.id === project.id
					? { ...item, name: nextName.trim(), updatedAt: Date.now() }
					: item,
			),
		);
	};

	const handleProjectDelete = async (project: Project) => {
		const moveToDefault = window.confirm(
			"删除项目时是否把该项目下对话迁移到“默认项目”？点击“取消”将继续选择是否一并删除对话。",
		);
		let mode: "move_to_default" | "delete_with_chats" = "move_to_default";
		if (!moveToDefault) {
			const deleteWithChats = window.confirm(
				"将删除项目下所有对话。是否继续？",
			);
			if (!deleteWithChats) return;
			mode = "delete_with_chats";
		}

		const response = await fetch("/projects/delete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: project.id, mode }),
		});
		if (!response.ok) {
			const text = await response.text();
			throw new Error(text || "删除项目失败");
		}
		const data = (await response.json()) as {
			fallbackProjectId?: string;
		};

		const removedCount = projectCounts[project.id] || 0;
		applyProjects((prev) => prev.filter((item) => item.id !== project.id));
		applyProjectCounts((prev) => {
			const next = { ...prev };
			delete next[project.id];
			if (mode === "move_to_default" && data.fallbackProjectId) {
				next[data.fallbackProjectId] =
					(next[data.fallbackProjectId] || 0) + removedCount;
			}
			return next;
		});

		if (activeProjectId === project.id && data.fallbackProjectId) {
			onProjectChange?.(data.fallbackProjectId);
		}
	};

	const handleConversationAction = async (
		conversation: Conversation,
		action:
			| "rename"
			| "pin"
			| "unpin"
			| "delete"
			| "copy",
	) => {
		try {
			if (action === "rename") {
				const nextTitle = window.prompt("对话标题", conversation.title);
				if (!nextTitle?.trim()) return;
				await updateConversation(conversation, "rename", nextTitle.trim());
				return;
			}
			if (action === "pin") {
				await updateConversation(conversation, "pin");
				return;
			}
			if (action === "unpin") {
				await updateConversation(conversation, "unpin");
				return;
			}
			if (action === "delete") {
				await deleteConversation(conversation);
				return;
			}
			if (action === "copy") {
				await copyConversationLink(conversation);
				return;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "操作失败";
			window.alert(message);
		} finally {
			setActiveConversationMenuId(null);
		}
	};

	const projectLabel = activeProjectId
		? projectById.get(activeProjectId)?.name || "当前项目"
		: "当前项目";

	return (
		<aside
			className={cn(
				"chat-sidebar-panel w-72 h-screen bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl border-r border-white/60 dark:border-neutral-800/70 shadow-lg shadow-neutral-900/5 flex flex-col transition-[width,transform,opacity] duration-300 ease-out",
				isOpen && "is-open",
				isCollapsed
					? "md:w-0 md:opacity-0 md:pointer-events-none md:overflow-hidden md:border-r-0 md:shadow-none"
					: "md:w-80 md:opacity-100",
				className,
			)}
		>
			<div className="p-4 border-b border-white/60 dark:border-neutral-800/70 space-y-3">
				<div className="flex items-center justify-between md:justify-start gap-3">
					<Button onClick={onNewChat} className="flex-1">
						新建对话
					</Button>
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							aria-label="关闭侧边栏"
							className="md:hidden text-neutral-500 hover:text-brand-600 dark:hover:text-brand-300 transition-colors focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950 rounded-full"
						>
							✕
						</button>
					)}
				</div>
				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						onClick={() => setSearchOpen((prev) => !prev)}
						className="text-xs px-3 py-2 rounded-lg border border-neutral-200/70 dark:border-neutral-700/70 text-neutral-700 dark:text-neutral-200 bg-white/70 dark:bg-neutral-900/60 hover:border-brand-400/60 hover:text-brand-700 dark:hover:text-brand-200 transition-all duration-200"
					>
						搜索对话
					</button>
					<Link
						to="/conversations"
						className="text-xs px-3 py-2 rounded-lg border border-neutral-200/70 dark:border-neutral-700/70 text-center text-neutral-700 dark:text-neutral-200 bg-white/70 dark:bg-neutral-900/60 hover:border-brand-400/60 hover:text-brand-700 dark:hover:text-brand-200 transition-all duration-200"
					>
						库/资料
					</Link>
				</div>
				{searchOpen && (
					<div className="space-y-2 p-3 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/60 dark:bg-neutral-900/40">
						<input
							ref={searchInputRef}
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="搜索标题或内容..."
							className="w-full text-sm border border-neutral-200/70 dark:border-neutral-700/70 rounded-lg px-3 py-2 bg-white/90 dark:bg-neutral-900/80 text-neutral-700 dark:text-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50"
						/>
						<div className="flex items-center gap-2">
							<select
								value={searchScope}
								onChange={(e) => setSearchScope(e.target.value as SearchScope)}
								className="text-xs border border-neutral-200/70 dark:border-neutral-700/70 rounded-lg px-2 py-1.5 bg-white/90 dark:bg-neutral-900/80 text-neutral-700 dark:text-neutral-200"
							>
								<option value="project">当前项目</option>
								<option value="all">全部项目</option>
							</select>
							<span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
								{projectLabel}
							</span>
						</div>
						<div className="max-h-44 overflow-y-auto rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-white/70 dark:bg-neutral-900/60">
							{searchLoading ? (
								<div className="text-xs text-neutral-500 dark:text-neutral-400 p-3">
									搜索中...
								</div>
							) : searchResults.length === 0 ? (
								<div className="text-xs text-neutral-500 dark:text-neutral-400 p-3">
									暂无匹配结果
								</div>
							) : (
								<ul className="divide-y divide-neutral-200/60 dark:divide-neutral-800/70">
									{searchResults.map((item) => (
										<li key={`${item.projectId}:${item.id}`}>
											<Link
												to={buildConversationHref(item.id, item.projectId)}
												prefetch="intent"
												onClick={() => {
													setSearchOpen(false);
													onClose?.();
												}}
												className={cn(
													"block px-3 py-2 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60 transition-colors",
													activeConversationId === item.id &&
														"bg-brand-50/80 dark:bg-brand-900/25",
												)}
											>
												<div className="text-xs font-semibold text-neutral-700 dark:text-neutral-200 truncate">
													{item.title}
												</div>
												{item.snippet && (
													<div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
														{item.snippet}
													</div>
												)}
											</Link>
										</li>
									))}
								</ul>
							)}
						</div>
					</div>
				)}
			</div>

			<div className="px-4 py-3 border-b border-white/60 dark:border-neutral-800/70">
				<div className="flex items-center justify-between mb-2">
					<button
						type="button"
						onClick={() => setProjectCollapsed((prev) => !prev)}
						className="text-xs uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400"
					>
						项目
					</button>
					<button
						type="button"
						onClick={onNewProject}
						className="text-xs text-neutral-500 hover:text-brand-600 dark:hover:text-brand-300 transition-colors"
					>
						+ 新项目
					</button>
				</div>
				{!projectCollapsed && (
					<ul className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
						{projects.map((project) => {
							const isActive = activeProjectId === project.id;
							const isMenuOpen = activeProjectMenuId === project.id;
							return (
								<li
									key={project.id}
									className={cn(
										"group relative rounded-lg",
										isActive
											? "bg-brand-50/80 dark:bg-brand-900/25"
											: "hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60",
									)}
								>
									<button
										type="button"
										onClick={() => onProjectChange?.(project.id)}
										className="w-full text-left px-3 py-2 pr-9"
									>
										<div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 truncate">
											{project.name}
										</div>
										<div className="text-[11px] text-neutral-500 dark:text-neutral-400">
											{projectCounts[project.id] || 0} 条对话
										</div>
									</button>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											setActiveProjectMenuId((prev) =>
												prev === project.id ? null : project.id,
											);
											setActiveConversationMenuId(null);
										}}
										className="absolute right-1 top-1.5 p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
									>
										⋯
									</button>
									{isMenuOpen && (
										<div
											className="absolute right-2 top-9 z-30 min-w-40 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/95 dark:bg-neutral-900/95 shadow-lg p-1.5"
											onClick={(e) => e.stopPropagation()}
										>
											<button
												type="button"
												className="w-full text-left text-xs px-2.5 py-2 rounded-lg hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60"
												onClick={() => {
													void handleProjectRename(project).catch((error) => {
														const message =
															error instanceof Error
																? error.message
																: "项目重命名失败";
														window.alert(message);
													});
													setActiveProjectMenuId(null);
												}}
											>
												重命名
											</button>
											{!project.isDefault && (
												<button
													type="button"
													className="w-full text-left text-xs px-2.5 py-2 rounded-lg text-rose-600 dark:text-rose-300 hover:bg-rose-50/70 dark:hover:bg-rose-900/20"
													onClick={() => {
														void handleProjectDelete(project).catch((error) => {
															const message =
																error instanceof Error
																	? error.message
																	: "删除项目失败";
															window.alert(message);
														});
														setActiveProjectMenuId(null);
													}}
												>
													删除项目
												</button>
											)}
										</div>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</div>

			<div className="px-4 pt-3 pb-2 border-b border-white/60 dark:border-neutral-800/70">
				<div className="flex items-center justify-between">
					<span className="text-xs uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
						聊天
					</span>
					<select
						value={chatFilter}
						onChange={(e) => setChatFilter(e.target.value as ChatFilter)}
						className="text-xs border border-neutral-200/70 dark:border-neutral-700/70 rounded-lg px-2 py-1 bg-white/80 dark:bg-neutral-900/70 text-neutral-700 dark:text-neutral-200"
					>
						<option value="all">全部</option>
						<option value="recent">最近</option>
						<option value="pinned">已置顶</option>
						<option value="archived">已归档</option>
					</select>
				</div>
			</div>

			<nav
				ref={chatListRef}
				className="flex-1 overflow-y-auto px-3 py-3"
				onScroll={(e) => setChatScrollTop(e.currentTarget.scrollTop)}
			>
				{filteredConversations.length === 0 ? (
					<p className="text-neutral-500 dark:text-neutral-400 text-sm text-center py-6">
						暂无对话
					</p>
				) : shouldVirtualizeChats ? (
					<div style={{ height: totalChatHeight, position: "relative" }}>
						{virtualSlice.map((conversation, index) => {
							const absoluteIndex = virtualStart + index;
							const isActive = activeConversationId === conversation.id;
							const isMenuOpen = activeConversationMenuId === conversation.id;
							return (
								<div
									key={conversation.id}
									style={{
										position: "absolute",
										top: absoluteIndex * CHAT_ROW_HEIGHT,
										left: 0,
										right: 0,
										height: CHAT_ROW_HEIGHT,
									}}
								>
									<ConversationListRow
										conversation={conversation}
										isActive={isActive}
										isMenuOpen={isMenuOpen}
										onOpenMenu={(event) => {
											event.stopPropagation();
											setActiveConversationMenuId((prev) =>
												prev === conversation.id ? null : conversation.id,
											);
											setActiveProjectMenuId(null);
										}}
										onAction={(action) =>
											void handleConversationAction(conversation, action)
										}
									/>
								</div>
							);
						})}
					</div>
				) : (
					<ul className="space-y-2">
						{filteredConversations.map((conversation) => {
							const isActive = activeConversationId === conversation.id;
							const isMenuOpen = activeConversationMenuId === conversation.id;
							return (
								<li key={conversation.id}>
									<ConversationListRow
										conversation={conversation}
										isActive={isActive}
										isMenuOpen={isMenuOpen}
										onOpenMenu={(event) => {
											event.stopPropagation();
											setActiveConversationMenuId((prev) =>
												prev === conversation.id ? null : conversation.id,
											);
											setActiveProjectMenuId(null);
										}}
										onAction={(action) =>
											void handleConversationAction(conversation, action)
										}
									/>
								</li>
							);
						})}
					</ul>
				)}
			</nav>

			<div className="p-4 border-t border-white/60 dark:border-neutral-800/70 space-y-3">
				<div className="flex items-center gap-3 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 px-3 py-2 bg-white/70 dark:bg-neutral-900/60">
					<div className="h-8 w-8 rounded-full bg-brand-600 text-white text-xs font-semibold flex items-center justify-center">
						{(currentUser?.username || "U").slice(0, 1).toUpperCase()}
					</div>
					<div className="min-w-0">
						<div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200 truncate">
							{currentUser?.username || "User"}
						</div>
						<div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
							个人工作区
						</div>
					</div>
				</div>

				<ul className="space-y-2">
					<li>
						<Link
							to="/conversations"
							className={cn(
								"block px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200",
								isActivePath("/conversations")
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
								"block px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200",
								isActivePath("/usage")
									? "bg-brand-50/80 text-brand-700 shadow-sm dark:bg-brand-900/30 dark:text-brand-200"
									: "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60",
							)}
						>
							用量
						</Link>
					</li>
					{isAdmin && (
						<li>
							<Link
								to="/admin"
								className={cn(
									"block px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200",
									isActivePath("/admin")
										? "bg-brand-50/80 text-brand-700 shadow-sm dark:bg-brand-900/30 dark:text-brand-200"
										: "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60",
								)}
							>
								管理面板
							</Link>
						</li>
					)}
					<li>
						<Form method="post" action="/logout">
							<button
								type="submit"
								className="w-full text-left px-4 py-2 rounded-xl text-sm font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60 transition-all duration-200"
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

function ConversationListRow({
	conversation,
	isActive,
	isMenuOpen,
	onOpenMenu,
	onAction,
}: {
	conversation: Conversation;
	isActive: boolean;
	isMenuOpen: boolean;
	onOpenMenu: (event: MouseEvent<HTMLButtonElement>) => void;
	onAction: (
		action:
			| "rename"
			| "pin"
			| "unpin"
			| "delete"
			| "copy",
	) => void;
}) {
	const href = buildConversationHref(conversation.id, conversation.projectId);
	const archived = Boolean(conversation.isArchived);
	const pinned = Boolean(conversation.isPinned);

	return (
		<div className="group relative flex items-center h-[56px]">
			<Link
				to={href}
				prefetch="intent"
				className={cn(
					"flex-1 px-3 py-2 rounded-xl text-sm font-semibold transition-all duration-200 pr-10",
					isActive
						? "bg-brand-50/80 text-brand-700 shadow-sm dark:bg-brand-900/30 dark:text-brand-200"
						: "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60",
				)}
			>
				<div className="truncate">{conversation.title}</div>
				<div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 flex items-center gap-2">
					{pinned && <span>置顶</span>}
					{archived && <span>已归档</span>}
					<span>{format(new Date(conversation.updatedAt), "MM-dd HH:mm")}</span>
				</div>
			</Link>
			<button
				type="button"
				onClick={onOpenMenu}
				className="absolute right-1 top-2 p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
				title="对话操作"
			>
				⋯
			</button>
			{isMenuOpen && (
				<div
					className="absolute right-2 top-10 z-40 min-w-40 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/95 dark:bg-neutral-900/95 shadow-lg p-1.5"
					onClick={(e) => e.stopPropagation()}
				>
					<button
						type="button"
						className="w-full text-left text-xs px-2.5 py-2 rounded-lg hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60"
						onClick={() => onAction("rename")}
					>
						重命名
					</button>
					<button
						type="button"
						className="w-full text-left text-xs px-2.5 py-2 rounded-lg hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60"
						onClick={() => onAction(pinned ? "unpin" : "pin")}
					>
						{pinned ? "取消置顶" : "置顶"}
					</button>
					<button
						type="button"
						className="w-full text-left text-xs px-2.5 py-2 rounded-lg hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60"
						onClick={() => onAction("copy")}
					>
						复制分享链接
					</button>
					<button
						type="button"
						className="w-full text-left text-xs px-2.5 py-2 rounded-lg text-rose-600 dark:text-rose-300 hover:bg-rose-50/70 dark:hover:bg-rose-900/20"
						onClick={() => onAction("delete")}
					>
						删除
					</button>
				</div>
			)}
		</div>
	);
}

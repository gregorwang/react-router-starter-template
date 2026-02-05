import type { Route } from "./+types/c_.$id";
import { ChatContainer } from "../components/chat/ChatContainer";
import { Sidebar } from "../components/layout/Sidebar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { redirect, useLocation, useNavigate, useSearchParams } from "react-router";
import { useChat } from "../contexts/ChatContext";
import {
	getConversation,
} from "../lib/db/conversations.server";
import { getConversationIndexCached } from "../lib/cache/conversation-index.server";
import { getProjects } from "../lib/db/projects.server";
import { requireAuth } from "../lib/auth.server";
import { listUserModelLimits } from "../lib/db/user-model-limits.server";

// Server loader - runs in Cloudflare Worker with D1 database
export async function loader({ context, params, request }: Route.LoaderArgs) {
	const user = await requireAuth(request, context.db);
	const conversationId = params.id;
	const env = context.cloudflare.env;
	const url = new URL(request.url);
	const requestedProjectId = url.searchParams.get("project");
	const projectsPromise = getProjects(context.db, user.id);
	const modelLimitsPromise =
		user.role === "admin" ? Promise.resolve([]) : listUserModelLimits(context.db, user.id);

	const resolveProjectId = (projects: Array<{ id: string }>) => {
		const projectIds = new Set(projects.map((project) => project.id));
		return requestedProjectId && projectIds.has(requestedProjectId)
			? requestedProjectId
			: undefined;
	};

	if (conversationId === "new") {
		const projects = await projectsPromise;
		const fallbackProjectId = resolveProjectId(projects) || projects[0]?.id || "default";
		const newId = crypto.randomUUID();
		return redirect(`/c/${newId}?project=${fallbackProjectId}`);
	}

	if (!conversationId) {
		const projects = await projectsPromise;
		const fallbackProjectId = resolveProjectId(projects) || projects[0]?.id || "default";
		const newId = crypto.randomUUID();
		return redirect(`/c/${newId}?project=${fallbackProjectId}`);
	}

	const [projects, existingConversation, modelLimits] = await Promise.all([
		projectsPromise,
		getConversation(context.db, user.id, conversationId),
		modelLimitsPromise,
	]);
	const fallbackProjectId = resolveProjectId(projects) || projects[0]?.id || "default";

	let conversation = existingConversation;
	let isPlaceholder = false;

	// If conversation doesn't exist, create a new one
	if (!conversation) {
		conversation = {
			id: conversationId,
			projectId: fallbackProjectId,
			title: "新对话",
			userId: user.id,
			provider: "poe",
			model: "grok-4.1-fast-reasoning",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
		};
		isPlaceholder = true;
	}

	const activeProjectId =
		conversation.projectId || resolveProjectId(projects) || projects[0]?.id || "default";
	const conversations = await getConversationIndexCached({
		db: context.db,
		kv: context.cloudflare.env.SETTINGS_KV,
		ctx: context.cloudflare.ctx,
		userId: user.id,
		projectId: activeProjectId,
	});
	if (isPlaceholder && !conversations.some((item) => item.id === conversation?.id)) {
		conversations.unshift({
			...conversation,
			messages: [],
		});
	}

	return {
		conversationId,
		conversations,
		conversation,
		projects,
		activeProjectId,
		currentUser: user,
		modelAvailability: modelLimits.reduce(
			(acc, limit) => {
				acc[`${limit.provider}:${limit.model}`] = {
					available: limit.enabled,
				};
				return acc;
			},
			{} as Record<string, { available: boolean }>,
		),
		providerAvailability: {
			deepseek: Boolean(env.DEEPSEEK_API_KEY),
			xai: Boolean(env.XAI_API_KEY),
			poe: Boolean(env.POE_API_KEY),
			"workers-ai": false,
			poloai: Boolean(env.POLOAI_API_KEY),
			ark: Boolean(env.ARK_API_KEY),
		},
	};
}

export default function Conversation({ loaderData }: Route.ComponentProps) {
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const { currentConversation, setCurrentConversation } = useChat();
	const {
		conversationId,
		conversation,
		conversations,
		projects,
		activeProjectId,
		currentUser,
		modelAvailability,
	} = loaderData;
	const [conversationList, setConversationList] = useState(conversations);
	const providerAvailability = loaderData.providerAvailability;

	const activeProjectName = useMemo(
		() => {
			const active = projects.find((project) => project.id === activeProjectId);
			if (active?.isDefault) return "模型选择";
			return projects.find((project) => project.id === activeProjectId)?.name || "项目";
		},
		[projects, activeProjectId],
	);

	// Load conversation into context when component mounts or conversation changes
	useEffect(() => {
		if (conversation) {
			setCurrentConversation(conversation);
		}
		return () => {
			// Clear conversation when unmounting
			setCurrentConversation(null);
		};
	}, [conversation, setCurrentConversation]);

	useEffect(() => {
		setConversationList(conversations);
	}, [conversations]);

	useEffect(() => {
		if (!currentConversation) return;
		setConversationList((prev) => {
			const index = prev.findIndex((item) => item.id === currentConversation.id);
			if (index === -1) {
				return [
					{
						...currentConversation,
						messages: [],
					},
					...prev,
				];
			}
			const existing = prev[index];
			if (existing.title === currentConversation.title) return prev;
			const next = [...prev];
			next[index] = {
				...existing,
				title: currentConversation.title,
			};
			return next;
		});
	}, [currentConversation]);

	const handleNewChat = useCallback(() => {
		// Generate new UUID and navigate
		const newId = crypto.randomUUID();
		navigate(`/c/${newId}?project=${activeProjectId}`);
	}, [navigate, activeProjectId]);

	const handleProjectChange = useCallback(
		(projectId: string) => {
			const next = new URLSearchParams(searchParams);
			next.set("project", projectId);
			navigate(`${location.pathname}?${next.toString()}`);
		},
		[location.pathname, navigate, searchParams],
	);

	const handleCreateProject = useCallback(async () => {
		const name = window.prompt("项目名称");
		if (!name?.trim()) return;
		const response = await fetch("/projects/create", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: name.trim() }),
		});
		if (!response.ok) return;
		const data = (await response.json()) as { project?: { id: string } };
		if (data.project?.id) {
			handleProjectChange(data.project.id);
		}
	}, [handleProjectChange]);

	useEffect(() => {
		const currentProjectParam = searchParams.get("project");
		if (activeProjectId && currentProjectParam !== activeProjectId) {
			const next = new URLSearchParams(searchParams);
			next.set("project", activeProjectId);
			navigate(`${location.pathname}?${next.toString()}`, { replace: true });
		}
	}, [activeProjectId, location.pathname, navigate, searchParams]);

	return (
		<div className="flex h-screen min-h-0 overflow-hidden relative">
			{sidebarOpen && (
				<button
					type="button"
					aria-label="关闭侧边栏"
					onClick={() => setSidebarOpen(false)}
					className="fixed inset-0 bg-black/40 z-30 md:hidden"
				/>
			)}
			<Sidebar
				onNewChat={handleNewChat}
				conversations={conversationList}
				projects={projects}
				activeProjectId={activeProjectId}
				onProjectChange={handleProjectChange}
				onNewProject={handleCreateProject}
				isAdmin={currentUser?.role === "admin"}
				isOpen={sidebarOpen}
				isCollapsed={sidebarCollapsed}
				onClose={() => setSidebarOpen(false)}
				className="fixed md:static inset-y-0 left-0 z-40"
			/>
			<ChatContainer
				onOpenSidebar={() => setSidebarOpen(true)}
				onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
				isSidebarCollapsed={sidebarCollapsed}
				activeProjectName={activeProjectName}
				providerAvailability={providerAvailability}
				modelAvailability={modelAvailability}
			/>
		</div>
	);
}

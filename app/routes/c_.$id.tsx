import type { Route } from "./+types/c_.$id";
import { ChatContainer } from "../components/chat/ChatContainer";
import { Sidebar } from "../components/layout/Sidebar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { redirect, useNavigate } from "react-router";
import { useChat } from "../contexts/ChatContext";
import {
	getConversation,
	getProjectConversationCounts,
} from "../lib/db/conversations.server";
import { getConversationIndexCached } from "../lib/cache/conversation-index.server";
import { getProjects } from "../lib/db/projects.server";
import { requireAuth } from "../lib/auth.server";
import { listUserModelLimits } from "../lib/db/user-model-limits.server";
import {
	applyConversationSessionState,
	resolveConversationSessionState,
} from "../lib/services/chat-session-state.server";

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
		const targetProjectId = resolveProjectId(projects) || projects[0]?.id || "default";
		const conversations = await getConversationIndexCached({
			db: context.db,
			kv: context.cloudflare.env.SETTINGS_KV,
			ctx: context.cloudflare.ctx,
			userId: user.id,
			projectId: targetProjectId,
		});
		const targetConversationId = conversations[0]?.id || crypto.randomUUID();
		return redirect(`/c/${targetConversationId}?project=${targetProjectId}`);
	}

	if (!conversationId) {
		const projects = await projectsPromise;
		const targetProjectId = resolveProjectId(projects) || projects[0]?.id || "default";
		const conversations = await getConversationIndexCached({
			db: context.db,
			kv: context.cloudflare.env.SETTINGS_KV,
			ctx: context.cloudflare.ctx,
			userId: user.id,
			projectId: targetProjectId,
		});
		const targetConversationId = conversations[0]?.id || crypto.randomUUID();
		return redirect(`/c/${targetConversationId}?project=${targetProjectId}`);
	}

	const [projects, existingConversation, modelLimits, projectCounts] = await Promise.all([
		projectsPromise,
		getConversation(context.db, user.id, conversationId),
		modelLimitsPromise,
		getProjectConversationCounts(context.db, user.id),
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
			isPersisted: false,
		};
		isPlaceholder = true;
	}

	const sessionState = await resolveConversationSessionState({
		env,
		userId: user.id,
		conversation,
	});
	conversation = applyConversationSessionState(conversation, sessionState);

	const activeProjectId =
		resolveProjectId(projects) || conversation.projectId || projects[0]?.id || "default";
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
		projectCounts,
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
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const { currentConversation, setCurrentConversation } = useChat();
	const {
		conversationId,
		conversation,
		conversations,
		projects,
		projectCounts,
		activeProjectId,
		currentUser,
		modelAvailability,
	} = loaderData;
	const [conversationList, setConversationList] = useState(conversations);
	const [projectList, setProjectList] = useState(projects);
	const [projectCountMap, setProjectCountMap] = useState(projectCounts);
	const providerAvailability = loaderData.providerAvailability;

	const activeProjectName = useMemo(
		() => {
			const active = projectList.find((project) => project.id === activeProjectId);
			if (active?.isDefault) return "模型选择";
			return projectList.find((project) => project.id === activeProjectId)?.name || "项目";
		},
		[projectList, activeProjectId],
	);

	// Load conversation into context when conversation changes
	useEffect(() => {
		if (conversation) {
			setCurrentConversation(conversation);
		}
	}, [conversation, setCurrentConversation]);

	useEffect(() => {
		return () => {
			setCurrentConversation(null);
		};
	}, [setCurrentConversation]);

	useEffect(() => {
		setConversationList(conversations);
	}, [conversations]);

	useEffect(() => {
		setProjectList(projects);
	}, [projects]);

	useEffect(() => {
		setProjectCountMap(projectCounts);
	}, [projectCounts]);

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
			const existingPersisted = Boolean(existing.isPersisted);
			const nextPersisted =
				currentConversation.isPersisted === undefined
					? existingPersisted
					: Boolean(currentConversation.isPersisted);
			if (
				existing.title === currentConversation.title &&
				existingPersisted === nextPersisted
			) {
				return prev;
			}
			const next = [...prev];
			next[index] = {
				...existing,
				title: currentConversation.title,
				isPersisted: nextPersisted,
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
			if (!projectId || projectId === activeProjectId) return;
			navigate(`/c/new?project=${encodeURIComponent(projectId)}`);
		},
		[activeProjectId, navigate],
	);

	const handleCreateProject = useCallback(async () => {
		const name = window.prompt("项目名称");
		if (!name?.trim()) return;
		const descriptionInput = window.prompt("项目描述（可选）", "");
		if (descriptionInput === null) return;
		const description = descriptionInput.trim();
		const response = await fetch("/projects/create", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: name.trim(), description }),
		});
		if (!response.ok) return;
		const data = (await response.json()) as { project?: { id: string } };
		if (data.project?.id) {
			handleProjectChange(data.project.id);
		}
	}, [handleProjectChange]);

	return (
		<div className="chat-layout flex h-[100dvh] min-h-0 overflow-hidden relative">
			{sidebarOpen && (
				<button
					type="button"
					aria-label="关闭侧边栏"
					onClick={() => setSidebarOpen(false)}
					className="chat-sidebar-backdrop fixed inset-0 bg-black/40 z-30 md:hidden"
				/>
			)}
			<Sidebar
				onNewChat={handleNewChat}
				conversations={conversationList}
				onConversationsChange={setConversationList}
				projects={projectList}
				onProjectsChange={setProjectList}
				projectCounts={projectCountMap}
				onProjectCountsChange={setProjectCountMap}
				currentUser={currentUser}
				activeConversationId={conversationId}
				activeProjectId={activeProjectId}
				onProjectChange={handleProjectChange}
				onNewProject={handleCreateProject}
				isAdmin={currentUser?.role === "admin"}
				isOpen={sidebarOpen}
				isCollapsed={sidebarCollapsed}
				onClose={() => setSidebarOpen(false)}
			/>
			<ChatContainer
				className="chat-main-panel"
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

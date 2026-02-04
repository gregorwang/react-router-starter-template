import type { Route } from "./+types/c_.$id";
import { ChatContainer } from "../components/chat/ChatContainer";
import { Sidebar } from "../components/layout/Sidebar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { redirect, useLocation, useNavigate, useSearchParams } from "react-router";
import { useChat } from "../contexts/ChatContext";
import {
	getConversation,
	getConversationIndex,
} from "../lib/db/conversations.server";
import { getProjects } from "../lib/db/projects.server";
import { requireAuth } from "../lib/auth.server";

// Server loader - runs in Cloudflare Worker with D1 database
export async function loader({ context, params, request }: Route.LoaderArgs) {
	await requireAuth(request, context.db);
	const conversationId = params.id;
	const env = context.cloudflare.env;
	const url = new URL(request.url);
	const requestedProjectId = url.searchParams.get("project");
	const projectsPromise = getProjects(context.db);

	if (conversationId === "new") {
		const projects = await projectsPromise;
		const fallbackProjectId = requestedProjectId || projects[0]?.id || "default";
		const newId = crypto.randomUUID();
		return redirect(`/c/${newId}?project=${fallbackProjectId}`);
	}

	if (!conversationId) {
		const projects = await projectsPromise;
		const fallbackProjectId = requestedProjectId || projects[0]?.id || "default";
		const newId = crypto.randomUUID();
		return redirect(`/c/${newId}?project=${fallbackProjectId}`);
	}

	const [projects, existingConversation] = await Promise.all([
		projectsPromise,
		getConversation(context.db, conversationId),
	]);
	const fallbackProjectId = requestedProjectId || projects[0]?.id || "default";

	let conversation = existingConversation;
	let isPlaceholder = false;

	// If conversation doesn't exist, create a new one
	if (!conversation) {
		conversation = {
			id: conversationId,
			projectId: fallbackProjectId,
			title: "新对话",
			provider: "deepseek",
			model: "deepseek-chat",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
		};
		isPlaceholder = true;
	}

	const activeProjectId =
		conversation.projectId || requestedProjectId || projects[0]?.id || "default";
	const conversations = await getConversationIndex(context.db, activeProjectId);
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
		providerAvailability: {
			deepseek: Boolean(env.DEEPSEEK_API_KEY),
			xai: Boolean(env.XAI_API_KEY),
			poe: Boolean(env.POE_API_KEY),
			"workers-ai": Boolean(env.AI),
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
	const { setCurrentConversation } = useChat();
	const { conversationId, conversation, conversations, projects, activeProjectId } =
		loaderData;
	const providerAvailability = loaderData.providerAvailability;

	const activeProjectName = useMemo(
		() => {
			if (activeProjectId === "default") return "模型选择";
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
				conversations={conversations}
				projects={projects}
				activeProjectId={activeProjectId}
				onProjectChange={handleProjectChange}
				onNewProject={handleCreateProject}
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
			/>
		</div>
	);
}

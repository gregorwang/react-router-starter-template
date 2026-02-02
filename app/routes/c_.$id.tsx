import type { Route } from "./+types/c_.$id";
import { ChatContainer } from "../components/chat/ChatContainer";
import { Sidebar } from "../components/layout/Sidebar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { redirect, useLocation, useNavigate, useSearchParams } from "react-router";
import { useChat } from "../contexts/ChatContext";
import {
	getConversation,
	getConversations,
	saveConversation,
} from "../lib/db/conversations.server";
import { ensureDefaultProject, getProjects } from "../lib/db/projects.server";
import type { Conversation } from "../lib/llm/types";

// Server loader - runs in Cloudflare Worker with D1 database
export async function loader({ context, params, request }: Route.LoaderArgs) {
	const conversationId = params.id;
	await ensureDefaultProject(context.db);
	const projects = await getProjects(context.db);
	const url = new URL(request.url);
	const requestedProjectId = url.searchParams.get("project");
	const fallbackProjectId = requestedProjectId || projects[0]?.id || "default";

	if (conversationId === "new") {
		const newId = crypto.randomUUID();
		return redirect(`/c/${newId}?project=${fallbackProjectId}`);
	}

	let conversation = await getConversation(context.db, conversationId);

	// If conversation doesn't exist, create a new one
	if (!conversation) {
		const projectId = fallbackProjectId;
		conversation = {
			id: conversationId,
			projectId,
			title: "新对话",
			provider: "deepseek",
			model: "deepseek-chat",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [],
		};
		await saveConversation(context.db, conversation);
	}

	const activeProjectId =
		conversation.projectId || requestedProjectId || projects[0]?.id || "default";
	const conversations = await getConversations(context.db, activeProjectId);

	return {
		conversationId,
		conversations,
		conversation,
		projects,
		activeProjectId,
	};
}

export default function Conversation({ loaderData }: Route.ComponentProps) {
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const { setCurrentConversation } = useChat();
	const { conversationId, conversation, conversations, projects, activeProjectId } =
		loaderData;

	const activeProjectName = useMemo(
		() => projects.find((project) => project.id === activeProjectId)?.name || "项目",
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
		<div className="flex h-screen relative">
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
				onClose={() => setSidebarOpen(false)}
				className="fixed md:static inset-y-0 left-0 z-40"
			/>
			<ChatContainer
				onOpenSidebar={() => setSidebarOpen(true)}
				activeProjectName={activeProjectName}
			/>
		</div>
	);
}

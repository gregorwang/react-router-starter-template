import type { Route } from "./+types/conversations";
import { Link, useFetcher, useNavigate, useSearchParams } from "react-router";
import { useCallback, useEffect } from "react";
import { format } from "date-fns";
import { getConversations } from "../lib/db/conversations.server";
import { ensureDefaultProject, getProjects } from "../lib/db/projects.server";
import { requireAuth } from "../lib/auth.server";

// Server loader - runs in Cloudflare Worker with D1 database
export async function loader({ context, request }: Route.LoaderArgs) {
	await requireAuth(request, context.db);
	await ensureDefaultProject(context.db);
	const projects = await getProjects(context.db);
	const url = new URL(request.url);
	const requestedProjectId = url.searchParams.get("project");
	const activeProjectId =
		requestedProjectId || projects[0]?.id || "default";

	const conversations = await getConversations(context.db, activeProjectId);
	const usageTotals = summarizeUsage(conversations);
	return { conversations, projects, activeProjectId, usageTotals };
}

export default function Conversations({ loaderData }: Route.ComponentProps) {
	const { conversations, projects, activeProjectId, usageTotals } = loaderData;
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const projectFetcher = useFetcher<{ ok: boolean; project?: { id: string } }>();

	const handleProjectChange = useCallback(
		(id: string) => {
			const next = new URLSearchParams(searchParams);
			next.set("project", id);
			navigate(`/conversations?${next.toString()}`);
		},
		[searchParams, navigate],
	);

	const handleCreateProject = useCallback(() => {
		const name = window.prompt("项目名称");
		if (!name?.trim()) return;
		projectFetcher.submit(
			{ name: name.trim() },
			{ method: "post", action: "/projects/create" },
		);
	}, [projectFetcher]);

	useEffect(() => {
		if (
			projectFetcher.data?.ok &&
			projectFetcher.data.project?.id &&
			projectFetcher.data.project.id !== activeProjectId
		) {
			handleProjectChange(projectFetcher.data.project.id);
		}
	}, [projectFetcher.data, handleProjectChange, activeProjectId]);

	return (
		<div className="max-w-4xl mx-auto py-8 px-4">
			<div className="flex flex-wrap items-center justify-between gap-4 mb-8">
				<h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
					历史聊天记录
				</h1>
				<div className="flex items-center gap-2">
					<select
						className="text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-transparent text-gray-700 dark:text-gray-200"
						value={activeProjectId}
						onChange={(e) => handleProjectChange(e.target.value)}
					>
						{projects.map((project) => (
							<option key={project.id} value={project.id}>
								{project.name}
							</option>
						))}
					</select>
					<button
						type="button"
						onClick={handleCreateProject}
						className="text-sm px-3 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
					>
						新项目
					</button>
				</div>
			</div>
			{conversations.length === 0 ? (
				<div className="text-center py-8">
					<p className="text-gray-500 dark:text-gray-400 mb-4">
						暂无对话记录，开始一个新对话吧。
					</p>
					<Link
						to={`/c/new?project=${activeProjectId}`}
						className="inline-block px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
					>
						开始新对话
					</Link>
				</div>
			) : (
				<div className="space-y-4">
					<div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
						<div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
							项目用量
						</div>
						{usageTotals.totalTokens > 0 || usageTotals.credits > 0 ? (
							<div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-300">
								<span>
									Tokens：输入 {usageTotals.promptTokens} • 输出{" "}
									{usageTotals.completionTokens} • 总计{" "}
									{usageTotals.totalTokens}
								</span>
								<span>积分：{usageTotals.credits}</span>
								<span>对话数：{usageTotals.conversations}</span>
								<span>消息数：{usageTotals.messages}</span>
							</div>
						) : (
							<div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
								该项目暂无用量数据。
							</div>
						)}
					</div>
					{conversations.map((conv) => (
						<ConversationRow
							key={conv.id}
							conversationId={conv.id}
							projectId={activeProjectId}
							title={conv.title}
							messageCount={conv.messages.length}
							updatedAt={conv.updatedAt}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function ConversationRow({
	conversationId,
	projectId,
	title,
	messageCount,
	updatedAt,
}: {
	conversationId: string;
	projectId: string;
	title: string;
	messageCount: number;
	updatedAt: number;
}) {
	const backupFetcher = useFetcher<{ ok?: boolean; key?: string }>();
	const downloadHref = `/conversations/archive?conversationId=${conversationId}&download=1`;

	return (
		<div className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-orange-500 dark:hover:border-orange-500 transition-colors">
			<Link to={`/c/${conversationId}?project=${projectId}`} className="block">
				<h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
					{title}
				</h3>
				<p className="text-sm text-gray-500 dark:text-gray-400">
					{messageCount} 条消息 • 最后更新{" "}
					{format(new Date(updatedAt), "yyyy年M月d日 HH:mm")}
				</p>
			</Link>
			<div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
				<backupFetcher.Form method="post" action="/conversations/archive">
					<input type="hidden" name="conversationId" value={conversationId} />
					<button
						type="submit"
						className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
					>
						备份到 R2
					</button>
				</backupFetcher.Form>
				<a
					href={downloadHref}
					className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
				>
					下载
				</a>
				{backupFetcher.data?.ok && backupFetcher.data.key && (
					<span className="text-green-600 dark:text-green-400">
						已保存 {backupFetcher.data.key}
					</span>
				)}
			</div>
		</div>
	);
}

function summarizeUsage(conversations: Array<{ messages: Array<{ meta?: any }> }>) {
	let promptTokens = 0;
	let completionTokens = 0;
	let totalTokens = 0;
	let credits = 0;
	let messages = 0;

	for (const conversation of conversations) {
		for (const message of conversation.messages) {
			messages += 1;
			const usage = message.meta?.usage;
			if (usage) {
				promptTokens += usage.promptTokens || 0;
				completionTokens += usage.completionTokens || 0;
				totalTokens += usage.totalTokens || 0;
			}
			if (message.meta?.credits) {
				credits += message.meta.credits;
			}
		}
	}

	return {
		promptTokens,
		completionTokens,
		totalTokens,
		credits,
		conversations: conversations.length,
		messages,
	};
}

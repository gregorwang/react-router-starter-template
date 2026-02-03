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
		<div className="max-w-5xl mx-auto py-10 px-4">
			<div className="flex flex-wrap items-center justify-between gap-6 mb-8">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
						历史聊天记录
					</h1>
					<p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2">
						跨项目查看与管理所有对话记录。
					</p>
				</div>
				<div className="flex items-center gap-4">
					<select
						className="text-sm border border-neutral-200/70 dark:border-neutral-700/70 rounded-xl px-3 py-2 bg-white/70 dark:bg-neutral-900/60 text-neutral-700 dark:text-neutral-200 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50 hover:border-brand-300/60 dark:hover:border-brand-700/50"
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
						className="text-sm px-4 py-2 rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 text-neutral-700 dark:text-neutral-200 bg-white/70 dark:bg-neutral-900/60 shadow-sm hover:border-brand-400/60 hover:text-brand-700 dark:hover:text-brand-200 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
					>
						新项目
					</button>
				</div>
			</div>
			{conversations.length === 0 ? (
				<div className="text-center py-8">
					<div className="inline-flex flex-col items-center gap-4 rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl px-8 py-6 shadow-sm">
						<p className="text-neutral-600 dark:text-neutral-300">
							暂无对话记录，开始一个新对话吧。
						</p>
						<button
							type="button"
							onClick={() =>
								navigate(`/c/${crypto.randomUUID()}?project=${activeProjectId}`)
							}
							className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-600/30 hover:bg-brand-500 hover:shadow-brand-500/40 transition-all duration-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
						>
							开始新对话
						</button>
					</div>
				</div>
			) : (
				<div className="space-y-4">
					<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl p-6 shadow-sm">
						<div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
							项目用量
						</div>
						{usageTotals.totalTokens > 0 || usageTotals.credits > 0 ? (
							<div className="mt-4 flex flex-wrap gap-4 text-sm text-neutral-600 dark:text-neutral-300">
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
							<div className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
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
		<div className="group p-4 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl rounded-2xl border border-white/60 dark:border-neutral-800/70 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-brand-300/60 dark:hover:border-brand-700/60 transition-all duration-200">
			<Link
				to={`/c/${conversationId}?project=${projectId}`}
				className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
			>
				<h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
					{title}
				</h3>
				<p className="text-sm text-neutral-500 dark:text-neutral-400">
					{messageCount} 条消息 • 最后更新{" "}
					{format(new Date(updatedAt), "yyyy年M月d日 HH:mm")}
				</p>
			</Link>
			<div className="mt-4 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
				<backupFetcher.Form method="post" action="/conversations/archive">
					<input type="hidden" name="conversationId" value={conversationId} />
					<button
						type="submit"
						className="px-3 py-2 rounded-lg border border-neutral-200/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/60 shadow-sm hover:border-brand-400/60 hover:text-brand-700 dark:hover:text-brand-200 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
					>
						备份到 R2
					</button>
				</backupFetcher.Form>
				<a
					href={downloadHref}
					className="px-3 py-2 rounded-lg border border-neutral-200/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/60 shadow-sm hover:border-brand-400/60 hover:text-brand-700 dark:hover:text-brand-200 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950"
				>
					下载
				</a>
				{backupFetcher.data?.ok && backupFetcher.data.key && (
					<span className="text-emerald-600 dark:text-emerald-400">
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

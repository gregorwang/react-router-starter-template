import type { Route } from "./+types/conversations";
import { Link, useFetcher, useNavigate, useSearchParams } from "react-router";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import {
	getProjectUsageTotals,
} from "../lib/db/conversations.server";
import { getConversationsCached } from "../lib/cache/conversation-index.server";
import { getProjects } from "../lib/db/projects.server";
import { requireAuth } from "../lib/auth.server";
import type { ProjectUsageTotals } from "../lib/db/conversations.server";
import type { Conversation, Project } from "../lib/llm/types";
import { selectBaseClass } from "../components/shared/form-styles";
import { Button } from "../components/shared/Button";

type LoaderData = {
	conversations: Conversation[];
	projects: Project[];
	activeProjectId: string;
	usageTotals: ProjectUsageTotals;
};

// Server loader - runs in Cloudflare Worker with D1 database
export async function loader({ context, request }: Route.LoaderArgs) {
	const user = await requireAuth(request, context.db);
	const projects = await getProjects(context.db, user.id);
	const url = new URL(request.url);
	const requestedProjectId = url.searchParams.get("project");
	const projectIds = new Set(projects.map((project) => project.id));
	const activeProjectId =
		(requestedProjectId && projectIds.has(requestedProjectId)
			? requestedProjectId
			: projects[0]?.id) || "default";

	const [conversations, usageTotals] = await Promise.all([
		getConversationsCached({
			db: context.db,
			kv: context.cloudflare.env.SETTINGS_KV,
			ctx: context.cloudflare.ctx,
			userId: user.id,
			projectId: activeProjectId,
		}),
		getProjectUsageTotals(context.db, user.id, activeProjectId),
	]);
	return Response.json(
		{ conversations, projects, activeProjectId, usageTotals },
		{
			headers: {
				"Cache-Control": "private, max-age=10, stale-while-revalidate=30",
			},
		},
	);
}

export default function Conversations({ loaderData }: { loaderData: LoaderData }) {
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
		const descriptionInput = window.prompt("项目描述（可选）", "");
		if (descriptionInput === null) return;
		const description = descriptionInput.trim();
		projectFetcher.submit(
			{ name: name.trim(), description },
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
						className={selectBaseClass}
						value={activeProjectId}
						onChange={(e) => handleProjectChange(e.target.value)}
					>
						{projects.map((project) => (
							<option key={project.id} value={project.id}>
								{project.name}
							</option>
						))}
					</select>
					<Button type="button" variant="outline" onClick={handleCreateProject}>
						新项目
					</Button>
				</div>
			</div>
			{conversations.length === 0 ? (
				<div className="text-center py-8">
					<div className="inline-flex flex-col items-center gap-4 rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl px-8 py-6 shadow-sm">
						<p className="text-neutral-600 dark:text-neutral-300">
							暂无对话记录，开始一个新对话吧。
						</p>
						<Button
							type="button"
							onClick={() =>
								navigate(`/c/${crypto.randomUUID()}?project=${activeProjectId}`)
							}
						>
							开始新对话
						</Button>
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
							messageCount={conv.messageCount ?? conv.messages.length}
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
	const [archiveKey, setArchiveKey] = useState<string | null>(null);
	const [isPreparingDownload, setIsPreparingDownload] = useState(false);

	useEffect(() => {
		if (backupFetcher.data?.ok && backupFetcher.data.key) {
			setArchiveKey(backupFetcher.data.key);
		}
	}, [backupFetcher.data]);

	const handleDownload = async () => {
		if (isPreparingDownload) return;
		try {
			setIsPreparingDownload(true);
			if (!archiveKey) {
				const confirmBackup = window.confirm(
					"下载前需要先备份到 R2。是否立即备份并下载？",
				);
				if (!confirmBackup) return;
				const response = await fetch("/conversations/archive", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ conversationId }),
				});
				if (!response.ok) {
					const text = await response.text();
					throw new Error(text || "备份失败");
				}
				const data = (await response.json()) as { ok?: boolean; key?: string };
				if (!data.ok || !data.key) {
					throw new Error("备份失败");
				}
				setArchiveKey(data.key);
			}
			window.location.assign(downloadHref);
		} catch (error) {
			const message = error instanceof Error ? error.message : "下载失败";
			window.alert(message);
		} finally {
			setIsPreparingDownload(false);
		}
	};

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
					<Button type="submit" variant="outline" size="sm">
						备份到 R2
					</Button>
				</backupFetcher.Form>
				<Button
					type="button"
					onClick={handleDownload}
					disabled={isPreparingDownload}
					variant="outline"
					size="sm"
				>
					{isPreparingDownload ? "准备中..." : "下载"}
				</Button>
				{backupFetcher.data?.ok && backupFetcher.data.key && (
					<span className="text-emerald-600 dark:text-emerald-400">
						已保存 {backupFetcher.data.key}
					</span>
				)}
			</div>
		</div>
	);
}

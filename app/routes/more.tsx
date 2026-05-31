import type { Route } from "./+types/more";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useCallback } from "react";
import { requireAuth } from "../lib/auth.server";
import { getProjects } from "../lib/db/projects.server";
import { getUsageStatsCached } from "../lib/cache/usage-stats.server";
import type { Project } from "../lib/llm/types";
import { selectBaseClass } from "../components/shared/form-styles";

type RangeKey = "today" | "7d" | "30d";

type UsagePaneData = {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	totalCalls: number;
	models: Record<string, number>;
	range: RangeKey;
	label: string;
	projects: Project[];
	activeProjectId: string;
	error?: string;
};

type LoaderData = {
	usage: UsagePaneData;
};

const RANGE_LABELS: Record<RangeKey, string> = {
	today: "今日",
	"7d": "近7天",
	"30d": "近30天",
};

function parseRange(value: string | null): RangeKey {
	if (value === "7d" || value === "30d") return value;
	return "today";
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = await requireAuth(request, context.db);
	const url = new URL(request.url);
	const range = parseRange(url.searchParams.get("range"));
	const projectIdParam = url.searchParams.get("project");
	const projects = await getProjects(context.db, user.id);
	const projectIds = new Set(projects.map((project) => project.id));
	const usageProjectId =
		projectIdParam === "all" || !projectIdParam
			? undefined
			: projectIds.has(projectIdParam)
				? projectIdParam
				: undefined;

	const now = new Date();
	let startMs = now.getTime();
	if (range === "today") {
		const start = new Date(now);
		start.setHours(0, 0, 0, 0);
		startMs = start.getTime();
	} else if (range === "7d") {
		startMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
	} else {
		startMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;
	}

	let usage: UsagePaneData;
	try {
		const stats = await getUsageStatsCached({
			db: context.db,
			kv: context.cloudflare.env.SETTINGS_KV,
			ctx: context.cloudflare.ctx,
			userId: user.id,
			startMs,
			endMs: now.getTime(),
			projectId: usageProjectId,
		});
		usage = {
			range,
			label: RANGE_LABELS[range],
			projects,
			activeProjectId:
				projectIdParam && projectIds.has(projectIdParam) ? projectIdParam : "all",
			...stats,
		};
	} catch (error) {
		usage = {
			range,
			label: RANGE_LABELS[range],
			projects,
			activeProjectId:
				projectIdParam && projectIds.has(projectIdParam) ? projectIdParam : "all",
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			totalCalls: 0,
			models: {},
			error: error instanceof Error ? error.message : String(error),
		};
	}

	return Response.json({ usage });
}

export default function MorePage({ loaderData }: { loaderData: LoaderData }) {
	const { usage } = loaderData;
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();

	const updateParams = useCallback(
		(next: Record<string, string>) => {
			const params = new URLSearchParams(searchParams);
			Object.entries(next).forEach(([key, value]) => {
				params.set(key, value);
			});
			navigate(`/more?${params.toString()}`);
		},
		[navigate, searchParams],
	);

	const modelEntries = Object.entries(usage.models).sort((a, b) => b[1] - a[1]);

	return (
		<div className="min-h-[100dvh] px-4 py-8 bg-[radial-gradient(1200px_circle_at_8%_-12%,rgba(196,224,255,0.42),transparent_46%),radial-gradient(1000px_circle_at_92%_0%,rgba(150,205,255,0.2),transparent_52%)] dark:bg-[radial-gradient(1200px_circle_at_8%_-12%,rgba(78,120,190,0.24),transparent_46%),radial-gradient(1000px_circle_at_92%_0%,rgba(55,87,135,0.22),transparent_52%)]">
			<div className="max-w-6xl mx-auto space-y-6">
				<div className="relative overflow-hidden rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/80 dark:bg-neutral-900/75 backdrop-blur-xl p-5 shadow-sm">
					<div className="relative flex flex-wrap items-start justify-between gap-4">
						<div>
							<h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
								更多
							</h1>
							<p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
								查看当前本地用户的用量概览。
							</p>
						</div>
						<Link
							to="/c/new"
							className="px-3 py-2 text-sm rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 text-neutral-600 dark:text-neutral-300 hover:text-brand-700 dark:hover:text-brand-200 hover:border-brand-300/70 dark:hover:border-brand-700/70 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
						>
							返回聊天
						</Link>
					</div>
				</div>

				<div className="rounded-3xl border border-white/60 dark:border-neutral-800/70 bg-white/75 dark:bg-neutral-900/75 backdrop-blur-xl p-6 shadow-sm min-h-[36rem]">
					<div className="space-y-6">
						<div className="flex flex-wrap items-center justify-between gap-4">
							<div>
								<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
									用量
								</h2>
								<p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
									{usage.label}概览
								</p>
							</div>
							<div className="flex items-center gap-3">
								<select
									className={selectBaseClass}
									value={usage.activeProjectId}
									onChange={(e) => updateParams({ project: e.target.value })}
								>
									<option value="all">全部项目</option>
									{usage.projects.map((project) => (
										<option key={project.id} value={project.id}>
											{project.name}
										</option>
									))}
								</select>
								<div className="flex items-center gap-2">
									{(["today", "7d", "30d"] as const).map((key) => (
										<button
											key={key}
											type="button"
											onClick={() => updateParams({ range: key })}
											className={
												usage.range === key
													? "px-3 py-2 text-xs rounded-lg border border-brand-400/70 text-brand-700 bg-brand-50/80 shadow-sm dark:text-brand-200 dark:bg-brand-900/30"
													: "px-3 py-2 text-xs rounded-lg border border-neutral-200/70 dark:border-neutral-700/70 text-neutral-500 dark:text-neutral-400 hover:text-brand-600 dark:hover:text-brand-200 hover:border-brand-300/60"
											}
										>
											{RANGE_LABELS[key]}
										</button>
									))}
								</div>
							</div>
						</div>

						{usage.error && (
							<div className="rounded-2xl border border-rose-200/80 dark:border-rose-900/70 bg-rose-50/80 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 p-4 text-sm">
								加载用量失败：{usage.error}
							</div>
						)}

						<div className="grid gap-4 md:grid-cols-2">
							<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 p-5">
								<div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
									Token 用量
								</div>
								<div className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
									<div className="flex items-center justify-between">
										<span>输入</span>
										<span className="font-medium">{usage.promptTokens}</span>
									</div>
									<div className="flex items-center justify-between">
										<span>输出</span>
										<span className="font-medium">{usage.completionTokens}</span>
									</div>
									<div className="flex items-center justify-between">
										<span>总计</span>
										<span className="font-medium">{usage.totalTokens}</span>
									</div>
								</div>
							</div>
							<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 p-5">
								<div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
									调用
								</div>
								<div className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
									<div className="flex items-center justify-between">
										<span>总调用次数</span>
										<span className="font-medium">{usage.totalCalls}</span>
									</div>
								</div>
							</div>
						</div>

						<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 p-5">
							<div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
								模型
							</div>
							{modelEntries.length === 0 ? (
								<p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
									暂无用量数据。
								</p>
							) : (
								<ul className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
									{modelEntries.map(([model, count]) => (
										<li key={model} className="flex items-center justify-between">
											<span className="truncate max-w-[320px]">{model}</span>
											<span className="font-medium">{count}</span>
										</li>
									))}
								</ul>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

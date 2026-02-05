import type { Route } from "./+types/usage";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useCallback } from "react";
import { getUsageStats } from "../lib/db/usage.server";
import { getProjects } from "../lib/db/projects.server";
import { requireAuth } from "../lib/auth.server";
import type { UsageStats } from "../lib/db/usage.server";
import type { Project } from "../lib/llm/types";

type RangeKey = "today" | "7d" | "30d";
type LoaderData = UsageStats & {
	range: RangeKey;
	label: string;
	projects: Project[];
	activeProjectId: string;
	error?: string;
};

const RANGE_LABELS: Record<RangeKey, string> = {
	today: "今日",
	"7d": "近7天",
	"30d": "近30天",
};

export async function loader({ context, request }: Route.LoaderArgs) {
	const user = await requireAuth(request, context.db);
	const url = new URL(request.url);
	const rangeParam = url.searchParams.get("range") as RangeKey | null;
	const range: RangeKey = rangeParam && rangeParam in RANGE_LABELS ? rangeParam : "today";
	const projectIdParam = url.searchParams.get("project");
	const projects = await getProjects(context.db, user.id);
	const projectIds = new Set(projects.map((project) => project.id));
	const projectId =
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

	try {
		const stats = await getUsageStats(context.db, {
			userId: user.id,
			startMs,
			endMs: now.getTime(),
			projectId,
		});

		return Response.json(
			{
				range,
				label: RANGE_LABELS[range],
				projects,
				activeProjectId: projectIdParam && projectIds.has(projectIdParam) ? projectIdParam : "all",
				...stats,
			},
			{
				headers: {
					"Cache-Control": "private, max-age=10, stale-while-revalidate=30",
				},
			},
		);
	} catch (error) {
		return Response.json(
			{
				range,
				label: RANGE_LABELS[range],
				projects,
				activeProjectId: projectIdParam && projectIds.has(projectIdParam) ? projectIdParam : "all",
				promptTokens: 0,
				completionTokens: 0,
				totalTokens: 0,
				totalCalls: 0,
				models: {},
				error: error instanceof Error ? error.message : String(error),
			},
			{
				headers: {
					"Cache-Control": "private, max-age=10, stale-while-revalidate=30",
				},
			},
		);
	}
}

export default function UsagePage({ loaderData }: { loaderData: LoaderData }) {
	const {
		range,
		label,
		projects,
		activeProjectId,
		promptTokens,
		completionTokens,
		totalTokens,
		totalCalls,
		models,
		error,
	} = loaderData;

	const navigate = useNavigate();
	const [searchParams] = useSearchParams();

	const updateParams = useCallback(
		(next: Record<string, string>) => {
			const params = new URLSearchParams(searchParams);
			Object.entries(next).forEach(([key, value]) => {
				params.set(key, value);
			});
			navigate(`/usage?${params.toString()}`);
		},
		[navigate, searchParams],
	);

	const modelEntries = Object.entries(models).sort((a, b) => b[1] - a[1]);

	return (
		<div className="max-w-5xl mx-auto py-10 px-4">
			<div className="flex flex-wrap items-center justify-between gap-6 mb-8">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
						用量
					</h1>
					<p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2">
						{label}概览
					</p>
				</div>
				<div className="flex items-center gap-4">
					<select
						className="text-sm border border-neutral-200/70 dark:border-neutral-700/70 rounded-xl px-3 py-2 bg-white/70 dark:bg-neutral-900/60 text-neutral-700 dark:text-neutral-200 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50 hover:border-brand-300/60 dark:hover:border-brand-700/50"
						value={activeProjectId}
						onChange={(e) => updateParams({ project: e.target.value })}
					>
						<option value="all">全部项目</option>
						{projects.map((project) => (
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
								className={`px-3 py-2 text-xs rounded-lg border transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950 ${
									range === key
										? "border-brand-400/70 text-brand-700 bg-brand-50/80 shadow-sm dark:text-brand-200 dark:bg-brand-900/30"
										: "border-neutral-200/70 dark:border-neutral-700/70 text-neutral-500 dark:text-neutral-400 hover:text-brand-600 dark:hover:text-brand-200 hover:border-brand-300/60"
								}`}
							>
								{RANGE_LABELS[key]}
							</button>
						))}
					</div>
				</div>
			</div>

			{error && (
				<div className="mb-6 rounded-2xl border border-rose-200/80 dark:border-rose-900/70 bg-rose-50/80 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 p-4 text-sm shadow-sm">
					加载用量失败：{error}
				</div>
			)}

			<div className="grid gap-4 md:grid-cols-2">
				<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl p-6 shadow-sm">
					<div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
						Token 用量
					</div>
					<div className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
						<div className="flex items-center justify-between">
							<span>输入</span>
							<span className="font-medium">{promptTokens}</span>
						</div>
						<div className="flex items-center justify-between">
							<span>输出</span>
							<span className="font-medium">{completionTokens}</span>
						</div>
						<div className="flex items-center justify-between">
							<span>总计</span>
							<span className="font-medium">{totalTokens}</span>
						</div>
					</div>
				</div>

				<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl p-6 shadow-sm">
					<div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
						调用
					</div>
					<div className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
						<div className="flex items-center justify-between">
							<span>总调用次数</span>
							<span className="font-medium">{totalCalls}</span>
						</div>
					</div>
				</div>
			</div>

			<div className="mt-6 rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl p-6 shadow-sm">
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
								<span className="truncate max-w-[280px]">{model}</span>
								<span className="font-medium">{count}</span>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="mt-6">
				<Link
					to="/conversations"
					className="text-sm text-brand-600 hover:text-brand-500 transition-colors focus-visible:ring-2 focus-visible:ring-brand-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950 rounded-md"
				>
					返回历史聊天记录
				</Link>
			</div>
		</div>
	);
}

import type { Route } from "./+types/usage";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useCallback } from "react";
import { getUsageStats } from "../lib/db/usage.server";
import { ensureDefaultProject, getProjects } from "../lib/db/projects.server";

type RangeKey = "today" | "7d" | "30d";

const RANGE_LABELS: Record<RangeKey, string> = {
	today: "今日",
	"7d": "近7天",
	"30d": "近30天",
};

export async function loader({ context, request }: Route.LoaderArgs) {
	await ensureDefaultProject(context.db);
	const projects = await getProjects(context.db);

	const url = new URL(request.url);
	const rangeParam = url.searchParams.get("range") as RangeKey | null;
	const range: RangeKey = rangeParam && rangeParam in RANGE_LABELS ? rangeParam : "today";
	const projectIdParam = url.searchParams.get("project");
	const projectId =
		projectIdParam === "all" || !projectIdParam ? undefined : projectIdParam;

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
			startMs,
			endMs: now.getTime(),
			projectId,
		});

		return {
			range,
			label: RANGE_LABELS[range],
			projects,
			activeProjectId: projectIdParam || "all",
			...stats,
		};
	} catch (error) {
		return {
			range,
			label: RANGE_LABELS[range],
			projects,
			activeProjectId: projectIdParam || "all",
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			totalCalls: 0,
			models: {},
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export default function UsagePage({ loaderData }: Route.ComponentProps) {
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
	} = loaderData as Route.ComponentProps["loaderData"] & { error?: string };

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
		<div className="max-w-4xl mx-auto py-8 px-4">
			<div className="flex flex-wrap items-center justify-between gap-4 mb-8">
				<div>
					<h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
						用量
					</h1>
					<p className="text-sm text-gray-500 dark:text-gray-400">
						{label}概览
					</p>
				</div>
				<div className="flex items-center gap-2">
					<select
						className="text-sm border border-gray-200 dark:border-gray-700 rounded px-2 py-1 bg-transparent text-gray-700 dark:text-gray-200"
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
					<div className="flex items-center gap-1">
						{(["today", "7d", "30d"] as const).map((key) => (
							<button
								key={key}
								type="button"
								onClick={() => updateParams({ range: key })}
								className={`px-3 py-1 text-xs rounded border transition-colors ${
									range === key
										? "border-orange-500 text-orange-600 dark:text-orange-400"
										: "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
								}`}
							>
								{RANGE_LABELS[key]}
							</button>
						))}
					</div>
				</div>
			</div>

			{error && (
				<div className="mb-6 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 p-3 text-sm">
					加载用量失败：{error}
				</div>
			)}

			<div className="grid gap-4 md:grid-cols-2">
				<div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
					<div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
						Token 用量
					</div>
					<div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">
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

				<div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
					<div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
						调用
					</div>
					<div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
						<div className="flex items-center justify-between">
							<span>总调用次数</span>
							<span className="font-medium">{totalCalls}</span>
						</div>
					</div>
				</div>
			</div>

			<div className="mt-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
				<div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
					模型
				</div>
				{modelEntries.length === 0 ? (
					<p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
						暂无用量数据。
					</p>
				) : (
					<ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-300">
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
					className="text-sm text-orange-500 hover:text-orange-600"
				>
					返回历史聊天记录
				</Link>
			</div>
		</div>
	);
}

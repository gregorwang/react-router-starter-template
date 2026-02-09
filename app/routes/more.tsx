import type { Route } from "./+types/more";
import { Form, Link, useActionData, useFetcher, useNavigate, useSearchParams } from "react-router";
import { useCallback } from "react";
import { format } from "date-fns";
import { Button } from "../components/shared/Button";
import { inputCompactClass, selectBaseClass } from "../components/shared/form-styles";
import { PROVIDER_MODELS, PROVIDER_NAMES } from "../lib/llm/types";
import type { Project, User } from "../lib/llm/types";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

type RangeKey = "today" | "7d" | "30d";
type MoreTab = "usage" | "admin";
type ActionData = { ok?: boolean; error?: string; inviteCode?: string };

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

type InviteCode = {
	code: string;
	usedBy?: string;
	expiresAt: number;
};

type UserModelLimit = {
	userId: string;
	provider: string;
	model: string;
	enabled: boolean;
	weeklyLimit?: number | null;
	monthlyLimit?: number | null;
};

type AdminPaneData = {
	users: User[];
	invites: InviteCode[];
	limits: UserModelLimit[];
};

type LoaderData = {
	tab: MoreTab;
	isAdmin: boolean;
	usage: UsagePaneData;
	admin: AdminPaneData | null;
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

function parseTab(value: string | null): MoreTab {
	return value === "admin" ? "admin" : "usage";
}

export async function loader({ context, request }: Route.LoaderArgs) {
	const [{ requireAuth }, { getProjects }, { getUsageStatsCached }] = await Promise.all([
		import("../lib/auth.server"),
		import("../lib/db/projects.server"),
		import("../lib/cache/usage-stats.server"),
	]);
	const user = await requireAuth(request, context.db);
	const isAdmin = user.role === "admin";
	const url = new URL(request.url);

	const range = parseRange(url.searchParams.get("range"));
	const requestedTab = parseTab(url.searchParams.get("tab"));
	const tab: MoreTab = requestedTab === "admin" && !isAdmin ? "usage" : requestedTab;

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

	let admin: AdminPaneData | null = null;
	if (isAdmin) {
		const [{ listUsers }, { listInviteCodes }, { listAllUserModelLimits }] = await Promise.all([
			import("../lib/db/users.server"),
			import("../lib/db/invites.server"),
			import("../lib/db/user-model-limits.server"),
		]);
		const [users, invites, limits] = await Promise.all([
			listUsers(context.db),
			listInviteCodes(context.db),
			listAllUserModelLimits(context.db),
		]);
		admin = { users, invites, limits };
	}

	return Response.json({
		tab,
		isAdmin,
		usage,
		admin,
	});
}

export async function action({ request, context }: Route.ActionArgs) {
	const [{ requireAuth }, { createInviteCode }, { upsertUserModelLimit }] = await Promise.all([
		import("../lib/auth.server"),
		import("../lib/db/invites.server"),
		import("../lib/db/user-model-limits.server"),
	]);
	const user = await requireAuth(request, context.db);
	if (user.role !== "admin") {
		return Response.json({ ok: false, error: "仅管理员可执行该操作。" }, { status: 403 });
	}
	if (request.method !== "POST") {
		return new Response("Method not allowed", { status: 405 });
	}

	const formData = await request.formData();
	const intent = (formData.get("intent") as string | null) || "";

	if (intent === "createInvite") {
		const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
		const expiresAt = Date.now() + INVITE_TTL_MS;
		await createInviteCode(context.db, {
			code,
			createdBy: user.id,
			expiresAt,
		});
		return Response.json({ ok: true, inviteCode: code });
	}

	if (intent === "updateLimit") {
		const userId = (formData.get("userId") as string | null)?.trim();
		const modelKey = (formData.get("modelKey") as string | null)?.trim();
		const enabled = formData.get("enabled") === "on";
		const weeklyLimitRaw = (formData.get("weeklyLimit") as string | null)?.trim();
		const monthlyLimitRaw = (formData.get("monthlyLimit") as string | null)?.trim();

		if (!userId || !modelKey) {
			return Response.json({ ok: false, error: "缺少必要字段。" }, { status: 400 });
		}

		const [provider, model] = modelKey.split(":");
		if (!provider || !model) {
			return Response.json({ ok: false, error: "模型格式错误。" }, { status: 400 });
		}
		if (!Object.prototype.hasOwnProperty.call(PROVIDER_MODELS, provider)) {
			return Response.json({ ok: false, error: "不支持的模型提供方。" }, { status: 400 });
		}
		if (!PROVIDER_MODELS[provider as keyof typeof PROVIDER_MODELS].includes(model)) {
			return Response.json({ ok: false, error: "不支持的模型。" }, { status: 400 });
		}

		const weeklyLimit =
			weeklyLimitRaw && Number.isFinite(Number(weeklyLimitRaw))
				? Math.max(0, Number(weeklyLimitRaw))
				: null;
		const monthlyLimit =
			monthlyLimitRaw && Number.isFinite(Number(monthlyLimitRaw))
				? Math.max(0, Number(monthlyLimitRaw))
				: null;

		await upsertUserModelLimit(context.db, {
			userId,
			provider,
			model,
			enabled,
			weeklyLimit,
			monthlyLimit,
		});

		return Response.json({ ok: true });
	}

	return Response.json({ ok: false, error: "未知操作。" }, { status: 400 });
}

export default function MorePage({ loaderData }: { loaderData: LoaderData }) {
	const { usage, tab, isAdmin, admin } = loaderData;
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const actionData = useActionData<ActionData>();
	const inviteFetcher = useFetcher<ActionData>();

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
	const usersById = new Map((admin?.users || []).map((item) => [item.id, item.username]));
	const activeTab: MoreTab = tab === "admin" && isAdmin ? "admin" : "usage";

	return (
		<div className="min-h-[100dvh] px-4 py-8 bg-[radial-gradient(1200px_circle_at_8%_-12%,rgba(196,224,255,0.42),transparent_46%),radial-gradient(1000px_circle_at_92%_0%,rgba(150,205,255,0.2),transparent_52%)] dark:bg-[radial-gradient(1200px_circle_at_8%_-12%,rgba(78,120,190,0.24),transparent_46%),radial-gradient(1000px_circle_at_92%_0%,rgba(55,87,135,0.22),transparent_52%)]">
			<div className="max-w-6xl mx-auto space-y-6">
				<div className="relative overflow-hidden rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/80 dark:bg-neutral-900/75 backdrop-blur-xl p-5 shadow-sm">
					<div className="pointer-events-none absolute -left-12 -top-12 h-32 w-32 rounded-full bg-brand-200/35 dark:bg-brand-700/20 blur-2xl" />
					<div className="pointer-events-none absolute -right-16 -bottom-14 h-36 w-36 rounded-full bg-accent-200/35 dark:bg-accent-700/20 blur-2xl" />
					<div className="relative flex flex-wrap items-start justify-between gap-4">
						<div>
							<h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
								更多
							</h1>
							<p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
								同一页面内切换用量与管理
							</p>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => updateParams({ tab: "usage" })}
								className={
									activeTab === "usage"
										? "px-3 py-2 text-sm rounded-xl border border-brand-300/70 bg-brand-50/80 text-brand-700 dark:border-brand-700/70 dark:bg-brand-900/30 dark:text-brand-200"
										: "px-3 py-2 text-sm rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 text-neutral-600 dark:text-neutral-300 hover:border-brand-300/70 dark:hover:border-brand-700/70"
								}
							>
								用量
							</button>
							{isAdmin && (
								<button
									type="button"
									onClick={() => updateParams({ tab: "admin" })}
									className={
										activeTab === "admin"
											? "px-3 py-2 text-sm rounded-xl border border-accent-300/70 bg-accent-50/80 text-accent-700 dark:border-accent-700/70 dark:bg-accent-900/20 dark:text-accent-200"
											: "px-3 py-2 text-sm rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 text-neutral-600 dark:text-neutral-300 hover:border-accent-300/70 dark:hover:border-accent-700/70"
									}
								>
									管理
								</button>
							)}
							<Link
								to="/c/new"
								className="px-3 py-2 text-sm rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 text-neutral-600 dark:text-neutral-300 hover:text-brand-700 dark:hover:text-brand-200 hover:border-brand-300/70 dark:hover:border-brand-700/70 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
							>
								返回聊天
							</Link>
						</div>
					</div>
				</div>

				<div className="rounded-3xl border border-white/60 dark:border-neutral-800/70 bg-white/75 dark:bg-neutral-900/75 backdrop-blur-xl p-6 shadow-sm min-h-[36rem]">
					<div key={activeTab} className="more-pane-enter">
						{activeTab === "usage" ? (
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
										onChange={(e) =>
											updateParams({ project: e.target.value, tab: "usage" })
										}
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
												onClick={() => updateParams({ range: key, tab: "usage" })}
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
						) : (
						<div className="space-y-6">
							<div>
								<h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
									管理
								</h2>
								<p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
									邀请码与模型权限配置
								</p>
							</div>

							{!isAdmin || !admin ? (
								<div className="rounded-2xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/70 p-6 text-sm text-neutral-600 dark:text-neutral-300">
									你当前没有管理权限。
								</div>
							) : (
								<>
									<div className="grid gap-6 md:grid-cols-2">
										<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 p-6 space-y-4">
											<div className="flex items-center justify-between">
												<h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
													邀请码
												</h3>
												<inviteFetcher.Form method="post">
													<input type="hidden" name="intent" value="createInvite" />
													<Button type="submit">生成邀请码</Button>
												</inviteFetcher.Form>
											</div>

											{inviteFetcher.data?.inviteCode && (
												<div className="rounded-xl border border-emerald-200/70 bg-emerald-50/70 text-emerald-700 p-3 text-sm">
													新邀请码：
													<span className="font-mono ml-1">{inviteFetcher.data.inviteCode}</span>
												</div>
											)}
											<p className="text-xs text-neutral-500">邀请码有效期 7 天，仅可使用一次。</p>

											<div className="space-y-2 text-sm text-neutral-600 dark:text-neutral-300 max-h-64 overflow-auto">
												{admin.invites.length === 0 ? (
													<p className="text-neutral-500">暂无邀请码记录。</p>
												) : (
													admin.invites.map((invite) => (
														<div
															key={invite.code}
															className="flex items-center justify-between border border-neutral-200/60 dark:border-neutral-800/60 rounded-lg px-3 py-2"
														>
															<span className="font-mono">{invite.code}</span>
															<span className="text-xs text-neutral-500">
																{invite.usedBy
																	? `已使用 (${usersById.get(invite.usedBy) || invite.usedBy})`
																	: invite.expiresAt <= Date.now()
																		? "已过期"
																		: `有效期至 ${format(new Date(invite.expiresAt), "yyyy-MM-dd")}`}
															</span>
														</div>
													))
												)}
											</div>
										</div>

										<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 p-6 space-y-4">
											<h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
												模型权限设置
											</h3>
											<Form method="post" className="space-y-3">
												<input type="hidden" name="intent" value="updateLimit" />
												<label className="block text-sm text-neutral-600 dark:text-neutral-300">
													<span className="block mb-1">用户</span>
													<select
														name="userId"
														required
														className={`${selectBaseClass} w-full text-neutral-900 dark:text-neutral-100`}
													>
														{admin.users.map((item) => (
															<option key={item.id} value={item.id}>
																{item.username} ({item.role})
															</option>
														))}
													</select>
												</label>

												<label className="block text-sm text-neutral-600 dark:text-neutral-300">
													<span className="block mb-1">模型</span>
													<select
														name="modelKey"
														required
														className={`${selectBaseClass} w-full text-neutral-900 dark:text-neutral-100`}
													>
														{Object.entries(PROVIDER_MODELS).flatMap(([provider, models]) =>
															models.map((model) => (
																<option
																	key={`${provider}:${model}`}
																	value={`${provider}:${model}`}
																>
																	{PROVIDER_NAMES[provider as keyof typeof PROVIDER_NAMES] || provider}
																	{" - "}
																	{model}
																</option>
															)),
														)}
													</select>
												</label>

												<label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
													<input type="checkbox" name="enabled" defaultChecked />
													启用该模型
												</label>

												<div className="grid gap-2 md:grid-cols-2">
													<label className="block text-sm text-neutral-600 dark:text-neutral-300">
														<span className="block mb-1">周配额（次）</span>
														<input
															type="number"
															name="weeklyLimit"
															min="0"
															placeholder="留空表示无限制"
															className={`${inputCompactClass} text-neutral-900 dark:text-neutral-100`}
														/>
													</label>
													<label className="block text-sm text-neutral-600 dark:text-neutral-300">
														<span className="block mb-1">月配额（次）</span>
														<input
															type="number"
															name="monthlyLimit"
															min="0"
															placeholder="留空表示无限制"
															className={`${inputCompactClass} text-neutral-900 dark:text-neutral-100`}
														/>
													</label>
												</div>

												{actionData?.error && (
													<div className="rounded-xl border border-rose-200/70 bg-rose-50/80 text-rose-700 p-3 text-sm">
														{actionData.error}
													</div>
												)}
												<Button type="submit" className="w-full justify-center py-3">
													保存配置
												</Button>
											</Form>
										</div>
									</div>

									<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 p-6">
										<h3 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 mb-4">
											已配置权限
										</h3>
										{admin.limits.length === 0 ? (
											<p className="text-sm text-neutral-500">暂无配置。</p>
										) : (
											<div className="overflow-auto">
												<table className="min-w-full text-sm text-neutral-600 dark:text-neutral-300">
													<thead className="text-xs uppercase text-neutral-500">
														<tr>
															<th className="text-left py-2 pr-4">用户</th>
															<th className="text-left py-2 pr-4">模型</th>
															<th className="text-left py-2 pr-4">状态</th>
															<th className="text-left py-2 pr-4">周配额</th>
															<th className="text-left py-2 pr-4">月配额</th>
														</tr>
													</thead>
													<tbody>
														{admin.limits.map((limit) => (
															<tr key={`${limit.userId}:${limit.provider}:${limit.model}`}>
																<td className="py-2 pr-4">
																	{usersById.get(limit.userId) || limit.userId}
																</td>
																<td className="py-2 pr-4">
																	{PROVIDER_NAMES[limit.provider as keyof typeof PROVIDER_NAMES] ||
																		limit.provider}
																	{" - "}
																	{limit.model}
																</td>
																<td className="py-2 pr-4">{limit.enabled ? "启用" : "禁用"}</td>
																<td className="py-2 pr-4">{limit.weeklyLimit ?? "无限制"}</td>
																<td className="py-2 pr-4">{limit.monthlyLimit ?? "无限制"}</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										)}
									</div>
								</>
							)}
						</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

import type { Route } from "./+types/admin";
import { Form, useActionData, useFetcher } from "react-router";
import { format } from "date-fns";
import { requireAdmin } from "../lib/auth.server";
import { Button } from "../components/shared/Button";
import { inputCompactClass, selectBaseClass } from "../components/shared/form-styles";
import { createInviteCode, listInviteCodes } from "../lib/db/invites.server";
import { listUsers } from "../lib/db/users.server";
import {
	listAllUserModelLimits,
	upsertUserModelLimit,
} from "../lib/db/user-model-limits.server";
import { PROVIDER_MODELS, PROVIDER_NAMES } from "../lib/llm/types";
import type { InviteCode } from "../lib/db/invites.server";
import type { UserModelLimit } from "../lib/db/user-model-limits.server";
import type { User } from "../lib/llm/types";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

type ActionData = { ok?: boolean; error?: string; inviteCode?: string };
type LoaderData = {
	users: User[];
	invites: InviteCode[];
	limits: UserModelLimit[];
};

export async function loader({ request, context }: Route.LoaderArgs) {
	await requireAdmin(request, context.db);
	const [users, invites, limits] = await Promise.all([
		listUsers(context.db),
		listInviteCodes(context.db),
		listAllUserModelLimits(context.db),
	]);

	return Response.json({
		users,
		invites,
		limits,
	});
}

export async function action({ request, context }: Route.ActionArgs) {
	const admin = await requireAdmin(request, context.db);
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
			createdBy: admin.id,
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

export default function AdminPage({ loaderData }: { loaderData: LoaderData }) {
	const { users, invites, limits } = loaderData;

	const inviteFetcher = useFetcher<ActionData>();
	const actionData = useActionData<ActionData>();
	const usersById = new Map(users.map((user) => [user.id, user.username]));

	return (
		<div className="max-w-6xl mx-auto py-10 px-4 space-y-8">
			<div>
				<h1 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
					管理面板
				</h1>
				<p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2">
					邀请码与模型权限配置。
				</p>
			</div>

			<div className="grid gap-6 md:grid-cols-2">
				<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl p-6 shadow-sm space-y-4">
					<div className="flex items-center justify-between">
						<h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
							邀请码
						</h2>
						<inviteFetcher.Form method="post">
							<input type="hidden" name="intent" value="createInvite" />
							<Button type="submit">
								生成邀请码
							</Button>
						</inviteFetcher.Form>
					</div>

					{inviteFetcher.data?.inviteCode && (
						<div className="rounded-xl border border-emerald-200/70 bg-emerald-50/70 text-emerald-700 p-3 text-sm">
							新邀请码：<span className="font-mono">{inviteFetcher.data.inviteCode}</span>
						</div>
					)}
					<p className="text-xs text-neutral-500">
						邀请码有效期 7 天，仅可使用一次。
					</p>

					<div className="space-y-2 text-sm text-neutral-600 dark:text-neutral-300 max-h-64 overflow-auto">
						{invites.length === 0 ? (
							<p className="text-neutral-500">暂无邀请码记录。</p>
						) : (
							invites.map((invite) => (
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

				<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl p-6 shadow-sm space-y-4">
					<h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
						模型权限设置
					</h2>

					<Form method="post" className="space-y-3">
						<input type="hidden" name="intent" value="updateLimit" />
						<label className="block text-sm text-neutral-600 dark:text-neutral-300">
							<span className="block mb-1">用户</span>
							<select
								name="userId"
								required
								className={`${selectBaseClass} w-full text-neutral-900 dark:text-neutral-100`}
							>
								{users.map((user) => (
									<option key={user.id} value={user.id}>
										{user.username} ({user.role})
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
										<option key={`${provider}:${model}`} value={`${provider}:${model}`}>
											{PROVIDER_NAMES[provider as keyof typeof PROVIDER_NAMES] || provider} - {model}
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

			<div className="rounded-2xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-xl p-6 shadow-sm">
				<h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 mb-4">
					已配置权限
				</h2>
				{limits.length === 0 ? (
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
								{limits.map((limit) => (
									<tr key={`${limit.userId}:${limit.provider}:${limit.model}`}>
										<td className="py-2 pr-4">
											{usersById.get(limit.userId) || limit.userId}
										</td>
										<td className="py-2 pr-4">
											{PROVIDER_NAMES[limit.provider as keyof typeof PROVIDER_NAMES] ||
												limit.provider}{" "}
											- {limit.model}
										</td>
										<td className="py-2 pr-4">
											{limit.enabled ? "启用" : "禁用"}
										</td>
										<td className="py-2 pr-4">
											{limit.weeklyLimit ?? "无限制"}
										</td>
										<td className="py-2 pr-4">
											{limit.monthlyLimit ?? "无限制"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}

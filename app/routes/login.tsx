import type { Route } from "./+types/login";
import { Form, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import {
	buildAuthSessionCookie,
	createAuthSession,
	getCurrentUser,
	safeRedirect,
} from "../lib/auth.server";
import { hashPassword, verifyPassword } from "../lib/auth/password.server";
import { getInviteCode, markInviteUsed } from "../lib/db/invites.server";
import { ensureDefaultProject } from "../lib/db/projects.server";
import { createUser, getUserByUsername, updateUserLastLogin } from "../lib/db/users.server";
import { ensureUserModelLimits } from "../lib/db/user-model-limits.server";
import { PROVIDER_MODELS } from "../lib/llm/types";

type ActionData = { ok?: boolean; error?: string; intent?: string };

export async function loader({ request, context }: Route.LoaderArgs) {
	if (await getCurrentUser(request, context.db)) {
		const url = new URL(request.url);
		const redirectTo = safeRedirect(url.searchParams.get("redirect"), "/conversations");
		return redirect(redirectTo);
	}

	return {};
}

export async function action({ request, context }: Route.ActionArgs) {
	const formData = await request.formData();
	const intent = (formData.get("intent") as string | null) || "login";
	const username = (formData.get("username") as string | null)?.trim() || "";
	const password = (formData.get("password") as string | null)?.trim() || "";
	const inviteCode = (formData.get("inviteCode") as string | null)?.trim() || "";
	const redirectTo = safeRedirect(
		formData.get("redirectTo")?.toString() ?? null,
		"/conversations",
	);

	if (intent === "register") {
		if (!inviteCode) {
			return Response.json({ ok: false, error: "请输入邀请码。", intent }, { status: 400 });
		}
		if (!username || !password) {
			return Response.json(
				{ ok: false, error: "请输入用户名和密码。", intent },
				{ status: 400 },
			);
		}

		const existing = await getUserByUsername(context.db, username);
		if (existing) {
			return Response.json({ ok: false, error: "用户名已存在。", intent }, { status: 400 });
		}

		const invite = await getInviteCode(context.db, inviteCode);
		if (!invite) {
			return Response.json({ ok: false, error: "邀请码无效。", intent }, { status: 400 });
		}
		if (invite.usedBy) {
			return Response.json({ ok: false, error: "邀请码已被使用。", intent }, { status: 400 });
		}
		if (invite.expiresAt <= Date.now()) {
			return Response.json({ ok: false, error: "邀请码已过期。", intent }, { status: 400 });
		}

		const passwordHash = await hashPassword(password);
		const user = await createUser(context.db, {
			username,
			passwordHash,
			role: "user",
		});

		const marked = await markInviteUsed(context.db, inviteCode, user.id);
		if (!marked) {
			return Response.json(
				{ ok: false, error: "邀请码已被使用，请刷新后重试。", intent },
				{ status: 400 },
			);
		}

		await ensureDefaultProject(context.db, user.id);

		for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
			for (const model of models) {
				await ensureUserModelLimits(context.db, {
					userId: user.id,
					provider,
					model,
					enabled: true,
				});
			}
		}

		const { sessionId } = await createAuthSession(context.db, user.id);
		return redirect(redirectTo, {
			headers: {
				"Set-Cookie": buildAuthSessionCookie(sessionId, request),
			},
		});
	}

	const expected = (context.cloudflare.env.AUTH_PASSWORD || "").trim();
	const adminUsername =
		context.cloudflare.env.ADMIN_USERNAME?.trim() || "admin";

	if (!password) {
		return Response.json({ ok: false, error: "请输入密码。", intent }, { status: 400 });
	}

	if (!username && expected && password === expected) {
		const admin = await getUserByUsername(context.db, adminUsername);
		if (!admin) {
			return Response.json(
				{ ok: false, error: "管理员账号未初始化，请检查环境变量。", intent },
				{ status: 500 },
			);
		}
		const { sessionId } = await createAuthSession(context.db, admin.id);
		await updateUserLastLogin(context.db, admin.id);
		return redirect(redirectTo, {
			headers: {
				"Set-Cookie": buildAuthSessionCookie(sessionId, request),
			},
		});
	}

	if (!username) {
		return Response.json({ ok: false, error: "请输入用户名。", intent }, { status: 400 });
	}

	const user = await getUserByUsername(context.db, username);
	if (!user) {
		return Response.json({ ok: false, error: "用户名或密码错误。", intent }, { status: 400 });
	}

	const ok = await verifyPassword(password, user.passwordHash);
	if (!ok) {
		return Response.json({ ok: false, error: "用户名或密码错误。", intent }, { status: 400 });
	}

	const { sessionId } = await createAuthSession(context.db, user.id);
	await updateUserLastLogin(context.db, user.id);

	return redirect(redirectTo, {
		headers: {
			"Set-Cookie": buildAuthSessionCookie(sessionId, request),
		},
	});
}

export default function LoginPage() {
	const [searchParams] = useSearchParams();
	const actionData = useActionData<ActionData>();
	const navigation = useNavigation();
	const redirectTo = searchParams.get("redirect") || "/conversations";
	const submitting = navigation.state === "submitting";

	return (
		<div className="min-h-screen bg-gradient-to-br from-neutral-50 via-white to-brand-50 dark:from-neutral-950 dark:via-neutral-900 dark:to-brand-950 flex items-center justify-center px-4">
			<div className="w-full max-w-2xl rounded-3xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/80 backdrop-blur-xl shadow-2xl p-8 space-y-6">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
						账号登录
					</h1>
					<p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2">
						使用用户名 + 密码登录，或使用管理员邀请码注册新账号。
					</p>
				</div>

				<div className="grid gap-6 md:grid-cols-2">
					<Form method="post" className="space-y-4">
						<input type="hidden" name="redirectTo" value={redirectTo} />
						<input type="hidden" name="intent" value="login" />
						<label className="block text-sm text-neutral-600 dark:text-neutral-300">
							<span className="block mb-2">用户名</span>
							<input
								type="text"
								name="username"
								autoComplete="username"
								placeholder="admin"
								className="w-full rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/60 px-4 py-4 text-neutral-900 dark:text-neutral-100 shadow-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/40 transition-all duration-200"
							/>
						</label>
						<label className="block text-sm text-neutral-600 dark:text-neutral-300">
							<span className="block mb-2">密码</span>
							<input
								type="password"
								name="password"
								autoComplete="current-password"
								required
								className="w-full rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/60 px-4 py-4 text-neutral-900 dark:text-neutral-100 shadow-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/40 transition-all duration-200"
							/>
						</label>
						<p className="text-xs text-neutral-500 dark:text-neutral-400">
							如需临时后门登录，可仅填写密码（需配置 AUTH_PASSWORD）。
						</p>

						{actionData?.error && actionData.intent !== "register" && (
							<div className="rounded-2xl border border-rose-200/80 dark:border-rose-900/70 bg-rose-50/80 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 p-4 text-sm shadow-sm">
								{actionData.error}
							</div>
						)}

						<button
							type="submit"
							disabled={submitting}
							className="w-full rounded-xl bg-brand-600 text-white px-4 py-4 text-sm font-semibold shadow-sm shadow-brand-600/30 hover:bg-brand-500 hover:shadow-brand-500/40 transition-all duration-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950 disabled:opacity-60"
						>
							{submitting ? "登录中..." : "进入"}
						</button>
					</Form>

					<Form method="post" className="space-y-4">
						<input type="hidden" name="redirectTo" value={redirectTo} />
						<input type="hidden" name="intent" value="register" />
						<label className="block text-sm text-neutral-600 dark:text-neutral-300">
							<span className="block mb-2">邀请码</span>
							<input
								type="text"
								name="inviteCode"
								autoComplete="one-time-code"
								required
								className="w-full rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/60 px-4 py-4 text-neutral-900 dark:text-neutral-100 shadow-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/40 transition-all duration-200"
							/>
						</label>
						<label className="block text-sm text-neutral-600 dark:text-neutral-300">
							<span className="block mb-2">用户名</span>
							<input
								type="text"
								name="username"
								autoComplete="username"
								required
								className="w-full rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/60 px-4 py-4 text-neutral-900 dark:text-neutral-100 shadow-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/40 transition-all duration-200"
							/>
						</label>
						<label className="block text-sm text-neutral-600 dark:text-neutral-300">
							<span className="block mb-2">密码</span>
							<input
								type="password"
								name="password"
								autoComplete="new-password"
								required
								className="w-full rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white/70 dark:bg-neutral-900/60 px-4 py-4 text-neutral-900 dark:text-neutral-100 shadow-sm focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-400/40 transition-all duration-200"
							/>
						</label>

						{actionData?.error && actionData.intent === "register" && (
							<div className="rounded-2xl border border-rose-200/80 dark:border-rose-900/70 bg-rose-50/80 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 p-4 text-sm shadow-sm">
								{actionData.error}
							</div>
						)}

						<button
							type="submit"
							disabled={submitting}
							className="w-full rounded-xl border border-brand-500/60 text-brand-700 dark:text-brand-200 px-4 py-4 text-sm font-semibold shadow-sm hover:bg-brand-50/80 dark:hover:bg-brand-900/30 transition-all duration-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-brand-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-50 dark:focus-visible:ring-offset-neutral-950 disabled:opacity-60"
						>
							{submitting ? "注册中..." : "邀请码注册"}
						</button>
					</Form>
				</div>
			</div>
		</div>
	);
}

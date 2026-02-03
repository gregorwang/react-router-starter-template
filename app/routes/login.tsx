import type { Route } from "./+types/login";
import { Form, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import {
	buildAuthSessionCookie,
	createAuthSession,
	isAuthenticatedWithDb,
	safeRedirect,
} from "../lib/auth.server";

type ActionData = { ok?: boolean; error?: string };

export async function loader({ request, context }: Route.LoaderArgs) {
	if (await isAuthenticatedWithDb(request, context.db)) {
		const url = new URL(request.url);
		const redirectTo = safeRedirect(url.searchParams.get("redirect"), "/conversations");
		return redirect(redirectTo);
	}

	return {};
}

export async function action({ request, context }: Route.ActionArgs) {
	const formData = await request.formData();
	const password = formData.get("password");
	const redirectTo = safeRedirect(
		formData.get("redirectTo")?.toString() ?? null,
		"/conversations",
	);

	const expected = context.cloudflare.env.AUTH_PASSWORD;
	if (!expected) {
		return Response.json(
			{ ok: false, error: "未配置 AUTH_PASSWORD，请在环境变量中设置。" },
			{ status: 500 },
		);
	}

	if (typeof password !== "string" || password.trim() !== expected) {
		return Response.json({ ok: false, error: "密码错误，请重试。" }, { status: 400 });
	}

	const { sessionId } = await createAuthSession(context.db);

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
			<div className="w-full max-w-md rounded-3xl border border-white/60 dark:border-neutral-800/70 bg-white/70 dark:bg-neutral-900/80 backdrop-blur-xl shadow-2xl p-8 space-y-6">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
						密码登录
					</h1>
					<p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2">
						请输入访问密码以进入主页。
					</p>
				</div>

				<Form method="post" className="space-y-4">
					<input type="hidden" name="redirectTo" value={redirectTo} />
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

					{actionData?.error && (
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
			</div>
		</div>
	);
}

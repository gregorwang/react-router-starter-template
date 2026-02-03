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
		<div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
			<div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-6 space-y-6">
				<div>
					<h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
						密码登录
					</h1>
					<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
						请输入访问密码以进入主页。
					</p>
				</div>

				<Form method="post" className="space-y-4">
					<input type="hidden" name="redirectTo" value={redirectTo} />
					<label className="block text-sm text-gray-600 dark:text-gray-300">
						<span className="block mb-2">密码</span>
						<input
							type="password"
							name="password"
							autoComplete="current-password"
							required
							className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
						/>
					</label>

					{actionData?.error && (
						<div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 p-3 text-sm">
							{actionData.error}
						</div>
					)}

					<button
						type="submit"
						disabled={submitting}
						className="w-full rounded-lg bg-orange-500 text-white px-3 py-2 text-sm font-medium hover:bg-orange-600 disabled:opacity-60"
					>
						{submitting ? "登录中..." : "进入"}
					</button>
				</Form>
			</div>
		</div>
	);
}

export async function resolveActorKey(request: Request) {
	const ip =
		request.headers.get("CF-Connecting-IP") ||
		request.headers
			.get("X-Forwarded-For")
			?.split(",")[0]
			?.trim() ||
		"unknown";
	return `ip:${ip}`;
}

export async function enforceRateLimit(
	env: Env,
	key: string,
): Promise<{ allowed: boolean; resetAt?: number }> {
	if (import.meta.env.DEV) {
		return { allowed: true };
	}

	let allowed = true;
	let resetAt: number | undefined;

	if (env.CHAT_RATE_LIMITER) {
		try {
			const decision = await env.CHAT_RATE_LIMITER.limit({ key });
			if (decision && decision.success === false) {
				allowed = false;
			}
		} catch {
			// Ignore rate limiter errors and fall back to DO.
		}
	}

	if (allowed && env.CHAT_RATE_LIMITER_DO) {
		const id = env.CHAT_RATE_LIMITER_DO.idFromName(key);
		const stub = env.CHAT_RATE_LIMITER_DO.get(id);
		const response = await stub.fetch("https://rate-limiter/limit", {
			method: "POST",
			body: JSON.stringify({ limit: 20, windowMs: 3_600_000 }),
		});
		if (response.ok) {
			const data = (await response.json()) as {
				allowed: boolean;
				resetAt?: number;
			};
			allowed = data.allowed;
			resetAt = data.resetAt ?? resetAt;
		}
	}

	return { allowed, resetAt };
}

import { createRequestHandler } from "react-router";
import { initDatabase } from "../app/lib/db/conversations.server";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
		db: D1Database;
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

let dbInitPromise: Promise<void> | null = null;
const MANIFEST_CACHE_CONTROL = "public, max-age=31536000, immutable";

function setD1LogFlag(env: Env) {
	const raw = String(env.D1_LOG || "")
		.trim()
		.toLowerCase();
	const enabled = raw === "1" || raw === "true" || raw === "yes" || raw === "on";
	(globalThis as { __D1_LOG__?: boolean }).__D1_LOG__ = enabled;
}

async function ensureDatabase(env: Env) {
	if (!dbInitPromise) {
		dbInitPromise = initDatabase(env.DB, env);
	}
	return dbInitPromise;
}

export default {
	async fetch(request, env, ctx) {
		setD1LogFlag(env);
		await ensureDatabase(env);
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/__manifest") {
			const cacheStorage = caches as CacheStorage & { default?: Cache };
			const cache = cacheStorage.default ?? (await cacheStorage.open("manifest"));
			const cacheKey = new Request(request.url, { method: "GET" });
			const cached = await cache.match(cacheKey);
			if (cached) {
				return cached;
			}

			const response = await requestHandler(request, {
				cloudflare: { env, ctx },
				db: env.DB,
			});

			if (response.ok) {
				const cacheable = new Response(response.body, response);
				cacheable.headers.set("Cache-Control", MANIFEST_CACHE_CONTROL);
				ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
				return cacheable;
			}

			return response;
		}

		return requestHandler(request, {
			cloudflare: { env, ctx },
			db: env.DB,
		});
	},
} satisfies ExportedHandler<Env>;

export class ChatRateLimiter {
	private state: DurableObjectState;

	constructor(state: DurableObjectState) {
		this.state = state;
	}

	async fetch(request: Request): Promise<Response> {
		if (request.method !== "POST") {
			return new Response("Method not allowed", { status: 405 });
		}

		const payload = (await request.json()) as {
			limit?: number;
			windowMs?: number;
			now?: number;
		};

		const limit = Math.max(1, payload.limit ?? 20);
		const windowMs = Math.max(60_000, payload.windowMs ?? 3_600_000);
		const now = payload.now ?? Date.now();
		const bucket = Math.floor(now / windowMs);

		let count = 0;
		let storedBucket = bucket;
		let allowed = false;

		await this.state.blockConcurrencyWhile(async () => {
			const stored = (await this.state.storage.get("state")) as
				| { bucket: number; count: number }
				| undefined;

			if (!stored || stored.bucket !== bucket) {
				storedBucket = bucket;
				count = 0;
			} else {
				storedBucket = stored.bucket;
				count = stored.count;
			}

			if (count < limit) {
				count += 1;
				allowed = true;
				await this.state.storage.put("state", { bucket: storedBucket, count });
			}
		});

		const remaining = Math.max(0, limit - count);
		const resetAt = (storedBucket + 1) * windowMs;

		return new Response(
			JSON.stringify({
				allowed,
				limit,
				remaining,
				resetAt,
			}),
			{ headers: { "Content-Type": "application/json" } },
		);
	}
}

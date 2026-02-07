import { createRequestHandler } from "react-router";
import { initDatabase } from "../app/lib/db/conversations.server";
import {
	bootstrapStateToPersistedState,
	mergeConversationSessionState,
	sanitizeConversationSessionPatch,
	type ConversationSessionBootstrap,
	type ConversationSessionPatch,
	type ConversationSessionState,
} from "../app/lib/services/chat-session-state.shared";

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
let dbInitLastFailureAt = 0;
const MANIFEST_CACHE_CONTROL = "public, max-age=31536000, immutable";
const DB_INIT_RETRY_COOLDOWN_MS = 5_000;

function setD1LogFlag(env: Env) {
	const raw = String(env.D1_LOG || "")
		.trim()
		.toLowerCase();
	const enabled = raw === "1" || raw === "true" || raw === "yes" || raw === "on";
	(globalThis as { __D1_LOG__?: boolean }).__D1_LOG__ = enabled;
}

async function ensureDatabase(env: Env) {
	const now = Date.now();
	if (
		dbInitLastFailureAt > 0 &&
		now - dbInitLastFailureAt < DB_INIT_RETRY_COOLDOWN_MS
	) {
		throw new Error("Database initialization temporarily unavailable");
	}

	if (!dbInitPromise) {
		const allowRuntimeMigrations = readBooleanEnv(
			env,
			"DB_RUNTIME_MIGRATIONS",
			import.meta.env.DEV,
		);
		const allowAdminBootstrap = readBooleanEnv(
			env,
			"DB_RUNTIME_ADMIN_BOOTSTRAP",
			import.meta.env.DEV,
		);
		dbInitPromise = initDatabase(env.DB, env, {
			allowRuntimeMigrations,
			allowAdminBootstrap,
		});
	}

	try {
		await dbInitPromise;
		dbInitLastFailureAt = 0;
	} catch (error) {
		dbInitPromise = null;
		dbInitLastFailureAt = Date.now();
		throw error;
	}
}

export default {
	async fetch(request, env, ctx) {
		setD1LogFlag(env);
		try {
			await ensureDatabase(env);
		} catch (error) {
			console.error("[db-init] failed", error);
			return new Response("Service unavailable", {
				status: 503,
				headers: { "Cache-Control": "no-store" },
			});
		}
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

function readBooleanEnv(env: Env, key: string, defaultValue = false): boolean {
	const raw = (env as unknown as Record<string, unknown>)[key];
	if (typeof raw !== "string") return defaultValue;
	const normalized = raw.trim().toLowerCase();
	if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
		return true;
	}
	if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
		return false;
	}
	return defaultValue;
}

export class ChatRateLimiter {
	private state: DurableObjectState;

	constructor(state: DurableObjectState) {
		this.state = state;
	}

	async fetch(request: Request): Promise<Response> {
		if (request.method !== "POST") {
			return new Response("Method not allowed", { status: 405 });
		}

		let payload: { limit?: number; windowMs?: number; now?: number } = {};
		try {
			const parsed = (await request.json()) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				payload = parsed as { limit?: number; windowMs?: number; now?: number };
			}
		} catch {
			return new Response(
				JSON.stringify({ error: "Invalid JSON payload" }),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		const limitInput = payload.limit;
		const windowMsInput = payload.windowMs;
		const nowInput = payload.now;
		const limit = Math.max(1, Number.isFinite(limitInput) ? Number(limitInput) : 20);
		const windowMs = Math.max(
			60_000,
			Number.isFinite(windowMsInput) ? Number(windowMsInput) : 3_600_000,
		);
		const now = Number.isFinite(nowInput) ? Number(nowInput) : Date.now();
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

type ChatSessionDORequest =
	| {
			op: "get_or_bootstrap";
			userId: string;
			bootstrap: ConversationSessionBootstrap;
	  }
	| {
			op: "patch";
			userId: string;
			bootstrap: ConversationSessionBootstrap;
			patch: ConversationSessionPatch;
	  };

const CHAT_SESSION_STORAGE_KEY = "state";

export class ChatSessionState {
	private state: DurableObjectState;
	private cachedState: ConversationSessionState | null | undefined;

	constructor(state: DurableObjectState) {
		this.state = state;
		this.cachedState = undefined;
	}

	private async readState() {
		if (this.cachedState !== undefined) {
			return this.cachedState;
		}
		const stored = (await this.state.storage.get(CHAT_SESSION_STORAGE_KEY)) as
			| ConversationSessionState
			| undefined;
		this.cachedState = stored ?? null;
		return this.cachedState;
	}

	private async writeState(next: ConversationSessionState) {
		await this.state.storage.put(CHAT_SESSION_STORAGE_KEY, next);
		this.cachedState = next;
		return next;
	}

	private ensureBootstrapState(bootstrap: ConversationSessionBootstrap) {
		return bootstrapStateToPersistedState(bootstrap);
	}

	private buildError(status: number, error: string) {
		return new Response(JSON.stringify({ ok: false, error }), {
			status,
			headers: { "Content-Type": "application/json" },
		});
	}

	private buildOk(state: ConversationSessionState) {
		return new Response(JSON.stringify({ ok: true, state }), {
			headers: { "Content-Type": "application/json" },
		});
	}

	async fetch(request: Request): Promise<Response> {
		if (request.method !== "POST") {
			return new Response("Method not allowed", { status: 405 });
		}

		let payload: ChatSessionDORequest;
		try {
			payload = (await request.json()) as ChatSessionDORequest;
		} catch {
			return this.buildError(400, "Invalid JSON payload");
		}

		if (
			!payload ||
			typeof payload !== "object" ||
			!payload.op ||
			typeof payload.userId !== "string" ||
			!payload.userId.trim() ||
			!payload.bootstrap ||
			typeof payload.bootstrap !== "object"
		) {
			return this.buildError(400, "Invalid payload");
		}

		const userId = payload.userId.trim();
		const bootstrap = payload.bootstrap;
		if (
			typeof bootstrap.conversationId !== "string" ||
			!bootstrap.conversationId.trim() ||
			typeof bootstrap.userId !== "string" ||
			bootstrap.userId.trim() !== userId
		) {
			return this.buildError(400, "Invalid bootstrap state");
		}

		return this.state.blockConcurrencyWhile(async () => {
			const current = await this.readState();
			const base = current ?? this.ensureBootstrapState(bootstrap);

			if (base.userId !== userId) {
				return this.buildError(403, "Conversation state belongs to another user");
			}

			if (payload.op === "get_or_bootstrap") {
				if (!current) {
					await this.writeState(base);
				}
				return this.buildOk(base);
			}

			if (payload.op !== "patch") {
				return this.buildError(400, "Unsupported operation");
			}

			const patch = sanitizeConversationSessionPatch(payload.patch || {});
			const next = mergeConversationSessionState(base, patch, Date.now());
			if (next.version === base.version) {
				if (!current) {
					await this.writeState(base);
				}
				return this.buildOk(base);
			}

			await this.writeState(next);
			return this.buildOk(next);
		});
	}
}

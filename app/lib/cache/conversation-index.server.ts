import type { Conversation } from "../llm/types";
import { getConversationIndex, getConversations } from "../db/conversations.server";

type CachePayload<T> = {
	cachedAt: number;
	data: T;
};

type CacheContext = {
	waitUntil?: (promise: Promise<unknown>) => void;
};

const INDEX_CACHE_PREFIX = "conversations:index:v1";
const LIST_CACHE_PREFIX = "conversations:list:v1";
const DEFAULT_TTL_MS = 30_000;
const DEFAULT_STALE_MS = 5 * 60_000;

function cacheKey(prefix: string, userId: string, projectId?: string) {
	return `${prefix}:${userId}:${projectId || "default"}`;
}

async function readCache<T>(kv: KVNamespace, key: string) {
	const cached = (await kv.get(key, { type: "json" })) as CachePayload<T> | null;
	if (!cached || typeof cached !== "object") return null;
	if (typeof cached.cachedAt !== "number") return null;
	return cached;
}

async function writeCache<T>(
	kv: KVNamespace,
	key: string,
	data: T,
	staleMs: number,
) {
	const payload: CachePayload<T> = {
		cachedAt: Date.now(),
		data,
	};
	await kv.put(key, JSON.stringify(payload), {
		expirationTtl: Math.ceil(staleMs / 1000),
	});
}

async function getCached<T>({
	kv,
	ctx,
	key,
	ttlMs,
	staleMs,
	fetcher,
}: {
	kv?: KVNamespace;
	ctx?: CacheContext;
	key: string;
	ttlMs: number;
	staleMs: number;
	fetcher: () => Promise<T>;
}): Promise<T> {
	if (!kv) {
		return fetcher();
	}

	const cached = await readCache<T>(kv, key);
	const now = Date.now();

	if (cached && now - cached.cachedAt < ttlMs) {
		return cached.data;
	}

	const refresh = async () => {
		const data = await fetcher();
		await writeCache(kv, key, data, staleMs);
		return data;
	};

	if (cached && now - cached.cachedAt < staleMs) {
		if (ctx?.waitUntil) {
			ctx.waitUntil(refresh());
		} else {
			void refresh();
		}
		return cached.data;
	}

	return refresh();
}

export async function getConversationIndexCached({
	db,
	kv,
	ctx,
	userId,
	projectId,
	ttlMs = DEFAULT_TTL_MS,
	staleMs = DEFAULT_STALE_MS,
}: {
	db: D1Database;
	kv?: KVNamespace;
	ctx?: CacheContext;
	userId: string;
	projectId?: string;
	ttlMs?: number;
	staleMs?: number;
}): Promise<Conversation[]> {
	return getCached({
		kv,
		ctx,
		key: cacheKey(INDEX_CACHE_PREFIX, userId, projectId),
		ttlMs,
		staleMs,
		fetcher: () => getConversationIndex(db, userId, projectId),
	});
}

export async function getConversationsCached({
	db,
	kv,
	ctx,
	userId,
	projectId,
	ttlMs = DEFAULT_TTL_MS,
	staleMs = DEFAULT_STALE_MS,
}: {
	db: D1Database;
	kv?: KVNamespace;
	ctx?: CacheContext;
	userId: string;
	projectId?: string;
	ttlMs?: number;
	staleMs?: number;
}): Promise<Conversation[]> {
	return getCached({
		kv,
		ctx,
		key: cacheKey(LIST_CACHE_PREFIX, userId, projectId),
		ttlMs,
		staleMs,
		fetcher: () => getConversations(db, userId, projectId),
	});
}

export async function invalidateConversationCaches(
	kv: KVNamespace | undefined,
	userId: string,
	projectId?: string,
) {
	if (!kv) return;
	const indexKey = cacheKey(INDEX_CACHE_PREFIX, userId, projectId);
	const listKey = cacheKey(LIST_CACHE_PREFIX, userId, projectId);
	await Promise.all([kv.delete(indexKey), kv.delete(listKey)]);
}

import { getUsageStats, type UsageStats } from "../db/usage.server";

type CachePayload<T> = {
	cachedAt: number;
	data: T;
};

type CacheContext = {
	waitUntil?: (promise: Promise<unknown>) => void;
};

const USAGE_CACHE_PREFIX = "usage:stats:v1";
const USAGE_CACHE_VERSION_PREFIX = "usage:stats:version:v1";
const DEFAULT_TTL_MS = 60_000;
const DEFAULT_STALE_MS = 5 * 60_000;
const DEFAULT_BUCKET_MS = 60_000;

function usageVersionKey(userId: string) {
	return `${USAGE_CACHE_VERSION_PREFIX}:${userId}`;
}

function usageDataKey(options: {
	version: string;
	userId: string;
	projectId?: string;
	startMs: number;
	endMs: number;
	bucketMs: number;
}) {
	const projectPart = options.projectId || "all";
	const startBucket = Math.floor(options.startMs / options.bucketMs);
	const endBucket = Math.floor(options.endMs / options.bucketMs);
	return `${USAGE_CACHE_PREFIX}:${options.userId}:${projectPart}:${startBucket}:${endBucket}:${options.version}`;
}

async function readUsageCache<T>(kv: KVNamespace, key: string) {
	const cached = (await kv.get(key, { type: "json" })) as CachePayload<T> | null;
	if (!cached || typeof cached !== "object") return null;
	if (typeof cached.cachedAt !== "number") return null;
	return cached;
}

async function writeUsageCache<T>(
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

async function getUsageCacheVersion(kv: KVNamespace, userId: string) {
	return (await kv.get(usageVersionKey(userId))) || "0";
}

export async function getUsageStatsCached(options: {
	db: D1Database;
	kv?: KVNamespace;
	ctx?: CacheContext;
	userId: string;
	startMs: number;
	endMs: number;
	projectId?: string;
	ttlMs?: number;
	staleMs?: number;
	bucketMs?: number;
}): Promise<UsageStats> {
	const {
		db,
		kv,
		ctx,
		userId,
		startMs,
		endMs,
		projectId,
		ttlMs = DEFAULT_TTL_MS,
		staleMs = DEFAULT_STALE_MS,
		bucketMs = DEFAULT_BUCKET_MS,
	} = options;

	if (!kv) {
		return getUsageStats(db, { userId, startMs, endMs, projectId });
	}

	const version = await getUsageCacheVersion(kv, userId);
	const key = usageDataKey({
		version,
		userId,
		projectId,
		startMs,
		endMs,
		bucketMs,
	});
	const cached = await readUsageCache<UsageStats>(kv, key);
	const now = Date.now();

	const refresh = async () => {
		const data = await getUsageStats(db, { userId, startMs, endMs, projectId });
		await writeUsageCache(kv, key, data, staleMs);
		return data;
	};

	if (cached && now - cached.cachedAt < ttlMs) {
		return cached.data;
	}

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

export async function invalidateUsageStatsCache(
	kv: KVNamespace | undefined,
	userId: string,
) {
	if (!kv) return;
	await kv.put(usageVersionKey(userId), String(Date.now()));
}


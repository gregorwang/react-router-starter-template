/**
 * Memory API — CRUD for structured memory items (L2 layer).
 *
 * GET    → list active memory items
 * POST   → create a new memory item
 * PUT    → update an existing memory item
 * DELETE → delete a memory item
 */

import type { Route } from "./+types/memory";
import { requireAuth } from "../lib/auth.server";
import {
	getMemoryItems,
	createMemoryItem,
	updateMemoryItem,
	deleteMemoryItem,
	type MemoryCategory,
} from "../lib/db/memory-items.server";

const VALID_CATEGORIES: MemoryCategory[] = [
	"preference",
	"constraint",
	"fact",
	"decision",
	"todo",
	"custom",
];

function json(data: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const user = await requireAuth(request, context.db);
	const url = new URL(request.url);
	const category = url.searchParams.get("category") as MemoryCategory | null;
	const includeInactive = url.searchParams.get("includeInactive") === "true";

	const items = await getMemoryItems(context.db, user.id, {
		category: category && VALID_CATEGORIES.includes(category) ? category : undefined,
		includeInactive,
		limit: 100,
	});

	return json({ items });
}

export async function action({ request, context }: Route.ActionArgs) {
	const user = await requireAuth(request, context.db);
	const db = context.db;
	const method = request.method.toUpperCase();

	// Parse JSON body for mutation methods
	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return json({ error: "无效的 JSON" }, { status: 400 });
	}

	// ── POST: Create memory item ───────────────────────────────────
	if (method === "POST") {
		const content = typeof body.content === "string" ? body.content.trim() : "";
		const category = VALID_CATEGORIES.includes(body.category as MemoryCategory)
			? (body.category as MemoryCategory)
			: "fact";
		const importance = typeof body.importance === "number"
			? Math.max(1, Math.min(10, body.importance))
			: 5;

		if (!content) {
			return json({ error: "内容不能为空" }, { status: 400 });
		}

		const id = crypto.randomUUID();
		await createMemoryItem(db, {
			id,
			userId: user.id,
			conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
			category,
			content,
			source: "manual",
			importance,
			isActive: true,
			expiresAt: typeof body.expiresAt === "number" ? body.expiresAt : undefined,
		});

		return json({ id, success: true }, { status: 201 });
	}

	// ── PUT: Update memory item ────────────────────────────────────
	if (method === "PUT") {
		const id = typeof body.id === "string" ? body.id.trim() : "";
		if (!id) {
			return json({ error: "缺少 id" }, { status: 400 });
		}

		const updates: Parameters<typeof updateMemoryItem>[3] = {};
		if (typeof body.content === "string") updates.content = body.content.trim();
		if (VALID_CATEGORIES.includes(body.category as MemoryCategory)) {
			updates.category = body.category as MemoryCategory;
		}
		if (typeof body.importance === "number") {
			updates.importance = Math.max(1, Math.min(10, body.importance));
		}
		if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
		if (body.expiresAt === null || typeof body.expiresAt === "number") {
			updates.expiresAt = body.expiresAt;
		}

		const updated = await updateMemoryItem(db, user.id, id, updates);
		if (!updated) {
			return json({ error: "记忆项未找到" }, { status: 404 });
		}

		return json({ success: true });
	}

	// ── DELETE: Delete memory item ─────────────────────────────────
	if (method === "DELETE") {
		const id = typeof body.id === "string" ? body.id.trim() : "";
		if (!id) {
			return json({ error: "缺少 id" }, { status: 400 });
		}

		const deleted = await deleteMemoryItem(db, user.id, id);
		if (!deleted) {
			return json({ error: "记忆项未找到" }, { status: 404 });
		}

		return json({ success: true });
	}

	return json({ error: "不支持的方法" }, { status: 405 });
}

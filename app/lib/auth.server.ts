import { redirect } from "react-router";
import {
	createSession,
	deleteExpiredSessions,
	deleteSession,
	getSession,
} from "./db/sessions.server";
import { getUserById } from "./db/users.server";
import type { User } from "./llm/types";

const AUTH_COOKIE_NAME = "rr_auth";
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

type CookieMap = Record<string, string>;

function parseCookies(header: string | null): CookieMap {
	const cookies: CookieMap = {};
	if (!header) return cookies;

	for (const part of header.split(";")) {
		const [rawName, ...valueParts] = part.trim().split("=");
		if (!rawName) continue;
		cookies[rawName] = decodeURIComponent(valueParts.join("="));
	}

	return cookies;
}

function buildCookieBase(request: Request) {
	const secure = new URL(request.url).protocol === "https:";
	const parts = ["Path=/", "HttpOnly", "SameSite=Lax"];
	if (secure) parts.push("Secure");
	return parts;
}

export async function requireAuth(
	request: Request,
	db: D1Database,
): Promise<User> {
	const user = await getCurrentUser(request, db);
	if (user) return user;
	const url = new URL(request.url);
	const redirectTo = `${url.pathname}${url.search}`;
	throw redirect(`/login?redirect=${encodeURIComponent(redirectTo)}`);
}

export function safeRedirect(target: string | null, fallback = "/") {
	if (!target) return fallback;
	if (target.startsWith("/") && !target.startsWith("//")) return target;
	return fallback;
}

export function buildAuthSessionCookie(sessionId: string, request: Request) {
	const parts = [
		`${AUTH_COOKIE_NAME}=${sessionId}`,
		`Max-Age=${AUTH_COOKIE_MAX_AGE}`,
		...buildCookieBase(request),
	];
	return parts.join("; ");
}

export function buildLogoutCookie(request: Request) {
	const parts = [
		`${AUTH_COOKIE_NAME}=`,
		"Max-Age=0",
		...buildCookieBase(request),
	];
	return parts.join("; ");
}

export function getSessionId(request: Request): string | null {
	const cookies = parseCookies(request.headers.get("cookie"));
	return cookies[AUTH_COOKIE_NAME] || null;
}

export async function isAuthenticatedWithDb(
	request: Request,
	db: D1Database,
): Promise<boolean> {
	const user = await getCurrentUser(request, db);
	return Boolean(user);
}

export async function createAuthSession(
	db: D1Database,
	userId: string,
): Promise<{ sessionId: string }> {
	await deleteExpiredSessions(db);
	const session = await createSession(db, userId, AUTH_COOKIE_MAX_AGE * 1000);
	return { sessionId: session.id };
}

export async function destroySession(request: Request, db: D1Database) {
	const sessionId = getSessionId(request);
	if (sessionId) {
		await deleteSession(db, sessionId);
	}
}

export async function getCurrentUser(
	request: Request,
	db: D1Database,
): Promise<User | null> {
	const sessionId = getSessionId(request);
	if (!sessionId) return null;
	const session = await getSession(db, sessionId);
	if (!session) return null;
	if (session.expiresAt <= Date.now()) {
		await deleteSession(db, sessionId);
		return null;
	}
	const user = await getUserById(db, session.userId);
	return user ?? null;
}

export async function requireAdmin(
	request: Request,
	db: D1Database,
): Promise<User> {
	const user = await requireAuth(request, db);
	if (user.role !== "admin") {
		throw new Response("Forbidden", { status: 403 });
	}
	return user;
}

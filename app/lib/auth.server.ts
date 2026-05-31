import type { User } from "./llm/types";

const LOCAL_USER: User = {
	id: "local-user",
	username: "local",
	role: "admin",
	createdAt: 0,
	updatedAt: 0,
};

export async function requireAuth(
	_request: Request,
	_db: D1Database,
): Promise<User> {
	return LOCAL_USER;
}

export async function getCurrentUser(
	_request: Request,
	_db: D1Database,
): Promise<User> {
	return LOCAL_USER;
}

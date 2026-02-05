import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/index.tsx"),
	route("login", "routes/login.tsx"),
	route("logout", "routes/logout.tsx"),

	route("conversations", "routes/conversations.tsx"),
	route("conversations/delete", "routes/conversations.delete.ts"),
	route("conversations/archive", "routes/conversations.archive.ts"),
	route("conversations/compact", "routes/conversations.compact.ts"),
	route("conversations/title", "routes/conversations.title.ts"),
	route("projects/create", "routes/projects.create.ts"),
	route("c/:id", "routes/c_.$id.tsx"),
	route("chat/action", "routes/chat.action.ts"),
	route("media/:key", "routes/media.$key.tsx"),
	route("usage", "routes/usage.tsx"),
	route("admin", "routes/admin.tsx"),
] satisfies RouteConfig;

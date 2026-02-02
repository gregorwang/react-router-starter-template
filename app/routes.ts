import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/index.tsx"),

	route("conversations", "routes/conversations.tsx"),
	route("conversations/delete", "routes/conversations.delete.ts"),
	route("conversations/backup", "routes/conversations.archive.ts"),
	route("projects/create", "routes/projects.create.ts"),
	route("c/:id", "routes/c_.$id.tsx"),
	route("chat/action", "routes/chat.action.ts"),
	route("usage", "routes/usage.tsx"),
] satisfies RouteConfig;

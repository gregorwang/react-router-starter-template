import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/index.tsx"),

	route("conversations", "routes/conversations.tsx"),
	route("conversations/delete", "routes/conversations.delete.ts"),
	route("c/:id", "routes/c_.$id.tsx"),
	route("chat/action", "routes/chat.action.ts"),
] satisfies RouteConfig;

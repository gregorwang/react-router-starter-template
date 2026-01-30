import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/index.tsx"),
	route("settings", "routes/settings.tsx"),
	route("conversations", "routes/conversations.tsx"),
	route("c/:id", "routes/c_.$id.tsx"),
] satisfies RouteConfig;

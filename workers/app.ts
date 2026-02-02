import { createRequestHandler } from "react-router";

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

export default {
	async fetch(request, env, ctx) {
		// Database initialization is now handled via wrangler CLI migrations
		// Run: wrangler d1 execute DB --file=./app/lib/db/schema.sql
		return requestHandler(request, {
			cloudflare: { env, ctx },
			db: env.DB,
		});
	},
} satisfies ExportedHandler<Env>;

import { createRequestHandler } from "react-router";
import { initDatabase } from "../app/lib/db/conversations.server";

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
		// Initialize database on first request
		if (env.DB) {
			try {
				await initDatabase(env.DB);
			} catch (error) {
				console.error("Database initialization error:", error);
			}
		}

		return requestHandler(request, {
			cloudflare: { env, ctx },
			db: env.DB,
		});
	},
} satisfies ExportedHandler<Env>;

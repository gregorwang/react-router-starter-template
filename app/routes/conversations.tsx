import type { Route } from "./+types/conversations";
import { Link } from "react-router";
import { format } from "date-fns";
import { getConversations } from "../lib/db/conversations.server";

// Server loader - runs in Cloudflare Worker with D1 database
export async function loader({ context }: Route.LoaderArgs) {
	const conversations = await getConversations(context.db);
	return { conversations };
}

export default function Conversations({ loaderData }: Route.ComponentProps) {
	const { conversations } = loaderData;

	return (
		<div className="max-w-4xl mx-auto py-8 px-4">
			<h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-8">
				All Conversations
			</h1>
			{conversations.length === 0 ? (
				<div className="text-center py-8">
					<p className="text-gray-500 dark:text-gray-400 mb-4">
						No conversations yet. Start a new chat to begin.
					</p>
					<Link
						to="/c/new"
						className="inline-block px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
					>
						Start New Chat
					</Link>
				</div>
			) : (
				<div className="space-y-4">
					{conversations.map((conv) => (
						<Link
							key={conv.id}
							to={`/c/${conv.id}`}
							className="block p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-orange-500 dark:hover:border-orange-500 transition-colors"
						>
							<h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
								{conv.title}
							</h3>
							<p className="text-sm text-gray-500 dark:text-gray-400">
								{conv.messages.length} messages • Last updated{" "}
								{format(new Date(conv.updatedAt), "MMM d, yyyy 'at' h:mm a")}
							</p>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}

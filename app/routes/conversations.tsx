import { useEffect } from "react";
import { useConversations } from "../hooks/useConversations";
import { Link } from "react-router";
import { format } from "date-fns";

export default function Conversations() {
	const { conversations, refresh } = useConversations();

	useEffect(() => {
		refresh();
	}, [refresh]);

	return (
		<div className="max-w-4xl mx-auto py-8 px-4">
			<h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-8">
				All Conversations
			</h1>
			{conversations.length === 0 ? (
				<p className="text-gray-500 dark:text-gray-400">
					No conversations yet. Start a new chat to begin.
				</p>
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

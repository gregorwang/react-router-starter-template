import { format } from "date-fns";
import type { Route } from "./+types/s.$token";
import { MarkdownRenderer } from "../components/chat/MarkdownRenderer";
import { getConversationByShareToken } from "../lib/db/share-links.server";
import type { Attachment } from "../lib/llm/types";

export async function loader({ params, context }: Route.LoaderArgs) {
	const token = params.token?.trim();
	if (!token) {
		throw new Response("Not found", { status: 404 });
	}

	const conversation = await getConversationByShareToken(context.db, token);
	if (!conversation) {
		throw new Response("分享链接不存在或已失效", { status: 404 });
	}

	return { conversation, token };
}

export function headers() {
	return {
		"Cache-Control": "public, max-age=60",
		"X-Robots-Tag": "noindex, nofollow",
	};
}

export default function SharedConversation({ loaderData }: Route.ComponentProps) {
	const { conversation, token } = loaderData;

	return (
		<main className="min-h-[100dvh] bg-neutral-50 dark:bg-neutral-950 px-4 py-8">
			<div className="mx-auto w-full max-w-4xl space-y-4">
				<header className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 px-5 py-4">
					<p className="text-xs uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400">
						只读分享
					</p>
					<h1 className="mt-2 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
						{conversation.title}
					</h1>
					<p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
						最后更新 {format(new Date(conversation.updatedAt), "yyyy-MM-dd HH:mm")}
					</p>
				</header>

				<section className="space-y-3">
					{conversation.messages.length === 0 ? (
						<div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 px-5 py-6 text-sm text-neutral-500 dark:text-neutral-400">
							暂无消息
						</div>
					) : (
						conversation.messages.map((message) => (
							<article
								key={message.id}
								className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white/85 dark:bg-neutral-900/80 px-5 py-4"
							>
								<div className="mb-2 flex items-center justify-between gap-3 text-xs text-neutral-500 dark:text-neutral-400">
									<span>
										{message.role === "user"
											? "用户"
											: message.role === "assistant"
												? "助手"
												: "系统"}
									</span>
									<span>{format(new Date(message.timestamp), "MM-dd HH:mm")}</span>
								</div>
								<MarkdownRenderer content={message.content} />
								<SharedAttachments
									attachments={message.meta?.attachments}
									token={token}
								/>
							</article>
						))
					)}
				</section>
			</div>
		</main>
	);
}

function SharedAttachments({
	attachments,
	token,
}: {
	attachments?: Attachment[];
	token: string;
}) {
	if (!attachments || attachments.length === 0) return null;

	return (
		<div className="mt-3 flex flex-wrap gap-2">
			{attachments.map((attachment) => {
				const src = attachment.data
					? `data:${attachment.mimeType};base64,${attachment.data}`
					: withShareToken(attachment.url, token);
				if (!src) return null;

				if (!attachment.mimeType.startsWith("image/")) {
					return (
						<a
							key={attachment.id}
							href={src}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/80 dark:bg-neutral-900/80 text-xs text-neutral-700 dark:text-neutral-200 hover:border-brand-400/60"
						>
							<span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-200/70 dark:bg-neutral-700/70">
								FILE
							</span>
							<span className="truncate max-w-52">{attachment.name || "附件"}</span>
						</a>
					);
				}

				return (
					<img
						key={attachment.id}
						src={src}
						alt={attachment.name || "上传图片"}
						className="w-28 h-28 rounded-xl object-cover border border-neutral-200 dark:border-neutral-700"
						loading="lazy"
					/>
				);
			})}
		</div>
	);
}

function withShareToken(url: string | undefined, token: string) {
	if (!url) return undefined;
	if (!url.startsWith("/media/")) return url;
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}token=${encodeURIComponent(token)}`;
}

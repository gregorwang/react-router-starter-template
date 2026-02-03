import { Suspense, lazy } from "react";

const MarkdownRendererInner = lazy(() => import("./MarkdownRendererInner"));

export function MarkdownRenderer({ content }: { content: string }) {
	return (
		<Suspense fallback={<p className="whitespace-pre-wrap">{content}</p>}>
			<MarkdownRendererInner content={content} />
		</Suspense>
	);
}

import MarkdownRendererInner from "./MarkdownRendererInner";

export function MarkdownRenderer({ content }: { content: string }) {
	return <MarkdownRendererInner content={content} />;
}

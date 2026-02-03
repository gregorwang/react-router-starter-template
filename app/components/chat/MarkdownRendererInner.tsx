import { useEffect, useState } from "react";
import { parseMarkdown } from "../../lib/utils/markdown";

export default function MarkdownRendererInner({ content }: { content: string }) {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		setHtml(null);
		void parseMarkdown(content).then((value) => {
			if (active) setHtml(value);
		});
		return () => {
			active = false;
		};
	}, [content]);

	if (!html) {
		return <p className="whitespace-pre-wrap">{content}</p>;
	}

	return (
		<div className="prose dark:prose-invert max-w-none">
			<div
				dangerouslySetInnerHTML={{
					__html: html,
				}}
			/>
		</div>
	);
}

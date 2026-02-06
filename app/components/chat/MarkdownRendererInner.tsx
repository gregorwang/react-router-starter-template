import { useEffect, useMemo, useState } from "react";
import {
	parseMarkdown,
	parseMarkdownSync,
	renderPlainTextAsHtml,
} from "../../lib/utils/markdown";

export default function MarkdownRendererInner({ content }: { content: string }) {
	const initialHtml = useMemo(() => {
		return parseMarkdownSync(content) ?? renderPlainTextAsHtml(content);
	}, [content]);
	const [html, setHtml] = useState<string>(initialHtml);

	useEffect(() => {
		let active = true;
		void parseMarkdown(content).then((value) => {
			if (active) setHtml(value);
		});
		return () => {
			active = false;
		};
	}, [content]);

	return (
		<div className="prose dark:prose-invert max-w-none break-words">
			<div
				dangerouslySetInnerHTML={{
					__html: html,
				}}
			/>
		</div>
	);
}

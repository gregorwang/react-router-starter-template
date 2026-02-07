import { useEffect, useMemo, useRef, useState } from "react";
import {
	parseMarkdown,
	parseMarkdownSync,
	renderPlainTextAsHtml,
} from "../../lib/utils/markdown";

export default function MarkdownRendererInner({ content }: { content: string }) {
	const containerRef = useRef<HTMLDivElement>(null);
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

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const onClick = (event: Event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;

			const copyButton = target.closest<HTMLElement>("[data-md-code-copy]");
			if (copyButton && container.contains(copyButton)) {
				event.preventDefault();
				const block = copyButton.closest(".md-code-block");
				const code = block?.querySelector("pre code, code");
				const text = code?.textContent || "";
				if (!text.trim()) return;
				if (!navigator.clipboard?.writeText) return;
				void navigator.clipboard
					.writeText(text)
					.then(() => {
						const original = copyButton.dataset.label || copyButton.textContent || "复制";
						copyButton.dataset.label = original;
						copyButton.textContent = "已复制";
						window.setTimeout(() => {
							copyButton.textContent = copyButton.dataset.label || "复制";
						}, 1200);
					})
					.catch(() => {
						// Ignore copy failures.
					});
				return;
			}

			const toggleButton = target.closest<HTMLElement>("[data-md-code-toggle]");
			if (toggleButton && container.contains(toggleButton)) {
				event.preventDefault();
				const block = toggleButton.closest(".md-code-block");
				const codeContent = block?.querySelector<HTMLElement>(".md-code-content");
				if (!codeContent) return;
				const nextCollapsed = codeContent.classList.toggle("is-collapsed");
				toggleButton.textContent = nextCollapsed ? "展开" : "折叠";
				toggleButton.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
			}
		};

		container.addEventListener("click", onClick);
		return () => {
			container.removeEventListener("click", onClick);
		};
	}, []);

	return (
		<div ref={containerRef} className="prose dark:prose-invert max-w-none break-words">
			<div
				dangerouslySetInnerHTML={{
					__html: html,
				}}
			/>
		</div>
	);
}

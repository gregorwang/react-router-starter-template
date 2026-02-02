import { marked } from "marked";
import hljs from "highlight.js";

const renderer = new marked.Renderer();
renderer.code = ((code: { text: string; lang?: string }) => {
	const language =
		code.lang && hljs.getLanguage(code.lang) ? code.lang : undefined;
	const highlighted = language
		? hljs.highlight(code.text, { language }).value
		: hljs.highlightAuto(code.text).value;
	const className = language ? `language-${language}` : "";
	return `<pre><code class="hljs ${className}">${highlighted}</code></pre>`;
}) as typeof renderer.code;

marked.use({ renderer });
marked.setOptions({ breaks: true, gfm: true });

export function parseMarkdown(text: string): string {
	return marked.parse(text) as string;
}

export function extractCodeBlocks(text: string): string[] {
	const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
	const blocks: string[] = [];
	let match;

	while ((match = codeBlockRegex.exec(text)) !== null) {
		blocks.push(match[2]);
	}

	return blocks;
}

export function hasCodeBlock(text: string): boolean {
	return /```(\w+)?\n/.test(text);
}

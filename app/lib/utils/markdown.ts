import { marked } from "marked";
import hljs from "highlight.js";

// Configure marked with options
marked.setOptions({
	highlight: (code, lang) => {
		if (lang && hljs.getLanguage(lang)) {
			try {
				return hljs.highlight(code, { language: lang }).value;
			} catch (e) {
				console.error(e);
			}
		}
		return hljs.highlightAuto(code).value;
	},
	breaks: true,
	gfm: true,
});

export function parseMarkdown(text: string): string {
	return marked.parse(text);
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

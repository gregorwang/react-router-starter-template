type MarkedType = typeof import("marked").marked;
type RendererType = import("marked").Renderer;

let markedInstance: MarkedType | null = null;
let rendererInstance: RendererType | null = null;
type Highlighter = {
	codeToHtml: (code: string, options: { lang: string; theme: string }) => string;
	getLoadedLanguages?: () => string[];
};

let highlighterPromise: Promise<Highlighter> | null = null;
let highlighterInstance: Highlighter | null = null;

const htmlEscapeMap: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;",
};

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char] || char);
}

function sanitizeLink(href: string | null | undefined) {
	if (!href) return "#";
	const trimmed = href.trim();
	const lower = trimmed.toLowerCase();
	if (
		lower.startsWith("http://") ||
		lower.startsWith("https://") ||
		lower.startsWith("/") ||
		lower.startsWith("#") ||
		lower.startsWith("mailto:")
	) {
		return trimmed;
	}
	return "#";
}

function normalizeLang(raw?: string) {
	if (!raw) return "text";
	const lang = raw.toLowerCase();
	const map: Record<string, string> = {
		js: "javascript",
		jsx: "jsx",
		ts: "typescript",
		tsx: "tsx",
		yml: "yaml",
		sh: "bash",
		shell: "bash",
		zsh: "bash",
		plaintext: "text",
		text: "text",
	};
	return map[lang] || lang;
}

function getThemeName() {
	if (typeof document === "undefined") return "github-dark";
	return document.documentElement.classList.contains("dark")
		? "github-dark"
		: "github-light";
}

async function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = (async () => {
			const { createHighlighterCore } = await import("shiki/core");
			const { createJavaScriptRegexEngine } = await import("shiki/engine/javascript");
			const [lightTheme, darkTheme] = await Promise.all([
				import("@shikijs/themes/github-light"),
				import("@shikijs/themes/github-dark"),
			]);
			return createHighlighterCore({
				themes: [lightTheme.default, darkTheme.default],
				langs: [
					import("@shikijs/langs/javascript"),
					import("@shikijs/langs/typescript"),
					import("@shikijs/langs/tsx"),
					import("@shikijs/langs/jsx"),
					import("@shikijs/langs/json"),
					import("@shikijs/langs/html"),
					import("@shikijs/langs/css"),
					import("@shikijs/langs/bash"),
					import("@shikijs/langs/markdown"),
				],
				engine: createJavaScriptRegexEngine(),
			});
		})();
	}
	try {
		highlighterInstance = await highlighterPromise;
		return highlighterInstance;
	} catch {
		highlighterInstance = null;
		return null;
	}
}

async function ensureMarked() {
	if (!markedInstance) {
		const mod = await import("marked");
		markedInstance = mod.marked;
		const Renderer = mod.Renderer;
		const renderer = new Renderer();
		void getHighlighter();
		renderer.html = () => "";
		renderer.link = (href, title, text) => {
			const safeHref = sanitizeLink(href);
			const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
			const external =
				safeHref.startsWith("http://") || safeHref.startsWith("https://");
			const rel = external ? ' rel="noopener noreferrer"' : "";
			const target = external ? ' target="_blank"' : "";
			return `<a href="${escapeHtml(safeHref)}"${titleAttr}${rel}${target}>${text}</a>`;
		};
		renderer.code = (code: { text: string; lang?: string }) => {
			const highlighter = highlighterInstance;
			const lang = normalizeLang(code.lang);
			const theme = getThemeName();
			if (lang === "text") {
				return `<pre><code>${escapeHtml(code.text)}</code></pre>`;
			}
			try {
				if (!highlighter) {
					return `<pre><code>${escapeHtml(code.text)}</code></pre>`;
				}
				const html = highlighter.codeToHtml(code.text, { lang, theme });
				return html;
			} catch {
				return `<pre><code>${escapeHtml(code.text)}</code></pre>`;
			}
		};
		rendererInstance = renderer;
		markedInstance.use({ renderer });
	}
	markedInstance.setOptions({ breaks: true, gfm: true });
	return { marked: markedInstance, renderer: rendererInstance };
}

export function parseMarkdownSync(text: string): string | null {
	if (!markedInstance) return null;
	try {
		return markedInstance.parse(text) as string;
	} catch {
		return null;
	}
}

export async function parseMarkdown(text: string): Promise<string> {
	try {
		const { marked } = await ensureMarked();
		return marked.parse(text) as string;
	} catch {
		return renderPlainTextAsHtml(text);
	}
}

export function renderPlainTextAsHtml(text: string): string {
	const linkPattern =
		/\[\[([^\]]+)\]\]\((https?:\/\/[^)\s]+)\)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
	let result = "";
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = linkPattern.exec(text)) !== null) {
		const [raw] = match;
		const index = match.index ?? 0;
		if (index > lastIndex) {
			result += escapeHtml(text.slice(lastIndex, index));
		}

		const label = match[1] || match[3] || match[5] || raw;
		const url = match[2] || match[4] || match[5];
		if (url) {
			const safeHref = sanitizeLink(url);
			result += `<a href="${escapeHtml(safeHref)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}</a>`;
		} else {
			result += escapeHtml(raw);
		}

		lastIndex = index + raw.length;
	}

	if (lastIndex < text.length) {
		result += escapeHtml(text.slice(lastIndex));
	}

	return result.replace(/\n/g, "<br />");
}

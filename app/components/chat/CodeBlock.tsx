import { useState } from "react";
import { parseMarkdown } from "../../lib/utils/markdown";
import { Button } from "../shared/Button";
import { cn } from "../../lib/utils/cn";

interface CodeBlockProps {
	content: string;
}

export function CodeBlock({ content }: CodeBlockProps) {
	const [copiedBlock, setCopiedBlock] = useState<string | null>(null);

	const handleCopy = (code: string, id: string) => {
		navigator.clipboard.writeText(code);
		setCopiedBlock(id);
		setTimeout(() => setCopiedBlock(null), 2000);
	};

	// Parse markdown and wrap code blocks with copy buttons
	const parsedHtml = parseMarkdown(content);

	return (
		<div className="prose dark:prose-invert max-w-none">
			<div
				className="markdown-content"
				dangerouslySetInnerHTML={{
					__html: parsedHtml,
				}}
			/>
		</div>
	);
}

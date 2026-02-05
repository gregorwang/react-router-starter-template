import { buildTranscript, clipText } from "./summary.server";

function normalizeTitle(title: string) {
	let normalized = title.trim();
	normalized = normalized.replace(/^["'“”]+|["'“”]+$/g, "");
	normalized = normalized.replace(/[。！？!?，,：:；;]+$/g, "");
	normalized = normalized.replace(/\s+/g, " ");
	if (normalized.length > 40) {
		normalized = normalized.slice(0, 40);
	}
	return normalized.trim();
}

function stripMarkdown(text: string) {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
		.replace(/\[[^\]]*\]\([^)]+\)/g, " ")
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/[#>*_\-|=]{2,}/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function deriveTitleFromText(text: string) {
	const cleaned = stripMarkdown(text);
	if (!cleaned) return "";

	const hasCjk = /[\u4e00-\u9fff]/.test(cleaned);
	if (hasCjk) {
		const compact = cleaned.replace(/[。！？!?，,：:；;]+/g, " ").replace(/\s+/g, " ").trim();
		return compact.slice(0, 14);
	}

	const words = cleaned.split(/\s+/).filter(Boolean);
	return words.slice(0, 6).join(" ");
}

export function deriveConversationTitle(
	messages: Array<{ role: string; content: string }>,
) {
	const firstUser = messages.find((msg) => msg.role === "user")?.content;
	const base = firstUser || messages[0]?.content || "";
	const candidate = deriveTitleFromText(base);
	const normalized = normalizeTitle(candidate);
	if (!normalized) {
		return "对话";
	}
	return normalized;
}

export async function generateConversationTitle({
	env,
	messages,
}: {
	env: Env;
	messages: Array<{ role: string; content: string }>;
}) {
	const transcript = buildTranscript(messages);
	const clippedTranscript = clipText(transcript, 8000);
	const prompt = [
		"你是对话标题生成器。",
		"根据对话内容生成一个简短主题标题。",
		"要求：",
		"1) 简体中文优先，6-14 个字；若明显为英文内容，最多 6 个英文单词。",
		"2) 不要引号，不要句号/冒号/编号。",
		"3) 只输出标题本身，不要解释。",
		`对话内容：\n${clippedTranscript}`,
	].join("\n");

	const titleProvider = (env.TITLE_PROVIDER || env.SUMMARY_PROVIDER || "").toLowerCase();
	const usePoe = titleProvider === "poe" || (!titleProvider && env.POE_API_KEY);
	const fallbackTitle = deriveConversationTitle(messages);

	try {
		if (usePoe) {
			if (!env.POE_API_KEY) {
				throw new Error("POE_API_KEY not configured");
			}
			const titleModel = env.TITLE_MODEL || env.SUMMARY_MODEL || "gpt-4o-mini";
			const response = await fetch("https://api.poe.com/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${env.POE_API_KEY}`,
				},
				body: JSON.stringify({
					model: titleModel,
					messages: [{ role: "user", content: prompt }],
					stream: false,
				}),
			});
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Poe API error: ${response.status} - ${errorText}`);
			}
			const data = (await response.json()) as {
				choices?: Array<{
					message?: { content?: string };
					content?: string;
					text?: string;
				}>;
			};
			const content =
				data.choices?.[0]?.message?.content ||
				data.choices?.[0]?.content ||
				data.choices?.[0]?.text;
			return content ? normalizeTitle(content) : fallbackTitle;
		}

		if (!env.AI) {
			return fallbackTitle;
		}

		const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as any, {
			prompt,
		})) as { response?: string };

		return result.response ? normalizeTitle(result.response) : fallbackTitle;
	} catch {
		return fallbackTitle;
	}
}

export async function summarizeConversation({
	env,
	baseSummary,
	messages,
}: {
	env: Env;
	baseSummary: string;
	messages: Array<{ role: string; content: string }>;
}) {
	const transcript = buildTranscript(messages);
	const clippedTranscript = clipText(transcript, 30_000);
	const prompt = [
		"你是一个对话记忆压缩器，只输出简体中文摘要。",
		"要求：",
		"1) 保留事实、偏好、约束、决定、待办。",
		"2) 去除客套、重复、无关细节。",
		"3) 使用条目列表，短句即可。",
		"4) 不要编造信息，不要引用原话。",
		"输出格式固定为：",
		"- 核心事实：...",
		"- 用户偏好：...",
		"- 约束/限制：...",
		"- 已做决定：...",
		"- 未完成事项：...",
		baseSummary
			? `\n现有摘要：\n${baseSummary}\n\n新增对话：\n${clippedTranscript}`
			: `\n对话内容：\n${clippedTranscript}`,
	].join("\n");

	const summaryProvider = (env.SUMMARY_PROVIDER || "").toLowerCase();
	const usePoe = summaryProvider === "poe" || (!summaryProvider && env.POE_API_KEY);

	if (usePoe) {
		if (!env.POE_API_KEY) {
			throw new Error("POE_API_KEY not configured");
		}
		const summaryModel = env.SUMMARY_MODEL || "gpt-4o-mini";
		const response = await fetch("https://api.poe.com/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.POE_API_KEY}`,
			},
			body: JSON.stringify({
				model: summaryModel,
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
		return content?.trim();
	}

	if (!env.AI) {
		throw new Error("Workers AI binding not configured");
	}

	const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as any, {
		prompt,
	})) as { response?: string };

	return result.response?.trim();
}

export function buildTranscript(messages: Array<{ role: string; content: string }>) {
	return messages
		.map((message) => `${message.role.toUpperCase()}: ${message.content}`)
		.join("\n");
}

export function clipText(text: string, maxChars: number) {
	if (text.length <= maxChars) return text;
	return text.slice(text.length - maxChars);
}

export function estimateTokensFromMessages(
	messages: Array<{ role: string; content: string }>,
) {
	const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));
	return messages.reduce((total, msg) => total + estimateTokens(msg.content), 0);
}

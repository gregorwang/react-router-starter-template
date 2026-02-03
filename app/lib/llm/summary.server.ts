export async function summarizeConversation({
	ai,
	baseSummary,
	messages,
}: {
	ai: Ai;
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

	const result = (await ai.run("@cf/meta/llama-3.1-8b-instruct" as any, {
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

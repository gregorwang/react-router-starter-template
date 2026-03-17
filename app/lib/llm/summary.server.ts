/**
 * Summary result from LLM summarization.
 */
export interface SummaryResult {
	/** The updated summary text. */
	summary: string;
	/** LLM-generated description of what changed (only for diff updates). */
	changeDescription?: string;
}

export async function summarizeConversation({
	env,
	baseSummary,
	messages,
	version,
}: {
	env: Env;
	baseSummary: string;
	messages: Array<{ role: string; content: string }>;
	version?: number;
}): Promise<SummaryResult | null> {
	const transcript = buildTranscript(messages);
	const clippedTranscript = clipText(transcript, 30_000);
	const isDiffUpdate = Boolean(baseSummary);

	const prompt = isDiffUpdate
		? buildDiffPrompt(baseSummary, clippedTranscript, version ?? 0)
		: buildInitialPrompt(clippedTranscript);

	const summaryProvider = (env.SUMMARY_PROVIDER || "").toLowerCase();
	const usePoe = summaryProvider === "poe" || (!summaryProvider && env.POE_API_KEY);

	let rawOutput: string | undefined;

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
		rawOutput =
			data.choices?.[0]?.message?.content ||
			data.choices?.[0]?.content ||
			data.choices?.[0]?.text;
	} else {
		if (!env.AI) {
			throw new Error("Workers AI binding not configured");
		}
		const result = (await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as any, {
			prompt,
		})) as { response?: string };
		rawOutput = result.response;
	}

	const trimmed = rawOutput?.trim();
	if (!trimmed) return null;

	// For diff updates, try to parse JSON response
	if (isDiffUpdate) {
		return parseSummaryResponse(trimmed);
	}

	// For initial summaries, return plain text
	return { summary: trimmed };
}

/**
 * Parse LLM output as a SummaryResult.
 *
 * Tries JSON first, falls back to plain text.
 */
export function parseSummaryResponse(raw: string): SummaryResult {
	// Try to extract JSON from the response (may be wrapped in markdown code block)
	const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/) || [
		null,
		raw,
	];
	const jsonCandidate = jsonMatch[1]?.trim() || raw.trim();

	try {
		const parsed = JSON.parse(jsonCandidate);
		if (parsed && typeof parsed.summary === "string" && parsed.summary.trim()) {
			return {
				summary: parsed.summary.trim(),
				changeDescription:
					typeof parsed.changeDescription === "string"
						? parsed.changeDescription.trim() || undefined
						: undefined,
			};
		}
	} catch {
		// JSON parse failed — fall through to plain text
	}

	// Fallback: treat entire output as summary text
	return { summary: raw.trim() };
}

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

function buildInitialPrompt(transcript: string): string {
	return [
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
		`\n对话内容：\n${transcript}`,
	].join("\n");
}

function buildDiffPrompt(
	baseSummary: string,
	transcript: string,
	version: number,
): string {
	return [
		"你是对话记忆管理器。你的任务是基于新增对话内容来更新一份运行摘要。",
		"",
		`当前摘要（版本 ${version}）：`,
		baseSummary,
		"",
		"新增对话内容：",
		transcript,
		"",
		"要求：",
		"1. 基于当前摘要和新增内容，输出**更新后的完整摘要**",
		"2. 保持固定格式：核心事实 / 用户偏好 / 约束限制 / 已做决定 / 未完成事项",
		"3. 摘要总长度控制在 800 字以内",
		"4. 合并重复信息，删除已不相关的内容",
		"5. 额外输出变更说明（简述本次更新的内容）",
		"",
		"输出 JSON 格式（不要使用 markdown 代码块包裹）：",
		'{ "summary": "更新后的完整摘要...", "changeDescription": "本次变更简述..." }',
	].join("\n");
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

import type { AppLoadContext } from "react-router";
import type { LLMMessage, LLMProvider, Usage, XAISearchMode } from "./types";
import { consumeSSEJson } from "../utils/sse";
import {
	POLO_DEFAULT_OUTPUT_TOKENS,
	POLO_OUTPUT_TOKENS_MIN,
} from "./defaults";

interface LLMStreamEvent {
	type: "delta" | "reasoning" | "usage" | "credits" | "meta" | "search" | "error";
	content?: string;
	usage?: Usage;
	credits?: number;
	meta?: { thinkingMs?: number; stopReason?: string };
	search?: {
		provider: "x" | "xai" | "claude";
		query?: string;
		results?: Array<{
			id?: string;
			author?: string;
			text?: string;
			title?: string;
			url?: string;
			createdAt?: string;
			pageAge?: string;
		}>;
		citations?: string[];
	};
}

// Server-side streaming response for LLM
export async function streamLLMFromServer(
	messages: LLMMessage[],
	provider: LLMProvider,
	model: string,
	context: AppLoadContext,
	options?: {
		reasoningEffort?: "low" | "medium" | "high";
		enableThinking?: boolean;
		thinkingBudget?: number;
		thinkingLevel?: "low" | "medium" | "high";
		outputTokens?: number;
		outputEffort?: "low" | "medium" | "high" | "max";
		webSearch?: boolean;
		xaiSearchMode?: XAISearchMode;
		enableTools?: boolean;
	},
): Promise<ReadableStream<Uint8Array>> {
	const env = context.cloudflare.env;

	const apiKeyMap: Record<LLMProvider, string | undefined> = {
		deepseek: env.DEEPSEEK_API_KEY,
		xai: env.XAI_API_KEY,
		poe: env.POE_API_KEY,
		"workers-ai": undefined,
		poloai: env.POLOAI_API_KEY,
		ark: env.ARK_API_KEY,
	};

	const apiKey = apiKeyMap[provider];
	if (provider !== "workers-ai" && !apiKey) {
		throw new Error(
			`API key for ${provider} not configured. Please set it using: wrangler secret put ${provider.toUpperCase()}_API_KEY`,
		);
	}

	const encoder = new TextEncoder();
	const stream = new TransformStream<LLMStreamEvent, Uint8Array>({
		transform(event, controller) {
			controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
		},
		flush(controller) {
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
		},
	});

	const writer = stream.writable.getWriter();
	const startedAt = Date.now();
	let sentThinkingMeta = false;

	const writeEvent = async (event: LLMStreamEvent) => {
		if (!sentThinkingMeta && (event.type === "delta" || event.type === "reasoning")) {
			sentThinkingMeta = true;
			await writer.write({
				type: "meta",
				meta: { thinkingMs: Date.now() - startedAt },
			});
		}
		await writer.write(event);
	};

	(async () => {
		try {
			let requestMessages = messages;
			let searchMeta: LLMStreamEvent["search"] | undefined;

			if (searchMeta) {
				await writeEvent({ type: "search", search: searchMeta });
			}

			switch (provider) {
				case "deepseek":
					await streamDeepSeekServer(requestMessages, model, apiKey!, writeEvent);
					break;
				case "xai":
					await streamXAIServer(requestMessages, model, apiKey!, writeEvent, {
						webSearch: options?.webSearch,
						xaiSearchMode: options?.xaiSearchMode,
					});
					break;
				case "poe":
					await streamPoeServer(requestMessages, model, apiKey!, writeEvent, options);
					break;
				case "workers-ai":
					await streamWorkersAIServer(requestMessages, model, context, writeEvent);
					break;
				case "poloai":
					await streamPoloAIServer(requestMessages, model, apiKey!, writeEvent, {
						outputEffort: options?.outputEffort,
						webSearch: options?.webSearch,
						enableThinking: options?.enableThinking,
						thinkingBudget: options?.thinkingBudget,
						outputTokens: options?.outputTokens,
						enableTools: options?.enableTools,
					});
					break;
				case "ark":
					await streamArkServer(requestMessages, model, apiKey!, writeEvent, {
						enableThinking: options?.enableThinking,
						outputTokens: options?.outputTokens,
					});
					break;
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("[LLM Server] Upstream error:", errorMessage);
			await writer.write({
				type: "error",
				content: formatUserFacingError(errorMessage),
			});
		} finally {
			await writer.close();
		}
	})();

	return stream.readable;
}

async function streamDeepSeekServer(
	messages: LLMMessage[],
	model: string,
	apiKey: string,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
): Promise<void> {
	const emitStopReason = createStopReasonEmitter(writeEvent);
	const response = await fetch("https://api.deepseek.com/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages,
			stream: true,
			temperature: 0.7,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
	}

	await processSSEStream(response, async (parsed) => {
		const delta = parsed.choices?.[0]?.delta;
		const content = delta?.content;
		const reasoning =
			delta?.reasoning_content || delta?.reasoning || delta?.thinking || "";
		const usage = normalizeUsage(parsed.usage);
		await emitStopReason(extractOpenAIStopReason(parsed));

		if (content) {
			await writeEvent({ type: "delta", content });
		}
		if (reasoning) {
			await writeEvent({ type: "reasoning", content: reasoning });
		}
		if (usage) {
			await writeEvent({ type: "usage", usage });
		}
	});
}

async function streamXAIServer(
	messages: LLMMessage[],
	model: string,
	apiKey: string,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
	options?: { webSearch?: boolean; xaiSearchMode?: XAISearchMode },
): Promise<void> {
	const emitStopReason = createStopReasonEmitter(writeEvent);
	const useResponsesApi = true;
	const searchEnabled = options?.webSearch === true;
	const searchMode = normalizeXAISearchMode(options?.xaiSearchMode);
	const toolVariants = searchEnabled ? buildXAIToolVariants(searchMode) : [];
	const requestedTools = toolVariants[0] ?? [];

	if (useResponsesApi) {
		const preparedInput = await prepareXAIResponsesInput(messages, apiKey);
		const body: Record<string, unknown> = {
			model,
			input: preparedInput.input,
			stream: true,
			temperature: 0,
		};

		try {
			if (requestedTools.length > 0) {
				body.tools = requestedTools;
				body.tool_choice = "auto";
				body.include = ["inline_citations"];
			}

			let response = await fetch("https://api.x.ai/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			});

			if (!response.ok && searchEnabled) {
				const fallbackToolVariants = toolVariants
					.slice(1)
					.filter((tools) => !sameXAITools(tools, requestedTools));
				const candidates: Array<Record<string, unknown>> = [];

				if (requestedTools.length > 0) {
					const sameToolsWithoutInclude = { ...body };
					delete sameToolsWithoutInclude.include;
					candidates.push(sameToolsWithoutInclude);
				}

				for (const tools of fallbackToolVariants) {
					const candidate: Record<string, unknown> = { ...body };
					delete candidate.include;
					if (tools.length > 0) {
						candidate.tools = tools;
						candidate.tool_choice = "auto";
					} else {
						delete candidate.tools;
						delete candidate.tool_choice;
					}
					candidates.push(candidate);
				}

				for (const candidate of candidates) {
					response = await fetch("https://api.x.ai/v1/responses", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${apiKey}`,
						},
						body: JSON.stringify(candidate),
					});
					if (response.ok) break;
				}
			}

			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`xAI API error: ${response.status} - ${errorText}`);
			}

			const contentType = response.headers.get("Content-Type") || "";
			if (!contentType.includes("text/event-stream")) {
				const data = (await response.json()) as any;
				const content = extractXAIResponseText(data);
				const usage = normalizeUsage(data?.usage ?? data?.response?.usage);
				const credits = data?.credits ?? data?.usage?.credits;
				const citations = extractXAICitations(data?.response ?? data);
				await emitStopReason(extractXAIStopReason(data));

				if (citations?.length) {
					await writeEvent({
						type: "search",
						search: { provider: "xai", citations },
					});
				}
				if (content) {
					await writeEvent({ type: "delta", content });
				}
				if (usage) {
					await writeEvent({ type: "usage", usage });
				}
				if (credits) {
					await writeEvent({ type: "credits", credits });
				}
				return;
			}

			let sawDelta = false;
			await processSSEStream(response, async (parsed) => {
				const eventType = parsed?.type;

				if (eventType === "response.output_text.delta" && parsed.delta) {
					sawDelta = true;
					await writeEvent({ type: "delta", content: parsed.delta });
				}

				if (eventType === "response.completed" && parsed.response) {
					await emitStopReason(extractXAIStopReason(parsed));
					const citations = extractXAICitations(parsed.response);
					if (citations?.length) {
						await writeEvent({
							type: "search",
							search: { provider: "xai", citations },
						});
					}

					const usage = normalizeUsage(parsed.response?.usage);
					if (usage) {
						await writeEvent({ type: "usage", usage });
					}

					if (!sawDelta) {
						const content = extractXAIResponseText(parsed.response);
						if (content) {
							await writeEvent({ type: "delta", content });
						}
					}
				}

				const legacyDelta = parsed?.choices?.[0]?.delta?.content;
				if (legacyDelta) {
					sawDelta = true;
					await writeEvent({ type: "delta", content: legacyDelta });
				}
				await emitStopReason(extractXAIStopReason(parsed));

				const legacyUsage = normalizeUsage(parsed?.usage);
				if (legacyUsage) {
					await writeEvent({ type: "usage", usage: legacyUsage });
				}

				const legacyCredits = parsed?.credits ?? parsed?.usage?.credits;
				if (legacyCredits) {
					await writeEvent({ type: "credits", credits: legacyCredits });
				}
			});
		} finally {
			await cleanupXAIUploadedFiles(apiKey, preparedInput.uploadedFileIds);
		}

		return;
	}

	const body: Record<string, unknown> = {
		messages: buildXAIChatMessages(messages),
		model,
		stream: true,
		temperature: 0,
	};

	if (requestedTools.length > 0) {
		body.tools = requestedTools;
		body.tool_choice = "auto";
	}

	let response = await fetch("https://api.x.ai/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	});

	if (!response.ok && searchEnabled) {
		const fallbackToolVariants = toolVariants
			.slice(1)
			.filter((tools) => !sameXAITools(tools, requestedTools));
		const candidates = fallbackToolVariants.map((tools) => {
			const candidate: Record<string, unknown> = { ...body };
			if (tools.length > 0) {
				candidate.tools = tools;
				candidate.tool_choice = "auto";
			} else {
				delete candidate.tools;
				delete candidate.tool_choice;
			}
			return candidate;
		});
		for (const candidate of candidates) {
			response = await fetch("https://api.x.ai/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(candidate),
			});
			if (response.ok) break;
		}
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`xAI API error: ${response.status} - ${errorText}`);
	}

	await processSSEStream(response, async (parsed) => {
		const delta = parsed.choices?.[0]?.delta;
		const content = delta?.content;
		const usage = normalizeUsage(parsed.usage);
		const credits = parsed.credits ?? parsed.usage?.credits;
		await emitStopReason(extractXAIStopReason(parsed));

		if (content) {
			await writeEvent({ type: "delta", content });
		}
		if (usage) {
			await writeEvent({ type: "usage", usage });
		}
		if (credits) {
			await writeEvent({ type: "credits", credits });
		}
	});
}

async function prepareXAIResponsesInput(
	messages: LLMMessage[],
	apiKey: string,
): Promise<{
	input: Array<Record<string, unknown>>;
	uploadedFileIds: string[];
}> {
	const uploadedFileIds: string[] = [];
	const input: Array<Record<string, unknown>> = [];

	for (const message of messages) {
		const attachments = (message.attachments ?? []).filter((item) => item.data);
		if (!attachments.length) {
			input.push({ role: message.role, content: message.content });
			continue;
		}

		const content: Array<Record<string, unknown>> = [];
		if (message.content.trim()) {
			content.push({ type: "input_text", text: message.content });
		}

		for (const attachment of attachments) {
			if (!attachment?.data) continue;
			if (attachment.mimeType.startsWith("image/")) {
				content.push({
					type: "input_image",
					image_url: `data:${attachment.mimeType};base64,${attachment.data}`,
				});
				continue;
			}

			const fileId = await uploadXAIFile(apiKey, attachment);
			uploadedFileIds.push(fileId);
			content.push({ type: "input_file", file_id: fileId });
		}

		if (!content.length) {
			content.push({ type: "input_text", text: "" });
		}

		input.push({ role: message.role, content });
	}

	return { input, uploadedFileIds };
}

function buildXAIChatMessages(messages: LLMMessage[]) {
	return messages.map((message) => {
		const attachments = (message.attachments ?? []).filter((item) => item.data);
		if (!attachments.length) {
			return { role: message.role, content: message.content };
		}

		const content: Array<Record<string, unknown>> = [];
		if (message.content.trim()) {
			content.push({ type: "text", text: message.content });
		}

		for (const attachment of attachments) {
			if (!attachment?.data) continue;
			if (!attachment.mimeType.startsWith("image/")) {
				if (attachment.name) {
					content.push({
						type: "text",
						text: `[Attached file: ${attachment.name}]`,
					});
				}
				continue;
			}
			content.push({
				type: "image_url",
				image_url: {
					url: `data:${attachment.mimeType};base64,${attachment.data}`,
				},
			});
		}

		if (!content.length) {
			content.push({ type: "text", text: "" });
		}

		return { role: message.role, content };
	});
}

type XAIToolType = "x_search" | "web_search";
type XAIToolSpec = { type: XAIToolType };

function normalizeXAISearchMode(mode?: XAISearchMode): XAISearchMode {
	if (mode === "web" || mode === "both") return mode;
	return "x";
}

function buildXAIToolVariants(mode: XAISearchMode): XAIToolSpec[][] {
	switch (mode) {
		case "web":
			return [[{ type: "web_search" }], []];
		case "both":
			return [
				[{ type: "web_search" }, { type: "x_search" }],
				[{ type: "x_search" }],
				[{ type: "web_search" }],
				[],
			];
		case "x":
		default:
			return [[{ type: "x_search" }], []];
	}
}

function sameXAITools(a: XAIToolSpec[], b: XAIToolSpec[]) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i]?.type !== b[i]?.type) return false;
	}
	return true;
}

function decodeBase64ToUint8Array(base64: string) {
	const normalized = base64.replace(/\s+/g, "");
	const binary = atob(normalized);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function inferAttachmentExtension(mimeType: string) {
	switch (mimeType) {
		case "application/pdf":
			return "pdf";
		case "text/plain":
			return "txt";
		case "text/markdown":
			return "md";
		case "text/csv":
			return "csv";
		case "application/json":
			return "json";
		default:
			return "bin";
	}
}

function getAttachmentFileName(
	attachment: NonNullable<LLMMessage["attachments"]>[number],
) {
	if (attachment.name && attachment.name.trim()) return attachment.name.trim();
	const ext = inferAttachmentExtension(attachment.mimeType);
	return `attachment-${attachment.id}.${ext}`;
}

async function uploadXAIFile(
	apiKey: string,
	attachment: NonNullable<LLMMessage["attachments"]>[number],
) {
	if (!attachment.data) {
		throw new Error("Missing attachment data");
	}
	const bytes = decodeBase64ToUint8Array(attachment.data);
	const file = new File([bytes], getAttachmentFileName(attachment), {
		type: attachment.mimeType,
	});
	const form = new FormData();
	form.set("file", file);

	const response = await fetch("https://api.x.ai/v1/files", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
		body: form,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`xAI files upload error: ${response.status} - ${errorText}`);
	}

	const payload = (await response.json()) as any;
	const id =
		typeof payload?.id === "string"
			? payload.id
			: typeof payload?.file?.id === "string"
				? payload.file.id
				: null;
	if (!id) {
		throw new Error("xAI files upload error: missing file id");
	}
	return id;
}

async function cleanupXAIUploadedFiles(apiKey: string, fileIds: string[]) {
	if (!fileIds.length) return;
	await Promise.allSettled(
		fileIds.map((id) =>
			fetch(`https://api.x.ai/v1/files/${encodeURIComponent(id)}`, {
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			}),
		),
	);
}

async function streamPoeServer(
	messages: LLMMessage[],
	model: string,
	apiKey: string,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
	options?: {
		reasoningEffort?: "low" | "medium" | "high";
		enableThinking?: boolean;
		thinkingBudget?: number;
		thinkingLevel?: "low" | "medium" | "high";
		webSearch?: boolean;
	},
): Promise<void> {
	const emitStopReason = createStopReasonEmitter(writeEvent);
	const response = await fetch("https://api.poe.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
			model,
			stream: true,
			extra_body: {
				...(model === "kimi-k2.5"
					? { enable_thinking: options?.enableThinking ?? true }
					: {}),
				...(model === "o3"
					? { reasoning_effort: options?.reasoningEffort || "high" }
					: {}),
				...(model === "claude-sonnet-4.5"
					? { thinking_budget: options?.thinkingBudget || 12288 }
					: {}),
				...(model === "gemini-3-pro"
					? {
							thinking_level: options?.thinkingLevel || "high",
							web_search: options?.webSearch ?? true,
						}
					: {}),
			},
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Poe API error: ${response.status} - ${errorText}`);
	}

	await processSSEStream(response, async (parsed) => {
		const delta = parsed.choices?.[0]?.delta;
		const content = delta?.content;
		const usage = normalizeUsage(parsed.usage);
		const credits = parsed.credits ?? parsed.usage?.credits;
		await emitStopReason(extractOpenAIStopReason(parsed));

		if (content) {
			await writeEvent({ type: "delta", content });
		}
		if (usage) {
			await writeEvent({ type: "usage", usage });
		}
		if (credits) {
			await writeEvent({ type: "credits", credits });
		}
	});
}

async function streamWorkersAIServer(
	messages: LLMMessage[],
	model: string,
	context: AppLoadContext,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
): Promise<void> {
	const env = context.cloudflare.env;
	if (!env.AI) {
		throw new Error("Workers AI binding not configured. Add AI binding in wrangler.json.");
	}

	const prompt = messages
		.map((message) => `${message.role.toUpperCase()}: ${message.content}`)
		.join("\n");

	const result = (await env.AI.run(model as any, { prompt } as any)) as {
		response?: string;
		usage?: Usage;
	};

	const content = result.response || "";
	if (content) {
		await writeEvent({ type: "delta", content });
	}
	if (result.usage) {
		await writeEvent({ type: "usage", usage: result.usage });
	}
}

async function streamPoloAIServer(
	messages: LLMMessage[],
	model: string,
	apiKey: string,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
	options?: {
		outputEffort?: "low" | "medium" | "high" | "max";
		webSearch?: boolean;
		enableThinking?: boolean;
		thinkingBudget?: number;
		outputTokens?: number;
		enableTools?: boolean;
	},
): Promise<void> {
	const webSearch = options?.webSearch ?? true;
	const enableThinking = options?.enableThinking ?? true;
	const rawThinkingBudget =
		typeof options?.thinkingBudget === "number" ? options.thinkingBudget : 12288;
	const thinkingBudget = Math.max(1024, Math.floor(rawThinkingBudget));
	const rawOutputTokens =
		typeof options?.outputTokens === "number"
			? options.outputTokens
			: POLO_DEFAULT_OUTPUT_TOKENS;
	const outputTokens = Math.max(POLO_OUTPUT_TOKENS_MIN, Math.floor(rawOutputTokens));
	const thinkingConfig = buildPoloAIThinkingConfig({
		model,
		enableThinking,
		thinkingBudget,
	});
	const maxTokens =
		thinkingConfig?.type === "enabled"
			? thinkingBudget + outputTokens
			: outputTokens;
	const outputEffort = normalizePoloAIOutputEffort(model, options?.outputEffort);
	const outputConfig = outputEffort ? { effort: outputEffort } : undefined;
	const formattedMessages = buildPoloAIMessages(messages);
	const localToolsEnabled = options?.enableTools ?? true;
	let toolBundle = buildPoloAITools({
		model,
		webSearch,
		enableTools: localToolsEnabled,
	});
	const toolChoice = toolBundle.tools.length > 0 ? { type: "auto" } : undefined;
	let baseBody: Record<string, unknown> = {
		model,
		stream: true,
		max_tokens: maxTokens,
		...(thinkingConfig ? { thinking: thinkingConfig } : {}),
		...(outputConfig ? { output_config: outputConfig } : {}),
		...(toolBundle.tools.length > 0
			? { tools: toolBundle.tools, tool_choice: toolChoice }
			: {}),
	};

	let currentMessages = formattedMessages;
	let rounds = 0;
	let aggregatedSearch: LLMStreamEvent["search"] | undefined;
	let retriedLegacyWebSearchTool = false;

	while (true) {
		let result: Awaited<ReturnType<typeof runPoloAIStreamRequest>>;
		try {
			result = await runPoloAIStreamRequest({
				apiKey,
				messages: currentMessages,
				baseBody,
				localToolNames: toolBundle.localToolNames,
				writeEvent,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (
				webSearch &&
				!retriedLegacyWebSearchTool &&
				shouldRetryWithLegacyPoloAIWebSearchTool(message)
			) {
				retriedLegacyWebSearchTool = true;
				toolBundle = buildPoloAITools({
					model,
					webSearch,
					enableTools: localToolsEnabled,
					forceLegacyWebSearchTool: true,
				});
				baseBody = {
					...baseBody,
					...(toolBundle.tools.length > 0
						? { tools: toolBundle.tools, tool_choice: toolChoice }
						: {}),
				};
				result = await runPoloAIStreamRequest({
					apiKey,
					messages: currentMessages,
					baseBody,
					localToolNames: toolBundle.localToolNames,
					writeEvent,
				});
			} else {
				throw error;
			}
		}

		aggregatedSearch = mergeSearchMeta(aggregatedSearch, result.searchMeta);
		if (aggregatedSearch) {
			await writeEvent({ type: "search", search: aggregatedSearch });
		}

		if (result.toolUses.length === 0) {
			return;
		}

		rounds += 1;
		if (rounds > 2) {
			throw new Error("Tool call limit exceeded.");
		}

		const toolResults = await runPoloAITools(result.toolUses);
		aggregatedSearch = mergeSearchMeta(
			aggregatedSearch,
			extractSearchMetaFromToolResults(result.toolUses, toolResults),
		);
		if (aggregatedSearch) {
			await writeEvent({ type: "search", search: aggregatedSearch });
		}

		const toolUseBlocks = result.toolUses.map((toolUse) => ({
			type: "tool_use",
			id: toolUse.id,
			name: toolUse.name,
			input: toolUse.input ?? {},
		}));
		const toolResultBlocks = toolResults.map((toolResult) => ({
			type: "tool_result",
			tool_use_id: toolResult.id,
			content: toolResult.content,
			...(toolResult.isError ? { is_error: true } : {}),
		}));

		currentMessages = currentMessages.concat([
			{ role: "assistant", content: toolUseBlocks },
			{ role: "user", content: toolResultBlocks },
		]);
	}
}

async function streamArkServer(
	messages: LLMMessage[],
	model: string,
	apiKey: string,
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
	options?: { enableThinking?: boolean; outputTokens?: number },
): Promise<void> {
	const emitStopReason = createStopReasonEmitter(writeEvent);
	const rawOutputTokens =
		typeof options?.outputTokens === "number" ? options.outputTokens : 2048;
	const maxTokens = Math.min(32768, Math.max(256, Math.floor(rawOutputTokens)));
	const body: Record<string, unknown> = {
		model,
		max_tokens: maxTokens,
		messages: messages.map((message) => ({
			role: message.role,
			content: message.content,
		})),
		stream: true,
	};
	if (options?.enableThinking !== false) {
		body.thinking = { type: "enabled" };
	}

	const response = await fetch(
		"https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
		{
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Ark API error: ${response.status} - ${errorText}`);
	}

	const contentType = response.headers.get("Content-Type") || "";
	if (!contentType.includes("text/event-stream")) {
		const data = (await response.json()) as any;
		const content = extractOpenAIContent(data);
		const usage = normalizeUsage(data?.usage);
		await emitStopReason(extractOpenAIStopReason(data));
		if (content) {
			await writeEvent({ type: "delta", content });
		}
		if (usage) {
			await writeEvent({ type: "usage", usage });
		}
		return;
	}

	await processSSEStream(response, async (parsed) => {
		if (parsed?.error?.message) {
			throw new Error(parsed.error.message);
		}
		await emitStopReason(extractOpenAIStopReason(parsed));
		const content = extractOpenAIDelta(parsed);
		const usage = normalizeUsage(parsed?.usage);
		if (content) {
			await writeEvent({ type: "delta", content });
		}
		if (usage) {
			await writeEvent({ type: "usage", usage });
		}
	});
}

function extractOpenAIDelta(payload: any): string | undefined {
	const delta = payload?.choices?.[0]?.delta;
	const content = delta?.content ?? delta?.text;
	return typeof content === "string" ? content : undefined;
}

function extractOpenAIContent(payload: any): string | undefined {
	const message = payload?.choices?.[0]?.message;
	if (typeof message?.content === "string") {
		return message.content;
	}
	if (Array.isArray(message?.content)) {
		return message.content
			.map((block: any) => (typeof block?.text === "string" ? block.text : ""))
			.join("");
	}
	return undefined;
}

function extractXAIResponseText(payload: any): string | undefined {
	if (!payload) return undefined;

	if (typeof payload.output_text === "string") {
		return payload.output_text;
	}

	const response = payload.response ?? payload;
	const output = response?.output;
	if (Array.isArray(output)) {
		const parts: string[] = [];
		for (const item of output) {
			const content = item?.content;
			if (!Array.isArray(content)) continue;
			for (const block of content) {
				if (block?.type === "output_text" && typeof block.text === "string") {
					parts.push(block.text);
				}
			}
		}
		if (parts.length) {
			return parts.join("");
		}
	}

	return undefined;
}

function extractXAICitations(payload: any): string[] | undefined {
	if (!payload) return undefined;
	const response = payload.response ?? payload;

	const citations = response?.citations;
	if (Array.isArray(citations)) {
		const urls = citations.filter((item: any) => typeof item === "string");
		if (urls.length) return urls;
	}

	const inline = response?.inline_citations;
	if (Array.isArray(inline)) {
		const urls = inline
			.map((item: any) => item?.web_citation?.url)
			.filter((url: any) => typeof url === "string");
		if (urls.length) return urls;
	}

	return undefined;
}


// Helper to process SSE streams
async function processSSEStream(
	response: Response,
	onParsed: (parsed: any) => Promise<void>,
): Promise<void> {
	if (!response.body) {
		throw new Error("No response body received");
	}

	await consumeSSEJson(response.body, onParsed, {
		onParseError: (payload, error) => {
			console.error(
				"[LLM Server] Stream parse error:",
				error,
				"Data chunk:",
				payload.slice(0, 50),
			);
		},
	});
}

function normalizeUsage(usage: any): Usage | undefined {
	if (!usage) return undefined;
	const promptTokens = usage.prompt_tokens ?? usage.promptTokens;
	const completionTokens = usage.completion_tokens ?? usage.completionTokens;
	const totalTokens = usage.total_tokens ?? usage.totalTokens;
	const inputTokens = usage.input_tokens ?? usage.inputTokens;
	const outputTokens = usage.output_tokens ?? usage.outputTokens;
	if (
		typeof promptTokens !== "number" ||
		typeof completionTokens !== "number" ||
		typeof totalTokens !== "number"
	) {
		if (typeof inputTokens === "number" && typeof outputTokens === "number") {
			return {
				promptTokens: inputTokens,
				completionTokens: outputTokens,
				totalTokens: inputTokens + outputTokens,
			};
		}
		return undefined;
	}
	return { promptTokens, completionTokens, totalTokens };
}

function extractPoloAIContent(payload: any): string | undefined {
	const choice = payload?.choices?.[0];
	const delta = choice?.delta;
	const openAIDelta =
		delta?.content ??
		delta?.text ??
		payload?.delta?.text ??
		payload?.delta?.content ??
		payload?.content_block?.text;
	if (typeof openAIDelta === "string") {
		return openAIDelta;
	}

	const messageContent = choice?.message?.content;
	if (typeof messageContent === "string") {
		return messageContent;
	}

	const contentBlocks = payload?.content ?? payload?.message?.content;
	if (Array.isArray(contentBlocks)) {
		const text = contentBlocks
			.map((block: any) => (typeof block?.text === "string" ? block.text : ""))
			.join("");
		return text || undefined;
	}

	return undefined;
}

function normalizeStopReason(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function createStopReasonEmitter(
	writeEvent: (event: LLMStreamEvent) => Promise<void>,
) {
	let lastReason: string | undefined;
	return async (reason: unknown) => {
		const normalized = normalizeStopReason(reason);
		if (!normalized || normalized === lastReason) return;
		lastReason = normalized;
		await writeEvent({ type: "meta", meta: { stopReason: normalized } });
	};
}

function extractOpenAIStopReason(payload: any): string | undefined {
	return normalizeStopReason(
		payload?.choices?.[0]?.finish_reason ??
			payload?.choices?.[0]?.stop_reason ??
			payload?.finish_reason ??
			payload?.stop_reason,
	);
}

function extractXAIStopReason(payload: any): string | undefined {
	const response = payload?.response ?? payload;
	return normalizeStopReason(
		response?.stop_reason ??
			response?.finish_reason ??
			response?.status_details?.reason ??
			payload?.stop_reason ??
			payload?.finish_reason ??
			payload?.choices?.[0]?.finish_reason,
	);
}

function extractPoloAIStopReason(payload: any): string | undefined {
	return normalizeStopReason(
		payload?.stop_reason ??
			payload?.message?.stop_reason ??
			payload?.message?.delta?.stop_reason ??
			payload?.delta?.stop_reason ??
			payload?.content_block?.stop_reason ??
			payload?.choices?.[0]?.finish_reason ??
			payload?.choices?.[0]?.stop_reason ??
			payload?.finish_reason,
	);
}

function extractPoloAIReasoning(payload: any): string | undefined {
	if (!payload) return undefined;

	if (payload.type === "content_block_delta") {
		const delta = payload.delta;
		if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
			return delta.thinking;
		}
		return undefined;
	}

	if (payload.type === "content_block_start") {
		const contentBlock = payload.content_block;
		if (
			contentBlock?.type === "thinking" &&
			typeof contentBlock.thinking === "string"
		) {
			return contentBlock.thinking;
		}
	}

	const openAIDelta = payload?.choices?.[0]?.delta;
	if (typeof openAIDelta?.reasoning_content === "string") {
		return openAIDelta.reasoning_content;
	}
	if (typeof openAIDelta?.reasoning === "string") {
		return openAIDelta.reasoning;
	}
	if (typeof payload?.delta?.reasoning === "string") {
		return payload.delta.reasoning;
	}
	if (typeof payload?.delta?.thinking === "string") {
		return payload.delta.thinking;
	}
	if (typeof payload?.content_block?.thinking === "string") {
		return payload.content_block.thinking;
	}

	const contentBlocks =
		payload?.content ??
		payload?.message?.content ??
		payload?.choices?.[0]?.message?.content;

	if (Array.isArray(contentBlocks)) {
		const thinkingParts = contentBlocks
			.filter(
				(block: any) =>
					block?.type === "thinking" && typeof block.thinking === "string",
			)
			.map((block: any) => block.thinking);
		if (thinkingParts.length > 0) {
			return thinkingParts.join("");
		}
	}

	return undefined;
}

type PoloAIToolUse = {
	id: string;
	name: string;
	input?: unknown;
	inputJson?: string;
};

type PoloAIToolResult = {
	id: string;
	content: string;
	isError?: boolean;
};

function evaluateMathExpression(expression: string): number {
	const sanitized = expression.replace(/\s+/g, "");
	if (!sanitized) {
		throw new Error("Missing expression");
	}
	if (!/^[0-9+\-*/().]+$/.test(sanitized)) {
		throw new Error("Expression contains unsupported characters");
	}

	const tokens = sanitized.match(/\d+(?:\.\d+)?|[()+\-*/]/g) || [];
	const values: number[] = [];
	const ops: string[] = [];
	const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

	const applyOp = () => {
		const op = ops.pop();
		const right = values.pop();
		const left = values.pop();
		if (!op || right === undefined || left === undefined) {
			throw new Error("Invalid expression");
		}
		switch (op) {
			case "+":
				values.push(left + right);
				break;
			case "-":
				values.push(left - right);
				break;
			case "*":
				values.push(left * right);
				break;
			case "/":
				values.push(left / right);
				break;
			default:
				throw new Error("Invalid operator");
		}
	};

	const isOperator = (token: string) => ["+", "-", "*", "/"].includes(token);

	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		if (!token) continue;

		if (/^\d/.test(token)) {
			values.push(Number(token));
			continue;
		}

		if (token === "(") {
			ops.push(token);
			continue;
		}

		if (token === ")") {
			while (ops.length && ops[ops.length - 1] !== "(") {
				applyOp();
			}
			if (ops.pop() !== "(") {
				throw new Error("Mismatched parentheses");
			}
			continue;
		}

		if (isOperator(token)) {
			const prev = tokens[i - 1];
			if (token === "-" && (i === 0 || (prev && (isOperator(prev) || prev === "(")))) {
				values.push(0);
			}
			while (
				ops.length &&
				isOperator(ops[ops.length - 1]) &&
				precedence[ops[ops.length - 1]] >= precedence[token]
			) {
				applyOp();
			}
			ops.push(token);
			continue;
		}

		throw new Error("Invalid token");
	}

	while (ops.length) {
		if (ops[ops.length - 1] === "(") {
			throw new Error("Mismatched parentheses");
		}
		applyOp();
	}

	if (values.length !== 1) {
		throw new Error("Invalid expression");
	}
	return values[0];
}

const POLOAI_WEB_SEARCH_TOOL_NAME = "web_search";
const POLOAI_WEB_SEARCH_TOOL_LEGACY_TYPE = "web_search_20250305";
const POLOAI_WEB_SEARCH_TOOL_LATEST_TYPE = "web_search_20260209";
const POLOAI_INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";
type OutputEffort = "low" | "medium" | "high" | "max";

function supportsPoloAIOutputEffort(model: string) {
	return (
		model.startsWith("claude-opus-4-6") ||
		model.startsWith("claude-opus-4-5") ||
		model.startsWith("claude-sonnet-4-6")
	);
}

function supportsPoloAIMaxOutputEffort(model: string) {
	return model.startsWith("claude-opus-4-6");
}

function supportsPoloAIAdaptiveThinking(model: string) {
	return model.startsWith("claude-opus-4-6") || model.startsWith("claude-sonnet-4-6");
}

function normalizePoloAIOutputEffort(
	model: string,
	effort?: OutputEffort,
): OutputEffort | undefined {
	if (!supportsPoloAIOutputEffort(model)) return undefined;
	const defaultEffort: OutputEffort = supportsPoloAIMaxOutputEffort(model)
		? "max"
		: "high";
	const resolved = effort ?? defaultEffort;
	if (resolved === "max" && !supportsPoloAIMaxOutputEffort(model)) {
		return "high";
	}
	return resolved;
}

function buildPoloAIThinkingConfig(options: {
	model: string;
	enableThinking: boolean;
	thinkingBudget: number;
}) {
	if (!options.enableThinking) return undefined;
	if (supportsPoloAIAdaptiveThinking(options.model)) {
		return { type: "adaptive" as const };
	}
	return { type: "enabled" as const, budget_tokens: options.thinkingBudget };
}

function selectPoloAIWebSearchToolType(model: string) {
	if (model.startsWith("claude-opus-4-6") || model.startsWith("claude-sonnet-4-6")) {
		return POLOAI_WEB_SEARCH_TOOL_LATEST_TYPE;
	}
	return POLOAI_WEB_SEARCH_TOOL_LEGACY_TYPE;
}

function shouldRetryWithLegacyPoloAIWebSearchTool(message: string) {
	const lowered = message.toLowerCase();
	return (
		lowered.includes(POLOAI_WEB_SEARCH_TOOL_LATEST_TYPE) ||
		(lowered.includes("web_search") &&
			(lowered.includes("invalid") ||
				lowered.includes("unsupported") ||
				lowered.includes("unknown"))) ||
		(lowered.includes("code_execution") && lowered.includes("web_search"))
	);
}

function shouldEnablePoloAIInterleavedThinkingBeta(body: Record<string, unknown>) {
	const model =
		typeof body.model === "string"
			? body.model
			: "";
	const thinking = body.thinking as { type?: string } | undefined;
	const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
	return (
		hasTools &&
		Boolean(thinking) &&
		(thinking?.type === "enabled" || thinking?.type === "adaptive") &&
		(model.startsWith("claude-opus-4") || model.startsWith("claude-sonnet-4"))
	);
}

const POLOAI_LOCAL_TOOLS = [
	{
		name: "get_time",
		description: "Get the current time in UTC or in a specific IANA time zone.",
		input_schema: {
			type: "object",
			properties: {
				time_zone: {
					type: "string",
					description: "IANA time zone, e.g. Asia/Shanghai.",
				},
			},
		},
		handler: async (input: any) => {
			const now = new Date();
			const payload: Record<string, unknown> = {
				iso_utc: now.toISOString(),
				unix_ms: now.getTime(),
			};
			const timeZone = typeof input?.time_zone === "string" ? input.time_zone : null;
			if (timeZone) {
				try {
					const formatter = new Intl.DateTimeFormat("sv-SE", {
						timeZone,
						year: "numeric",
						month: "2-digit",
						day: "2-digit",
						hour: "2-digit",
						minute: "2-digit",
						second: "2-digit",
						hour12: false,
					});
					payload.local = formatter.format(now).replace(" ", "T");
					payload.time_zone = timeZone;
				} catch {
					payload.time_zone_error = "Invalid time zone";
				}
			}
			return JSON.stringify(payload);
		},
	},
	{
		name: "calculate",
		description: "Evaluate a basic math expression with + - * / and parentheses.",
		input_schema: {
			type: "object",
			properties: {
				expression: {
					type: "string",
					description: "Math expression, e.g. (12 + 8) / 4",
				},
			},
			required: ["expression"],
		},
		handler: async (input: any) => {
			const expression =
				typeof input?.expression === "string" ? input.expression.trim() : "";
			const result = evaluateMathExpression(expression);
			if (!Number.isFinite(result)) {
				throw new Error("Invalid expression result");
			}
			return JSON.stringify({ expression, result });
		},
	},
];

function buildPoloAITools(options: {
	model: string;
	webSearch: boolean;
	enableTools: boolean;
	forceLegacyWebSearchTool?: boolean;
}): {
	tools: Array<Record<string, unknown>>;
	localToolNames: Set<string>;
	webSearchToolType?: string;
} {
	const tools: Array<Record<string, unknown>> = [];
	const localToolNames = new Set<string>();
	const webSearchToolType = options.forceLegacyWebSearchTool
		? POLOAI_WEB_SEARCH_TOOL_LEGACY_TYPE
		: selectPoloAIWebSearchToolType(options.model);

	if (options.webSearch) {
		tools.push({ type: webSearchToolType, name: POLOAI_WEB_SEARCH_TOOL_NAME });
		// Some vendors proxy Claude server tools as plain tool_use events; enable local fallback execution.
		localToolNames.add(POLOAI_WEB_SEARCH_TOOL_NAME);
	}

	if (options.enableTools) {
		for (const tool of POLOAI_LOCAL_TOOLS) {
			tools.push({
				name: tool.name,
				description: tool.description,
				input_schema: tool.input_schema,
			});
			localToolNames.add(tool.name);
		}
	}

	return {
		tools,
		localToolNames,
		webSearchToolType: options.webSearch ? webSearchToolType : undefined,
	};
}

function buildPoloAIMessages(messages: LLMMessage[]) {
	return messages.map((message) => {
		const attachments = (message.attachments ?? []).filter((item) => item.data);
		if (!attachments.length) {
			return { role: message.role, content: message.content };
		}
		const blocks: Array<Record<string, unknown>> = [];
		if (message.content.trim()) {
			blocks.push({ type: "text", text: message.content });
		}
		for (const attachment of attachments) {
			if (!attachment?.data) continue;
			if (attachment.mimeType.startsWith("image/")) {
				blocks.push({
					type: "image",
					source: {
						type: "base64",
						media_type: attachment.mimeType,
						data: attachment.data,
					},
				});
				continue;
			}
			if (attachment.mimeType === "application/pdf") {
				blocks.push({
					type: "document",
					source: {
						type: "base64",
						media_type: attachment.mimeType,
						data: attachment.data,
					},
				});
			}
		}
		return { role: message.role, content: blocks.length ? blocks : message.content };
	});
}

function decodeHtmlEntities(value: string) {
	const named: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: "\"",
		apos: "'",
		"#39": "'",
	};
	return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
		const key = entity.toLowerCase();
		if (named[key]) return named[key];
		if (key.startsWith("#x")) {
			const parsed = Number.parseInt(key.slice(2), 16);
			return Number.isFinite(parsed) ? String.fromCharCode(parsed) : _;
		}
		if (key.startsWith("#")) {
			const parsed = Number.parseInt(key.slice(1), 10);
			return Number.isFinite(parsed) ? String.fromCharCode(parsed) : _;
		}
		return _;
	});
}

function stripHtml(text: string) {
	return decodeHtmlEntities(text).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function normalizeDuckDuckGoResultUrl(rawHref: string) {
	const decoded = decodeHtmlEntities(rawHref).trim();
	if (!decoded) return null;
	const withScheme = decoded.startsWith("//") ? `https:${decoded}` : decoded;
	try {
		const parsed = new URL(withScheme, "https://duckduckgo.com");
		if (
			parsed.hostname.includes("duckduckgo.com") &&
			parsed.pathname === "/l/" &&
			parsed.searchParams.get("uddg")
		) {
			const target = decodeURIComponent(parsed.searchParams.get("uddg") || "");
			if (/^https?:\/\//i.test(target)) {
				return target;
			}
		}
		if (/^https?:$/i.test(parsed.protocol)) {
			return parsed.toString();
		}
	} catch {
		// Ignore invalid URLs from scraping.
	}
	return null;
}

function parseDuckDuckGoHtmlResults(html: string, limit: number) {
	const results: Array<{ title: string; url: string; snippet?: string }> = [];
	const anchorPattern =
		/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	let match: RegExpExecArray | null;
	while ((match = anchorPattern.exec(html)) !== null && results.length < limit) {
		const href = normalizeDuckDuckGoResultUrl(match[1] || "");
		if (!href) continue;
		const title = stripHtml(match[2] || "");
		if (!title) continue;
		const preview = html.slice(anchorPattern.lastIndex, anchorPattern.lastIndex + 900);
		const snippetMatch =
			preview.match(
				/<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i,
			) ?? undefined;
		const snippet = snippetMatch?.[1] ? stripHtml(snippetMatch[1]) : undefined;
		results.push({ title, url: href, snippet });
	}
	return results;
}

function resolveWebSearchQuery(input: unknown) {
	if (typeof input === "string") return input.trim();
	if (!input || typeof input !== "object") return "";
	const object = input as Record<string, unknown>;
	const candidates = [
		object.query,
		object.q,
		object.search_query,
		object.searchTerm,
		object.search_term,
		object.searchText,
		object.search_text,
		object.keyword,
		object.keywords,
	];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim()) {
			return candidate.trim();
		}
	}
	return "";
}

function resolveWebSearchLimit(input: unknown) {
	if (!input || typeof input !== "object") return 5;
	const value = (input as Record<string, unknown>).max_results;
	if (typeof value !== "number" || !Number.isFinite(value)) return 5;
	return Math.max(1, Math.min(8, Math.floor(value)));
}

async function runPoloAIWebSearchFallback(input: unknown) {
	const query = resolveWebSearchQuery(input);
	if (!query) {
		throw new Error("web_search requires a query");
	}
	const limit = resolveWebSearchLimit(input);
	const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`web_search fallback failed: ${response.status}`);
	}
	const html = await response.text();
	const results = parseDuckDuckGoHtmlResults(html, limit);
	return JSON.stringify({
		query,
		provider: "duckduckgo",
		results,
	});
}

async function runPoloAITools(toolUses: PoloAIToolUse[]): Promise<PoloAIToolResult[]> {
	const results: PoloAIToolResult[] = [];
	for (const toolUse of toolUses) {
		if (toolUse.name === POLOAI_WEB_SEARCH_TOOL_NAME) {
			try {
				const output = await runPoloAIWebSearchFallback(toolUse.input);
				results.push({ id: toolUse.id, content: output });
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "web_search fallback failed";
				results.push({ id: toolUse.id, content: message, isError: true });
			}
			continue;
		}

		const tool = POLOAI_LOCAL_TOOLS.find((entry) => entry.name === toolUse.name);
		if (!tool) {
			results.push({
				id: toolUse.id,
				content: `Unknown tool: ${toolUse.name}`,
				isError: true,
			});
			continue;
		}
		try {
			const output = await tool.handler(toolUse.input ?? {});
			results.push({ id: toolUse.id, content: output });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Tool execution failed";
			results.push({ id: toolUse.id, content: message, isError: true });
		}
	}
	return results;
}

function parseClaudeContentBlocks(payload: any): Array<Record<string, any>> {
	if (Array.isArray(payload?.content)) return payload.content;
	if (Array.isArray(payload?.message?.content)) return payload.message.content;
	const choice = payload?.choices?.[0];
	if (Array.isArray(choice?.message?.content)) return choice.message.content;
	return [];
}

function extractClaudeSearchFromBlocks(blocks: Array<Record<string, any>>) {
	const results: Array<{
		title?: string;
		url?: string;
		pageAge?: string;
	}> = [];
	const citations = new Set<string>();

	for (const block of blocks) {
		if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
			for (const item of block.content) {
				if (item?.type === "web_search_result") {
					results.push({
						title: item.title,
						url: item.url,
						pageAge: item.page_age,
					});
				}
			}
		}
		if (Array.isArray(block?.citations)) {
			for (const citation of block.citations) {
				const url =
					typeof citation === "string"
						? citation
						: typeof citation?.url === "string"
							? citation.url
							: null;
				if (url) citations.add(url);
			}
		}
	}

	if (results.length === 0 && citations.size === 0) {
		return undefined;
	}

	return {
		provider: "claude" as const,
		results: results.map((result, index) => ({
			id: `${index}`,
			title: result.title,
			url: result.url,
			pageAge: result.pageAge,
		})),
		citations: Array.from(citations),
	};
}

type SearchResult = NonNullable<
	NonNullable<LLMStreamEvent["search"]>["results"]
>[number];

function mergeSearchMeta(
	base: LLMStreamEvent["search"] | undefined,
	next: LLMStreamEvent["search"] | undefined,
) {
	if (!next) return base;
	if (!base) return next;
	const citations = new Set<string>([
		...(base.citations || []),
		...(next.citations || []),
	]);
	const resultsMap = new Map<string, SearchResult>();
	for (const result of base.results || []) {
		const key = result.url || result.title || result.text || result.id || "";
		if (!key) continue;
		resultsMap.set(key, result);
	}
	for (const result of next.results || []) {
		const key = result.url || result.title || result.text || result.id || "";
		if (!key) continue;
		resultsMap.set(key, result);
	}
	return {
		provider: next.provider || base.provider,
		query: next.query || base.query,
		results: Array.from(resultsMap.values()),
		citations: Array.from(citations),
	};
}

function extractSearchMetaFromToolResults(
	toolUses: PoloAIToolUse[],
	toolResults: PoloAIToolResult[],
): LLMStreamEvent["search"] | undefined {
	const toolNameById = new Map<string, string>();
	for (const toolUse of toolUses) {
		toolNameById.set(toolUse.id, toolUse.name);
	}

	const aggregated: SearchResult[] = [];
	const citations = new Set<string>();
	let query: string | undefined;

	for (const toolResult of toolResults) {
		if (toolResult.isError) continue;
		if (toolNameById.get(toolResult.id) !== POLOAI_WEB_SEARCH_TOOL_NAME) continue;
		try {
			const payload = JSON.parse(toolResult.content) as {
				query?: unknown;
				results?: Array<{
					title?: unknown;
					url?: unknown;
					snippet?: unknown;
				}>;
			};
			if (typeof payload.query === "string" && payload.query.trim()) {
				query = payload.query.trim();
			}
			for (const entry of payload.results || []) {
				const url = typeof entry?.url === "string" ? entry.url : undefined;
				const title = typeof entry?.title === "string" ? entry.title : undefined;
				const text = typeof entry?.snippet === "string" ? entry.snippet : undefined;
				if (!url && !title && !text) continue;
				if (url) citations.add(url);
				aggregated.push({
					id: `${aggregated.length}`,
					title,
					url,
					text,
				});
			}
		} catch {
			// Ignore non-JSON tool payloads.
		}
	}

	if (aggregated.length === 0 && citations.size === 0) {
		return undefined;
	}

	return {
		provider: "claude",
		query,
		results: aggregated,
		citations: Array.from(citations),
	};
}

async function runPoloAIStreamRequest(options: {
	apiKey: string;
	messages: Array<{ role: string; content: unknown }>;
	baseBody: Record<string, unknown>;
	localToolNames: Set<string>;
	writeEvent: (event: LLMStreamEvent) => Promise<void>;
}): Promise<{ toolUses: PoloAIToolUse[]; searchMeta?: LLMStreamEvent["search"] }> {
	const emitStopReason = createStopReasonEmitter(options.writeEvent);
	const headers: Record<string, string> = {
		Accept: "application/json",
		"Content-Type": "application/json",
		Authorization: options.apiKey,
		"anthropic-version": "2023-06-01",
	};
	if (shouldEnablePoloAIInterleavedThinkingBeta(options.baseBody)) {
		headers["anthropic-beta"] = POLOAI_INTERLEAVED_THINKING_BETA;
	}

	const response = await fetch("https://poloai.top/v1/messages", {
		method: "POST",
		headers,
		body: JSON.stringify({
			...options.baseBody,
			messages: options.messages,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`PoloAI API error: ${response.status} - ${errorText}`);
	}

	const contentType = response.headers.get("Content-Type") || "";
	if (!contentType.includes("text/event-stream")) {
		const data = (await response.json()) as any;
		const blocks = parseClaudeContentBlocks(data);
		const searchMeta = extractClaudeSearchFromBlocks(blocks);
		await emitStopReason(extractPoloAIStopReason(data));

		const toolUses = blocks
			.filter((block) => block?.type === "tool_use")
			.map((block) => ({
				id: block.id,
				name: block.name,
				input: block.input,
			}))
			.filter((toolUse) => options.localToolNames.has(toolUse.name));

		const reasoning = extractPoloAIReasoning(data);
		if (reasoning) {
			await options.writeEvent({ type: "reasoning", content: reasoning });
		}

		const content = extractPoloAIContent(data);
		if (content) {
			await options.writeEvent({ type: "delta", content });
		}

		const usage = normalizeUsage(data?.usage);
		if (usage) {
			await options.writeEvent({ type: "usage", usage });
		}

		return { toolUses, searchMeta };
	}

	const toolUsesByIndex = new Map<number, PoloAIToolUse>();
	const citations = new Set<string>();
	const searchResults: Array<{
		title?: string;
		url?: string;
		pageAge?: string;
	}> = [];

	await processSSEStream(response, async (parsed) => {
		if (parsed?.error?.message) {
			throw new Error(parsed.error.message);
		}
		let wroteTextDelta = false;
		let wroteReasoningDelta = false;
		let wroteUsage = false;
		await emitStopReason(
			extractPoloAIStopReason(parsed) ??
				(parsed?.type === "message_stop" ? "message_stop" : undefined),
		);

		if (parsed?.type === "content_block_start") {
			const block = parsed.content_block;
			if (block?.type === "tool_use") {
				toolUsesByIndex.set(parsed.index, {
					id: block.id,
					name: block.name,
					input: block.input,
					inputJson: "",
				});
			}
			if (block?.type === "text" && typeof block.text === "string") {
				await options.writeEvent({ type: "delta", content: block.text });
				wroteTextDelta = true;
			}
			if (block?.type === "thinking" && typeof block.thinking === "string") {
				await options.writeEvent({ type: "reasoning", content: block.thinking });
				wroteReasoningDelta = true;
			}
			if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
				for (const item of block.content) {
					if (item?.type === "web_search_result") {
						searchResults.push({
							title: item.title,
							url: item.url,
							pageAge: item.page_age,
						});
					}
				}
			}
			if (Array.isArray(block?.citations)) {
				for (const citation of block.citations) {
					const url =
						typeof citation === "string"
							? citation
							: typeof citation?.url === "string"
								? citation.url
								: null;
					if (url) citations.add(url);
				}
			}
		}

		if (parsed?.type === "content_block_delta") {
			const delta = parsed.delta;
			if (delta?.type === "text_delta" && typeof delta.text === "string") {
				await options.writeEvent({ type: "delta", content: delta.text });
				wroteTextDelta = true;
			}
			if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
				await options.writeEvent({ type: "reasoning", content: delta.thinking });
				wroteReasoningDelta = true;
			}
			if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
				const entry = toolUsesByIndex.get(parsed.index);
				if (entry) {
					entry.inputJson = `${entry.inputJson ?? ""}${delta.partial_json}`;
				}
			}
			if (Array.isArray(delta?.citations)) {
				for (const citation of delta.citations) {
					const url =
						typeof citation === "string"
							? citation
							: typeof citation?.url === "string"
								? citation.url
								: null;
					if (url) citations.add(url);
				}
			}
		}

		if (parsed?.type === "content_block_stop") {
			const entry = toolUsesByIndex.get(parsed.index);
			if (entry && entry.input === undefined && entry.inputJson) {
				try {
					entry.input = JSON.parse(entry.inputJson);
				} catch {
					entry.input = entry.inputJson;
				}
			}
		}

		if (parsed?.type === "message_delta") {
			const usage = normalizeUsage(parsed?.usage);
			if (usage) {
				await options.writeEvent({ type: "usage", usage });
				wroteUsage = true;
			}
		}

		// PoloAI may proxy some Claude models as OpenAI-style SSE chunks.
		if (!wroteTextDelta) {
			const fallbackContent = extractPoloAIContent(parsed);
			if (typeof fallbackContent === "string" && fallbackContent.length > 0) {
				await options.writeEvent({ type: "delta", content: fallbackContent });
			}
		}
		if (!wroteReasoningDelta) {
			const fallbackReasoning = extractPoloAIReasoning(parsed);
			if (typeof fallbackReasoning === "string" && fallbackReasoning.length > 0) {
				await options.writeEvent({ type: "reasoning", content: fallbackReasoning });
			}
		}
		if (!wroteUsage) {
			const fallbackUsage = normalizeUsage(parsed?.usage ?? parsed?.message?.usage);
			if (fallbackUsage) {
				await options.writeEvent({ type: "usage", usage: fallbackUsage });
			}
		}
	});

	for (const entry of toolUsesByIndex.values()) {
		if (entry.input === undefined && entry.inputJson) {
			try {
				entry.input = JSON.parse(entry.inputJson);
			} catch {
				entry.input = entry.inputJson;
			}
		}
	}

	const toolUses = Array.from(toolUsesByIndex.values()).filter((toolUse) =>
		options.localToolNames.has(toolUse.name),
	);
	const searchMeta =
		searchResults.length > 0 || citations.size > 0
			? {
					provider: "claude" as const,
					results: searchResults.map((result, index) => ({
						id: `${index}`,
						title: result.title,
						url: result.url,
						pageAge: result.pageAge,
					})),
					citations: Array.from(citations),
				}
			: undefined;

	return { toolUses, searchMeta };
}

async function maybeInjectXSearch(
	messages: LLMMessage[],
	context: AppLoadContext,
): Promise<{ messages: LLMMessage[]; searchMeta?: LLMStreamEvent["search"] }> {
	const env = context.cloudflare.env;
	const apiKey = env.X_API_BEARER || env.XAI_API_KEY;
	const lastUserMessage = [...messages].reverse().find((msg) => msg.role === "user");

	if (!apiKey || !lastUserMessage) {
		return { messages };
	}

	const query = lastUserMessage.content.slice(0, 256);
	const results = await fetchXSearchResults(apiKey, query);
	if (results.length === 0) {
		return { messages };
	}

	const summaryLines = results.map((result) => {
		const prefix = result.author ? `@${result.author}: ` : "";
		const text = result.text.length > 240 ? `${result.text.slice(0, 240)}...` : result.text;
		return `- ${prefix}${text}`;
	});

	const systemMessage: LLMMessage = {
		role: "system",
		content: `X search results (recent):\n${summaryLines.join("\n")}`,
	};

	return {
		messages: [systemMessage, ...messages],
		searchMeta: {
			provider: "x",
			query,
			results,
		},
	};
}

function formatUserFacingError(message: string) {
	const lowered = message.toLowerCase();
	if (lowered.includes("api key")) {
		return "模型密钥未配置或无效。";
	}
	if (lowered.includes("rate limit")) {
		return "请求过于频繁，请稍后再试。";
	}
	return "上游服务暂时不可用，请稍后再试。";
}

async function fetchXSearchResults(apiKey: string, query: string) {
	const url = new URL("https://api.x.com/2/tweets/search/recent");
	url.searchParams.set("query", query);
	url.searchParams.set("max_results", "5");
	url.searchParams.set("tweet.fields", "author_id,created_at");
	url.searchParams.set("expansions", "author_id");
	url.searchParams.set("user.fields", "username,name");

	const response = await fetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});

	if (!response.ok) {
		return [];
	}

	const data = (await response.json()) as {
		data?: Array<{ id: string; text: string; author_id?: string; created_at?: string }>;
		includes?: { users?: Array<{ id: string; username?: string; name?: string }> };
	};

	const usersById = new Map(
		(data.includes?.users || []).map((user) => [user.id, user.username || user.name || ""]),
	);

	return (data.data || []).map((tweet) => ({
		id: tweet.id,
		author: tweet.author_id ? usersById.get(tweet.author_id) : undefined,
		text: tweet.text,
		createdAt: tweet.created_at,
		url: `https://x.com/i/web/status/${tweet.id}`,
	}));
}

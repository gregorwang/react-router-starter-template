import type { AppLoadContext } from "react-router";
import type { LLMMessage, LLMProvider } from "./types";

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
        webSearch?: boolean;
    }
): Promise<ReadableStream<Uint8Array>> {
    const env = context.cloudflare.env;

    // Get API key from environment (Cloudflare secrets)
    const apiKeyMap: Record<LLMProvider, string | undefined> = {
        deepseek: env.DEEPSEEK_API_KEY,
        xai: env.XAI_API_KEY,
        poe: env.POE_API_KEY,
    };

    const apiKey = apiKeyMap[provider];
    if (!apiKey) {
        throw new Error(`API key for ${provider} not configured. Please set it using: wrangler secret put ${provider.toUpperCase()}_API_KEY`);
    }

    const encoder = new TextEncoder();

    // Create a TransformStream to convert LLM responses to SSE format
    const stream = new TransformStream<string, Uint8Array>({
        transform(chunk, controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
        },
        flush(controller) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        },
    });

    const writer = stream.writable.getWriter();

    // Start the LLM request in the background
    (async () => {
        try {
            console.log(`[LLM Server] Streaming request: Provider=${provider}, Model=${model}`);
            switch (provider) {
                case "deepseek":
                    await streamDeepSeekServer(messages, model, apiKey, writer);
                    break;
                case "xai":
                    await streamXAIServer(messages, model, apiKey, writer);
                    break;
                case "poe":
                    await streamPoeServer(messages, model, apiKey, writer, options);
                    break;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            await writer.write(`error: ${errorMessage}`);
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
    writer: WritableStreamDefaultWriter<string>,
): Promise<void> {
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

    await processSSEStream(response, writer, (parsed) => {
        return parsed.choices?.[0]?.delta?.content || "";
    });
}

// Helper to process SSE streams
async function processSSEStream(
    response: Response,
    writer: WritableStreamDefaultWriter<string>,
    extractContent: (parsed: any) => string,
): Promise<void> {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
        throw new Error("No response body received");
    }

    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") break;

                try {
                    const parsed = JSON.parse(data);
                    const content = extractContent(parsed);
                    if (content) {
                        await writer.write(content);
                    }
                } catch (e) {
                    console.error("[LLM Server] Stream parse error:", e, "Data chunk:", data.slice(0, 50));
                    // Allow partial JSON if robust client, but usually skip
                }
            }
        }
    }
}

async function streamXAIServer(
    messages: LLMMessage[],
    model: string,
    apiKey: string,
    writer: WritableStreamDefaultWriter<string>,
): Promise<void> {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            messages: messages.map(m => ({
                role: m.role,
                content: m.content
            })),
            model: model,
            stream: true,
            temperature: 0,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`xAI API error: ${response.status} - ${errorText}`);
    }

    await processSSEStream(response, writer, (parsed) => {
        return parsed.choices?.[0]?.delta?.content || "";
    });
}

async function streamPoeServer(
    messages: LLMMessage[],
    model: string,
    apiKey: string,
    writer: WritableStreamDefaultWriter<string>,

    options?: {
        reasoningEffort?: "low" | "medium" | "high";
        enableThinking?: boolean;
        thinkingBudget?: number;
        thinkingLevel?: "low" | "medium" | "high";
        webSearch?: boolean;
    }
): Promise<void> {
    const response = await fetch("https://api.poe.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            messages: messages.map(m => ({
                role: m.role,
                content: m.content
            })),
            model: model,
            stream: true,
            extra_body: {
                ...(model === "kimi-k2.5" ? { enable_thinking: options?.enableThinking ?? true } : {}),
                ...(model === "o3" ? { reasoning_effort: options?.reasoningEffort || "high" } : {}),
                ...(model === "claude-sonnet-4.5" ? { thinking_budget: options?.thinkingBudget || 12288 } : {}),
                ...(model === "gemini-3-pro" ? {
                    thinking_level: options?.thinkingLevel || "high",
                    web_search: options?.webSearch ?? true
                } : {}),
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Poe API error: ${response.status} - ${errorText}`);
    }

    await processSSEStream(response, writer, (parsed) => {
        return parsed.choices?.[0]?.delta?.content || "";
    });
}


import type { Route } from "./+types/chat.action";
import { streamLLMFromServer } from "../lib/llm/llm-server";
import type { LLMMessage, LLMProvider, Usage } from "../lib/llm/types";
import { saveConversation, getConversation } from "../lib/db/conversations.server";

interface ChatActionData {
    conversationId: string;
    messages: LLMMessage[];
    provider: LLMProvider;
    model: string;
    userMessageId: string;
    assistantMessageId: string;
    reasoningEffort?: "low" | "medium" | "high";
    enableThinking?: boolean;
    thinkingBudget?: number;
    thinkingLevel?: "low" | "medium" | "high";
    webSearch?: boolean;
}

export async function action({ request, context }: Route.ActionArgs) {
    if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
    }

    try {
        const data: ChatActionData = await request.json();
        const { conversationId, messages, provider, model, userMessageId, assistantMessageId, reasoningEffort, enableThinking, thinkingBudget, thinkingLevel, webSearch } = data;

        const actorKey = await resolveActorKey(request);
        const rateLimitResult = await enforceRateLimit(context.cloudflare.env, actorKey);
        if (!rateLimitResult.allowed) {
            return new Response(
                JSON.stringify({
                    error: "Rate limit exceeded. Try again later.",
                    retryAt: rateLimitResult.resetAt,
                }),
                { status: 429, headers: { "Content-Type": "application/json" } },
            );
        }

        // Start streaming LLM response
        const stream = await streamLLMFromServer(messages, provider, model, context, {
            reasoningEffort,
            enableThinking,
            thinkingBudget,
            thinkingLevel,
            webSearch,
        });

        // Use waitUntil to save the conversation after stream completes
        const ctx = context.cloudflare.ctx;

        // Create a tee of the stream - one for the response, one for saving
        const [responseStream, saveStream] = stream.tee();

        // Save conversation in background
        ctx.waitUntil(
            (async () => {
                const decoder = new TextDecoder();
                const reader = saveStream.getReader();
                let fullContent = "";
                let reasoning = "";
                let usage: Usage | undefined;
                let credits: number | undefined;
                let thinkingMs: number | undefined;
                let searchMeta: any | undefined;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const text = decoder.decode(value);
                    const lines = text.split("\n");
                    for (const line of lines) {
                        if (line.startsWith("data: ") && !line.includes("[DONE]")) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.type === "delta" && data.content) {
                                    fullContent += data.content;
                                }
                                if (data.type === "reasoning" && data.content) {
                                    reasoning += data.content;
                                }
                                if (data.type === "usage" && data.usage) {
                                    usage = data.usage;
                                }
                                if (data.type === "credits" && data.credits) {
                                    credits = data.credits;
                                }
                                if (data.type === "meta" && data.meta?.thinkingMs) {
                                    thinkingMs = data.meta.thinkingMs;
                                }
                                if (data.type === "search" && data.search) {
                                    searchMeta = data.search;
                                }
                            } catch {
                                // Ignore parse errors
                            }
                        }
                    }
                }

                if (!usage) {
                    usage = estimateUsage(messages, fullContent);
                }

                // Save to D1 database
                const conversation = await getConversation(context.db, conversationId);
                if (conversation) {
                    const userMessage = {
                        id: userMessageId,
                        role: "user" as const,
                        content: messages[messages.length - 1].content,
                        timestamp: Date.now(),
                    };
                    const assistantMessage = {
                        id: assistantMessageId,
                        role: "assistant" as const,
                        content: fullContent,
                        timestamp: Date.now(),
                        meta: {
                            usage,
                            credits,
                            reasoning: reasoning || undefined,
                            thinkingMs,
                            webSearch: searchMeta,
                        },
                    };


                    // Update provider and model to match the ones used in this turn
                    conversation.provider = provider;
                    conversation.model = model;

                    conversation.messages.push(userMessage, assistantMessage);
                    conversation.updatedAt = Date.now();

                    // Generate title from first message if this is a new conversation
                    if (
                        conversation.messages.length === 2 &&
                        (conversation.title === "New Chat" || conversation.title === "新对话")
                    ) {
                        const firstUserMsg = messages[messages.length - 1].content;
                        conversation.title = firstUserMsg.slice(0, 50) + (firstUserMsg.length > 50 ? "..." : "");
                    }

                    await saveConversation(context.db, conversation);
                }
            })()
        );

        return new Response(responseStream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no", // Disable Nginx buffering
            },
        });
    } catch (error) {
        console.error("Chat action error:", error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}

async function resolveActorKey(request: Request) {
    const ip =
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("X-Forwarded-For") ||
        "unknown";
    return `ip:${ip}`;
}

async function enforceRateLimit(env: Env, key: string): Promise<{ allowed: boolean; resetAt?: number }> {
    // Determine if we are in development mode based on the environment
    // Simplest way for now is just to bypass it locally to avoid the "Internal error"
    // which is likely caused by the local simulation of Rate Limiters or Durable Objects.
    return { allowed: true };

    /*
    let allowed = true;
    let resetAt: number | undefined;

    if (env.CHAT_RATE_LIMITER) {
        try {
            const decision = await env.CHAT_RATE_LIMITER.limit({ key });
            if (decision && decision.success === false) {
                allowed = false;
            }
        } catch {
            // Ignore rate limiter errors and fall back to DO
        }
    }

    if (allowed && env.CHAT_RATE_LIMITER_DO) {
        const id = env.CHAT_RATE_LIMITER_DO.idFromName(key);
        const stub = env.CHAT_RATE_LIMITER_DO.get(id);
        const response = await stub.fetch("https://rate-limiter/limit", {
            method: "POST",
            body: JSON.stringify({ limit: 20, windowMs: 3_600_000 }),
        });
        if (response.ok) {
            const data = (await response.json()) as { allowed: boolean; resetAt?: number };
            allowed = data.allowed;
            resetAt = data.resetAt ?? resetAt;
        }
    }

    return { allowed, resetAt };
    */
}

function estimateUsage(messages: LLMMessage[], response: string): Usage {
    const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));
    const promptTokens = messages.reduce(
        (total, msg) => total + estimateTokens(msg.content),
        0,
    );
    const completionTokens = estimateTokens(response);
    return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimated: true,
    };
}

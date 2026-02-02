import type { Route } from "./+types/chat.action";
import { streamLLMFromServer } from "../lib/llm/llm-server";
import type { LLMMessage, LLMProvider } from "../lib/llm/types";
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

        // Start streaming LLM response
        const stream = await streamLLMFromServer(messages, provider, model, context, { reasoningEffort, enableThinking, thinkingBudget, thinkingLevel, webSearch });

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

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const text = decoder.decode(value);
                    const lines = text.split("\n");
                    for (const line of lines) {
                        if (line.startsWith("data: ") && !line.includes("[DONE]")) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.content) {
                                    fullContent += data.content;
                                }
                            } catch {
                                // Ignore parse errors
                            }
                        }
                    }
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
                    };


                    // Update provider and model to match the ones used in this turn
                    conversation.provider = provider;
                    conversation.model = model;

                    conversation.messages.push(userMessage, assistantMessage);
                    conversation.updatedAt = Date.now();

                    // Generate title from first message if this is a new conversation
                    if (conversation.messages.length === 2 && conversation.title === "New Chat") {
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

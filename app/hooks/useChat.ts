import { useCallback, useRef } from "react";
import { useChat as useChatContext } from "../contexts/ChatContext";

import type { Message } from "../lib/llm/types";

export function useChat() {
	const {
		currentConversation,
		startConversation: startConv,
		addMessage: addMsg,
		updateLastMessage: updateMsg,
		setLoading,
		setStreaming,
	} = useChatContext();

	const abortControllerRef = useRef<AbortController | null>(null);

	const startConversation = useCallback(() => {
		startConv();
	}, [startConv]);

	const sendMessage = useCallback(
		async (content: string) => {
			if (!currentConversation) {
				startConversation();
				return;
			}

			setLoading(true);
			setStreaming(true);

			// Create message IDs upfront
			const userMessageId = crypto.randomUUID();
			const assistantMessageId = crypto.randomUUID();

			// Add user message
			const userMessage: Message = {
				id: userMessageId,
				role: "user",
				content,
				timestamp: Date.now(),
			};
			addMsg(userMessage);

			// Create empty assistant message
			const assistantMessage: Message = {
				id: assistantMessageId,
				role: "assistant",
				content: "",
				timestamp: Date.now(),
			};
			addMsg(assistantMessage);

			// Create abort controller for this request
			abortControllerRef.current = new AbortController();

			try {
				// Prepare messages for LLM (exclude the empty assistant message we just added)
				const messages = currentConversation.messages
					.concat([userMessage])
					.map((msg) => ({
						role: msg.role,
						content: msg.content,
					}));

				// Call the server action instead of client-side LLM APIs
				console.log("[useChat] Sending message with:", {
					provider: currentConversation.provider,
					model: currentConversation.model,
					id: currentConversation.id
				});
				const response = await fetch("/chat/action", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						conversationId: currentConversation.id,
						messages,
						provider: currentConversation.provider,
						model: currentConversation.model,
						userMessageId,
						assistantMessageId,
						reasoningEffort: currentConversation.reasoningEffort,
						enableThinking: currentConversation.enableThinking,
						thinkingBudget: currentConversation.thinkingBudget,
						thinkingLevel: currentConversation.thinkingLevel,
						webSearch: currentConversation.webSearch,
					}),
					signal: abortControllerRef.current.signal,
				});

				if (!response.ok) {
					const error = await response.json();
					throw new Error(error.error || `Server error: ${response.status}`);
				}

				// Process the SSE stream
				const reader = response.body?.getReader();
				const decoder = new TextDecoder();

				if (!reader) {
					throw new Error("No response body received");
				}

				let fullContent = "";
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
								if (parsed.content) {
									fullContent += parsed.content;
									updateMsg(fullContent);
								}
							} catch {
								// Ignore parse errors
							}
						}
					}
				}
			} catch (error) {
				if ((error as Error).name === "AbortError") {
					console.log("Request aborted");
				} else {
					console.error("Error sending message:", error);
					throw error;
				}
			} finally {
				setLoading(false);
				setStreaming(false);
				abortControllerRef.current = null;
			}
		},
		[currentConversation, startConversation, addMsg, updateMsg, setLoading, setStreaming],
	);

	const abortGeneration = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}
	}, []);

	return {
		currentConversation,
		sendMessage,
		abortGeneration,
		startConversation,
	};
}

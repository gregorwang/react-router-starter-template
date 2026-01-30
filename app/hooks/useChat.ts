import { useCallback, useRef, useState } from "react";
import { useChat as useChatContext } from "../contexts/ChatContext";
import { useSettings } from "../contexts/SettingsContext";
import { streamLLM } from "../lib/llm/client";
import type { Message } from "../lib/llm/types";
import { saveConversation } from "../lib/storage/conversation-store";

export function useChat() {
	const {
		currentConversation,
		startConversation: startConv,
		addMessage: addMsg,
		updateLastMessage: updateMsg,
		setLoading,
		setStreaming,
	} = useChatContext();
	const { settings } = useSettings();
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

			const provider = currentConversation.provider;
			const apiKey =
				settings[`${provider}ApiKey` as keyof typeof settings] as string;

			if (!apiKey) {
				throw new Error(`Please set your ${provider} API key in settings`);
			}

			setLoading(true);
			setStreaming(true);

			// Add user message
			const userMessage: Message = {
				id: crypto.randomUUID(),
				role: "user",
				content,
				timestamp: Date.now(),
			};
			addMsg(userMessage);

			// Create empty assistant message
			const assistantMessage: Message = {
				id: crypto.randomUUID(),
				role: "assistant",
				content: "",
				timestamp: Date.now(),
			};
			addMsg(assistantMessage);

			try {
				// Prepare messages for LLM
				const messages = currentConversation.messages
					.concat([userMessage])
					.map((msg) => ({
						role: msg.role,
						content: msg.content,
					}));

				// Stream response
				let fullContent = "";
				for await (const chunk of streamLLM(
					messages,
					provider,
					{
						apiKey,
						model: currentConversation.model,
					},
					{
						onChunk: (chunk) => {
							fullContent += chunk;
							updateMsg(fullContent);
						},
						onComplete: (content) => {
							// Save final state
							if (currentConversation) {
								const updated = {
									...currentConversation,
									messages: [
										...currentConversation.messages,
										userMessage,
										{ ...assistantMessage, content },
									],
									updatedAt: Date.now(),
								};
								saveConversation(updated);
							}
						},
						onError: (error) => {
							console.error("Stream error:", error);
						},
					},
				)) {
					fullContent += chunk;
					updateMsg(fullContent);
				}
			} catch (error) {
				console.error("Error sending message:", error);
				throw error;
			} finally {
				setLoading(false);
				setStreaming(false);
			}
		},
		[currentConversation, settings, startConversation, addMsg, updateMsg, setLoading, setStreaming],
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

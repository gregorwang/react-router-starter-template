import type { Message } from "../llm/types";

export const CONTEXT_CLEARED_EVENT_TYPE = "context_cleared" as const;

type BoundaryMessageLike = {
	role: string;
	meta?: {
		event?: {
			type?: string;
		};
	};
};

type TurnMessageLike = {
	role: string;
	content: string;
};

export function createContextClearedEventMessage(timestamp = Date.now()): Message {
	return {
		id: crypto.randomUUID(),
		role: "system",
		content: "—— 上下文已清除 ——",
		timestamp,
		meta: {
			event: {
				type: CONTEXT_CLEARED_EVENT_TYPE,
				at: timestamp,
			},
		},
	};
}

export function isContextClearedEventMessage(
	message: BoundaryMessageLike,
): boolean {
	return (
		message.role === "system" &&
		message.meta?.event?.type === CONTEXT_CLEARED_EVENT_TYPE
	);
}

export function getContextSegmentStartIndex(
	messages: BoundaryMessageLike[],
): number {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		if (isContextClearedEventMessage(messages[i])) {
			return i + 1;
		}
	}
	return 0;
}

export function getMessagesInActiveContext<T extends BoundaryMessageLike>(
	messages: T[],
): T[] {
	return messages.slice(getContextSegmentStartIndex(messages));
}

export function isChatTurnMessage<T extends TurnMessageLike>(
	message: T,
): message is T & { role: "user" | "assistant" } {
	return message.role === "user" || message.role === "assistant";
}

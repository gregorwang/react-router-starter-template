export interface SSEMessage {
	data: string;
	event?: string;
	id?: string;
	retry?: number;
}

type SSEMessageHandler = (
	message: SSEMessage,
) => void | boolean | Promise<void | boolean>;

type SSEJsonOptions = {
	doneToken?: string;
	onParseError?: (payload: string, error: unknown) => void | Promise<void>;
};

type SSEJsonHandler<T> = (
	parsed: T,
	payload: string,
) => void | boolean | Promise<void | boolean>;

export async function consumeSSE(
	stream: ReadableStream<Uint8Array>,
	onMessage: SSEMessageHandler,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let current = createSSEState();

	const flushEvent = async (): Promise<boolean> => {
		if (!hasSSEState(current)) {
			current = createSSEState();
			return true;
		}
		const shouldContinue = await onMessage({
			data: current.dataLines.join("\n"),
			event: current.event,
			id: current.id,
			retry: current.retry,
		});
		current = createSSEState();
		return shouldContinue !== false;
	};

	const consumeLine = async (line: string): Promise<boolean> => {
		if (line === "") {
			return flushEvent();
		}
		if (line.startsWith(":")) {
			return true;
		}

		const separator = line.indexOf(":");
		const field = separator === -1 ? line : line.slice(0, separator);
		let value = separator === -1 ? "" : line.slice(separator + 1);
		if (value.startsWith(" ")) value = value.slice(1);

		switch (field) {
			case "data":
				current.dataLines.push(value);
				break;
			case "event":
				current.event = value;
				break;
			case "id":
				current.id = value;
				break;
			case "retry": {
				const retry = Number(value);
				if (Number.isFinite(retry) && retry >= 0) {
					current.retry = retry;
				}
				break;
			}
			default:
				// Ignore unsupported SSE fields.
				break;
		}

		return true;
	};

	const drainBuffer = async (): Promise<boolean> => {
		let breakIndex = buffer.indexOf("\n");
		while (breakIndex !== -1) {
			let line = buffer.slice(0, breakIndex);
			if (line.endsWith("\r")) {
				line = line.slice(0, -1);
			}
			buffer = buffer.slice(breakIndex + 1);
			const shouldContinue = await consumeLine(line);
			if (!shouldContinue) return false;
			breakIndex = buffer.indexOf("\n");
		}
		return true;
	};

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const shouldContinue = await drainBuffer();
		if (!shouldContinue) {
			await reader.cancel();
			return;
		}
	}

	buffer += decoder.decode();
	const shouldContinue = await drainBuffer();
	if (!shouldContinue) return;
	if (buffer.length > 0) {
		const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
		const shouldContinueFinal = await consumeLine(line);
		if (!shouldContinueFinal) return;
		buffer = "";
	}
	const shouldContinueFlush = await flushEvent();
	if (!shouldContinueFlush) return;
}

export async function consumeSSEJson<T = unknown>(
	stream: ReadableStream<Uint8Array>,
	onParsed: SSEJsonHandler<T>,
	options?: SSEJsonOptions,
): Promise<void> {
	const doneToken = options?.doneToken ?? "[DONE]";
	await consumeSSE(stream, async ({ data }) => {
		const payload = data.trim();
		if (!payload) return true;
		if (payload === doneToken) return false;

		try {
			const parsed = JSON.parse(payload) as T;
			return (await onParsed(parsed, payload)) !== false;
		} catch (error) {
			if (options?.onParseError) {
				await options.onParseError(payload, error);
			}
		}
		return true;
	});
}

function createSSEState() {
	return {
		dataLines: [] as string[],
		event: undefined as string | undefined,
		id: undefined as string | undefined,
		retry: undefined as number | undefined,
	};
}

function hasSSEState(state: ReturnType<typeof createSSEState>) {
	return (
		state.dataLines.length > 0 ||
		state.event !== undefined ||
		state.id !== undefined ||
		state.retry !== undefined
	);
}

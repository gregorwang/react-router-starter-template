export function safeJsonParse<T>(
	input: string | null | undefined,
	fallback: T,
	context: string,
): T {
	if (typeof input !== "string" || input.trim() === "") {
		return fallback;
	}

	try {
		return JSON.parse(input) as T;
	} catch (error) {
		console.error("[safeJsonParse] Failed to parse JSON", {
			context,
			error: error instanceof Error ? error.message : String(error),
			preview: input.slice(0, 200),
		});
		return fallback;
	}
}

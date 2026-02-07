import { afterEach, describe, expect, it, vi } from "vitest";
import { safeJsonParse } from "./safe-json.server";

describe("safeJsonParse", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("parses valid JSON payload", () => {
		const parsed = safeJsonParse<{ id: string }>(
			'{"id":"abc"}',
			{ id: "fallback" },
			"safe-json-test",
		);
		expect(parsed).toEqual({ id: "abc" });
	});

	it("falls back and logs parse errors", () => {
		const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const fallback = { id: "fallback" };
		const parsed = safeJsonParse<{ id: string }>(
			"{invalid-json",
			fallback,
			"safe-json-invalid",
		);

		expect(parsed).toEqual(fallback);
		expect(logSpy).toHaveBeenCalledOnce();
	});

	it("returns fallback for nullish payloads", () => {
		const fallback = [1, 2, 3];
		expect(safeJsonParse<number[]>(undefined, fallback, "safe-json-empty")).toBe(
			fallback,
		);
		expect(safeJsonParse<number[]>(null, fallback, "safe-json-empty")).toBe(
			fallback,
		);
		expect(safeJsonParse<number[]>(" ", fallback, "safe-json-empty")).toBe(
			fallback,
		);
	});
});

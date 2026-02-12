import { describe, expect, it } from "vitest";
import { truncateTextForStorage } from "./chat-persistence.server";

describe("truncateTextForStorage", () => {
	it("returns original text when within limit", () => {
		const result = truncateTextForStorage("hello", 10);
		expect(result).toEqual({
			value: "hello",
			truncated: false,
			originalChars: 5,
		});
	});

	it("truncates text when above limit", () => {
		const result = truncateTextForStorage("abcdefghij", 4);
		expect(result).toEqual({
			value: "abcd",
			truncated: true,
			originalChars: 10,
		});
	});
});

import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "./types";

describe("PROVIDER_MODELS", () => {
	it("includes claude-sonnet-4-6-thinking for poloai", () => {
		expect(PROVIDER_MODELS.poloai).toContain("claude-sonnet-4-6-thinking");
	});
});

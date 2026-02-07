import { describe, expect, it } from "vitest";
import { resolveActorKey } from "./chat-rate-limit.server";

describe("resolveActorKey", () => {
	it("uses CF-Connecting-IP first", async () => {
		const request = new Request("https://example.com", {
			headers: {
				"CF-Connecting-IP": "1.2.3.4",
				"X-Forwarded-For": "5.6.7.8",
			},
		});
		await expect(resolveActorKey(request)).resolves.toBe("ip:1.2.3.4");
	});

	it("falls back to first X-Forwarded-For value", async () => {
		const request = new Request("https://example.com", {
			headers: {
				"X-Forwarded-For": "5.6.7.8, 9.9.9.9",
			},
		});
		await expect(resolveActorKey(request)).resolves.toBe("ip:5.6.7.8");
	});

	it("falls back to unknown when no IP headers", async () => {
		const request = new Request("https://example.com");
		await expect(resolveActorKey(request)).resolves.toBe("ip:unknown");
	});
});

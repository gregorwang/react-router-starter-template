import { describe, expect, it, vi } from "vitest";
import { persistAttachmentsToR2 } from "./chat-media.server";

describe("persistAttachmentsToR2", () => {
	it("stores attachments in R2 and returns media metadata", async () => {
		const put = vi.fn(async () => undefined);
		const env = {
			CHAT_MEDIA: { put },
		} as unknown as Env;

		const attachments = [
			{
				id: "att-1",
				mimeType: "image/png" as const,
				data: "aGVsbG8=",
				name: "hello.png",
			},
		];

		const result = await persistAttachmentsToR2({
			env,
			userId: "user-1",
			conversationId: "conv-1",
			attachments,
		});

		expect(put).toHaveBeenCalledOnce();
		expect(result).toHaveLength(1);
		expect(result[0].r2Key).toContain("att_user-1_conv-1_att-1.png");
		expect(result[0].url).toContain("/media/");
	});

	it("throws when CHAT_MEDIA binding is missing", async () => {
		const env = {} as Env;

		await expect(
			persistAttachmentsToR2({
				env,
				userId: "user-1",
				conversationId: "conv-1",
				attachments: [
					{
						id: "att-1",
						mimeType: "image/png",
						data: "aGVsbG8=",
					},
				],
			}),
		).rejects.toThrow("R2 binding not configured");
	});
});

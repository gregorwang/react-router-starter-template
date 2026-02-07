import type { Attachment } from "../llm/types";

function getAttachmentExtension(mimeType: string) {
	switch (mimeType) {
		case "image/jpeg":
			return "jpg";
		case "image/png":
			return "png";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		case "application/pdf":
			return "pdf";
		case "text/plain":
			return "txt";
		case "text/markdown":
			return "md";
		case "text/csv":
			return "csv";
		case "application/json":
			return "json";
		default:
			return "bin";
	}
}

function decodeBase64ToUint8Array(data: string) {
	const normalized = data.replace(/\s+/g, "");
	const binary = atob(normalized);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export async function persistAttachmentsToR2(options: {
	env: Env;
	userId: string;
	conversationId: string;
	attachments: Attachment[];
}): Promise<Attachment[]> {
	if (!options.attachments.length) return [];
	if (!options.env.CHAT_MEDIA) {
		throw new Error("R2 binding not configured");
	}

	const stored: Attachment[] = [];
	for (const attachment of options.attachments) {
		if (!attachment.data) continue;
		const ext = getAttachmentExtension(attachment.mimeType);
		const key = `att_${options.userId}_${options.conversationId}_${attachment.id}.${ext}`;
		const bytes = decodeBase64ToUint8Array(attachment.data);
		await options.env.CHAT_MEDIA.put(key, bytes, {
			httpMetadata: { contentType: attachment.mimeType },
		});
		stored.push({
			id: attachment.id,
			mimeType: attachment.mimeType,
			name: attachment.name,
			size: attachment.size ?? bytes.length,
			url: `/media/${encodeURIComponent(key)}`,
			r2Key: key,
		});
	}

	return stored;
}

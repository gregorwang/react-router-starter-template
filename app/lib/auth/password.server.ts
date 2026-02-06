const DEFAULT_ITERATIONS = 120_000;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;

function toBase64(buffer: ArrayBuffer) {
	const bytes = new Uint8Array(buffer);
	if (typeof btoa === "function") {
		let binary = "";
		for (const byte of bytes) {
			binary += String.fromCharCode(byte);
		}
		return btoa(binary);
	}
	const nodeBuffer = (globalThis as { Buffer?: { from: (input: Uint8Array) => { toString: (encoding: string) => string } } })
		.Buffer;
	if (nodeBuffer) {
		return nodeBuffer.from(bytes).toString("base64");
	}
	throw new Error("Base64 encoder unavailable");
}

function fromBase64(value: string) {
	if (typeof atob === "function") {
		const binary = atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}
	const nodeBuffer = (globalThis as { Buffer?: { from: (input: string, encoding: string) => Uint8Array } })
		.Buffer;
	if (nodeBuffer) {
		return new Uint8Array(nodeBuffer.from(value, "base64"));
	}
	throw new Error("Base64 decoder unavailable");
}

async function deriveKeyWebCrypto(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<ArrayBuffer> {
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);

	return crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: salt as BufferSource,
			iterations,
			hash: "SHA-256",
		},
		keyMaterial,
		KEY_LENGTH * 8,
	);
}

async function deriveKey(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<ArrayBuffer> {
	return deriveKeyWebCrypto(password, salt, iterations);
}

export async function hashPassword(password: string) {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const derived = await deriveKey(password, salt, DEFAULT_ITERATIONS);
	const saltB64 = toBase64(salt.buffer);
	const hashB64 = toBase64(derived);
	return `pbkdf2$${DEFAULT_ITERATIONS}$${saltB64}$${hashB64}`;
}

export async function verifyPassword(password: string, storedHash: string) {
	const parts = storedHash.split("$");
	if (parts.length !== 4 || parts[0] !== "pbkdf2") {
		return false;
	}
	const iterations = Number(parts[1]);
	if (!Number.isFinite(iterations)) return false;
	const salt = fromBase64(parts[2]);
	const expected = parts[3];
	try {
		const derived = await deriveKey(password, salt, iterations);
		const actual = toBase64(derived);
		if (timingSafeEqual(actual, expected)) return true;
	} catch {
		return false;
	}
	return false;
}

function timingSafeEqual(a: string, b: string) {
	if (a.length !== b.length) return false;
	let result = 0;
	for (let i = 0; i < a.length; i += 1) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

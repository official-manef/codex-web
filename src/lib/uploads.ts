// Nothing is written to disk or to a database; this only proves the bytes are what they claim to be.

export type AcceptedImage = {
	mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
	data: string;
	bytes: number;
};

export const MAX_IMAGE_BYTES = 4_194_304;
export const MAX_IMAGES_PER_TURN = 2;

/**
 * Wire limit for `POST /api/ai/chat`, derived so the documented image budget is reachable.
 *
 * Base64 turns 4 MiB into ceil(4_194_304 / 3) * 4 = 5_592_408 characters, so the two images a
 * turn may carry are 11_184_816 characters of JSON before any envelope. The extra 256 KiB is
 * more than the whole text budget `parseChat` enforces (32 000 characters of messages, 2 000 of
 * memory, plus keys and message scaffolding), so every body the schema can accept fits.
 *
 * `readJsonBody` buffers the whole body, so this is also the per-request memory ceiling. Measured
 * on this host for a body at the limit (11 185 067 bytes, two 4 MB images): read phase +37 MB
 * RSS (11 MB of stream chunks plus a 22 MB UTF-16 string), `JSON.parse` another +12 MB in 13 ms,
 * peak ~48 MB RSS. Stated rather than removed: `requireCapabilityAccess` runs before this read,
 * so only a credentialed caller can allocate it. What does NOT bound it: the burst limiter counts
 * request starts per minute, not bodies in flight, so N concurrent credentialed requests cost
 * N × 48 MB. Stream-parsing JSON would save ~12 MB of the 48 and cost a hand-written parser;
 * a per-identity in-flight counter is the cheaper guard if this ever faces traffic that matters.
 * Numbers and method: docs/parity-checklist-2026-11-02.md §3.2.
 */
export const MAX_CHAT_BODY_BYTES =
	MAX_IMAGES_PER_TURN * Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 262_144;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Int8Array(128).fill(-1);
for (let i = 0; i < B64_CHARS.length; i++) {
	B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

// Avoid node:buffer so intake validation runs anywhere (browser client, edge runtime, server)
// without node polyfills. Manually decoding at most 16 bytes is O(1) and never throws.
function decodeHeadBytes(base64: string, maxBytes = 16): number[] {
	if (typeof base64 !== 'string') return [];
	const out: number[] = [];
	let buffer = 0;
	let bits = 0;

	for (let i = 0; i < base64.length && out.length < maxBytes; i++) {
		const code = base64.charCodeAt(i);
		if (code === 61) {
			// '=' padding: stop decoding further bytes
			break;
		}
		if (code >= 128) return [];
		const val = B64_LOOKUP[code];
		if (val === -1) return [];

		buffer = (buffer << 6) | val;
		bits += 6;

		if (bits >= 8) {
			bits -= 8;
			out.push((buffer >> bits) & 0xff);
			if (out.length >= maxBytes) {
				break;
			}
		}
	}

	return out;
}

/**
 * Sniffs the media type from the decoded magic bytes of a base64 payload.
 * Reads at most the first 16 bytes.
 */
export function sniffMediaType(base64: string): 'image/png' | 'image/jpeg' | 'image/webp' | null {
	const bytes = decodeHeadBytes(base64, 16);

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return 'image/png';
	}

	// JPEG: FF D8 FF
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}

	// WebP: 52 49 46 46 (RIFF) at 0, 57 45 42 50 (WEBP) at 8
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp';
	}

	return null;
}

/**
 * The two shapes `atob` refuses and the size formula mis-measures: an unpadded length of 1 mod 4,
 * and a padded length that is not a multiple of 4. Both decode to nothing, so intake must refuse
 * them rather than accept a size claim the data cannot honour.
 */
export function isDecodableBase64(base64: string): boolean {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return padding ? base64.length % 4 === 0 : base64.length % 4 !== 1;
}

/** Decoded byte count of a base64 payload, without allocating the bytes. */
export function decodedBytes(base64: string): number {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * Validates and accepts a single base64 image against size, magic bytes, declared media type, and name.
 */
export function acceptImage(
	name: string,
	mediaType: string,
	base64: string
): AcceptedImage | { error: string } {
	if (!BASE64_PATTERN.test(base64)) {
		return { error: 'That is not base64 data.' };
	}

	// Two shapes `atob` refuses and the byte formula mis-measures:
	//  - unpadded length 1 mod 4 (`iVBORw0KGgoAA`) reports 9 bytes but decodes to nothing;
	//  - padded length not a multiple of 4 (`AAAA=`) reports 3 bytes but also decodes to nothing.
	// Both used to pass intake and then fail anywhere the data was really decoded.
	if (!isDecodableBase64(base64)) {
		return { error: 'That is not base64 data.' };
	}
	const bytes = decodedBytes(base64);
	if (bytes > MAX_IMAGE_BYTES) {
		return { error: 'That image is larger than 4 MB.' };
	}

	const sniffed = sniffMediaType(base64);
	if (!sniffed) {
		return { error: 'Only PNG, JPEG or WebP images are accepted.' };
	}

	if (sniffed !== mediaType) {
		return { error: 'The declared type does not match the image data.' };
	}

	if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
		return { error: 'That file has no usable name.' };
	}

	return {
		mediaType: sniffed,
		data: base64,
		bytes
	};
}

/**
 * Validates a list of images, keeping up to MAX_IMAGES_PER_TURN successes and accumulating errors.
 */
export function acceptImages(list: { name: string; mediaType: string; base64: string }[]): {
	accepted: AcceptedImage[];
	errors: string[];
} {
	const accepted: AcceptedImage[] = [];
	const errors: string[] = [];

	for (const item of list) {
		const result = acceptImage(item.name, item.mediaType, item.base64);
		if ('error' in result) {
			errors.push(result.error);
		} else if (accepted.length < MAX_IMAGES_PER_TURN) {
			accepted.push(result);
		} else {
			errors.push('At most 2 images per turn.');
		}
	}

	return { accepted, errors };
}

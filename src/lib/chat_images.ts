// This is the composer→wire adapter; the route re-verifies independently, and neither trusts the other.

import { acceptImage, MAX_IMAGE_BYTES, MAX_IMAGES_PER_TURN } from './uploads';

export type ComposerAttachment = {
	id: string;
	name: string;
	type: string;
	size: number;
};

export type WireImage = {
	type: 'image';
	mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
	data: string;
};

export const MAX_WIRE_IMAGES: number = MAX_IMAGES_PER_TURN;

export function isImageAttachment(a: { type?: string }): boolean {
	if (!a || typeof a.type !== 'string') return false;
	const lower = a.type.toLowerCase();
	return lower === 'image/png' || lower === 'image/jpeg' || lower === 'image/webp';
}

export async function readImageFile(file: File): Promise<{ base64: string } | { error: string }> {
	try {
		if (file.size > MAX_IMAGE_BYTES) {
			return { error: 'That image is larger than 4 MB.' };
		}
		const buffer = await file.arrayBuffer();
		const bytes = new Uint8Array(buffer);
		let binary = '';
		const chunkSize = 0x8000;
		for (let i = 0; i < bytes.length; i += chunkSize) {
			const chunk = bytes.subarray(i, i + chunkSize);
			binary += String.fromCharCode(...chunk);
		}
		return { base64: btoa(binary) };
	} catch {
		return { error: 'Could not read image file.' };
	}
}

export function toWireImages(list: { attachment: ComposerAttachment; base64: string }[]): {
	images: WireImage[];
	errors: string[];
} {
	const images: WireImage[] = [];
	const errors: string[] = [];

	for (const item of list) {
		const result = acceptImage(item.attachment.name, item.attachment.type, item.base64);
		if ('error' in result) {
			errors.push(result.error);
		} else if (images.length < MAX_WIRE_IMAGES) {
			images.push({
				type: 'image',
				mediaType: result.mediaType,
				data: result.data
			});
		} else {
			errors.push('At most 2 images per turn.');
		}
	}

	return { images, errors };
}

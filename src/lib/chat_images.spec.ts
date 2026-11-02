import { describe, expect, test } from 'vitest';
import {
	isImageAttachment,
	MAX_WIRE_IMAGES,
	readImageFile,
	toWireImages,
	type ComposerAttachment
} from './chat_images';
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_TURN } from './uploads';

const REAL_PNG =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe('MAX_WIRE_IMAGES', () => {
	test('equals MAX_IMAGES_PER_TURN from uploads.ts without drift', () => {
		expect(MAX_WIRE_IMAGES).toBe(MAX_IMAGES_PER_TURN);
		expect(MAX_WIRE_IMAGES).toBe(2);
	});
});

describe('isImageAttachment', () => {
	test('accepts exact supported image types', () => {
		expect(isImageAttachment({ type: 'image/png' })).toBe(true);
		expect(isImageAttachment({ type: 'image/jpeg' })).toBe(true);
		expect(isImageAttachment({ type: 'image/webp' })).toBe(true);
	});

	test('accepts case variants', () => {
		expect(isImageAttachment({ type: 'IMAGE/PNG' })).toBe(true);
		expect(isImageAttachment({ type: 'Image/Jpeg' })).toBe(true);
		expect(isImageAttachment({ type: 'image/WEBP' })).toBe(true);
	});

	test('refuses unaccepted media types', () => {
		expect(isImageAttachment({ type: 'image/gif' })).toBe(false);
		expect(isImageAttachment({ type: 'text/plain' })).toBe(false);
		expect(isImageAttachment({ type: 'application/pdf' })).toBe(false);
		expect(isImageAttachment({})).toBe(false);
		expect(isImageAttachment({ type: undefined })).toBe(false);
	});
});

describe('toWireImages', () => {
	const validAttachment1: ComposerAttachment = {
		id: 'att-1',
		name: 'pixel1.png',
		type: 'image/png',
		size: 68
	};

	const validAttachment2: ComposerAttachment = {
		id: 'att-2',
		name: 'pixel2.png',
		type: 'image/png',
		size: 68
	};

	const validAttachment3: ComposerAttachment = {
		id: 'att-3',
		name: 'pixel3.png',
		type: 'image/png',
		size: 68
	};

	test('yields empty images and empty errors for empty list', () => {
		const result = toWireImages([]);
		expect(result.images).toEqual([]);
		expect(result.errors).toEqual([]);
	});

	test('yields two parts with sniffed mediaType image/png for two valid 1x1 PNGs', () => {
		const result = toWireImages([
			{ attachment: validAttachment1, base64: REAL_PNG },
			{ attachment: validAttachment2, base64: REAL_PNG }
		]);

		expect(result.errors).toEqual([]);
		expect(result.images).toEqual([
			{ type: 'image', mediaType: 'image/png', data: REAL_PNG },
			{ type: 'image', mediaType: 'image/png', data: REAL_PNG }
		]);
	});

	test('refuses a PNG declared as image/jpeg with an error and does not include it', () => {
		const mismatchedAttachment: ComposerAttachment = {
			id: 'att-mismatch',
			name: 'fake.jpg',
			type: 'image/jpeg',
			size: 68
		};

		const result = toWireImages([{ attachment: mismatchedAttachment, base64: REAL_PNG }]);

		expect(result.images).toEqual([]);
		expect(result.errors).toEqual(['The declared type does not match the image data.']);
	});

	test('three entries yield 2 parts + 1 overflow error', () => {
		const result = toWireImages([
			{ attachment: validAttachment1, base64: REAL_PNG },
			{ attachment: validAttachment2, base64: REAL_PNG },
			{ attachment: validAttachment3, base64: REAL_PNG }
		]);

		expect(result.images).toHaveLength(2);
		expect(result.errors).toEqual(['At most 2 images per turn.']);
	});
});

describe('readImageFile', () => {
	test('round-trips real base64 PNG from File', async () => {
		const bytes = Uint8Array.from(atob(REAL_PNG), (char) => char.charCodeAt(0));
		const file = new File([bytes], 'a.png', { type: 'image/png' });

		const result = await readImageFile(file);

		expect(result).toEqual({ base64: REAL_PNG });
	});

	test('refuses an oversized File before reading', async () => {
		// Constructing an oversized File via a size getter avoids allocating >4 MB in memory during tests
		const file = new File([], 'oversized.png', { type: 'image/png' });
		Object.defineProperty(file, 'size', {
			get: () => MAX_IMAGE_BYTES + 1
		});

		const result = await readImageFile(file);

		expect(result).toEqual({ error: 'That image is larger than 4 MB.' });
	});

	test('never throws on read failure and returns error object', async () => {
		const file = new File([], 'broken.png', { type: 'image/png' });
		file.arrayBuffer = () => Promise.reject(new Error('Simulated read failure'));

		const result = await readImageFile(file);

		expect(result).toEqual({ error: 'Could not read image file.' });
	});
});

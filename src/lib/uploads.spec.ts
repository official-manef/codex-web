import { describe, expect, test } from 'vitest';
import {
	acceptImage,
	acceptImages,
	MAX_IMAGE_BYTES,
	MAX_IMAGES_PER_TURN,
	sniffMediaType,
	type AcceptedImage
} from './uploads';

// Real 1x1 test image payloads in base64
const REAL_PNG =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const REAL_JPEG =
	'/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const REAL_WEBP =
	'UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAwAAAARBxAR/Q9ERP8DAABWUDggFAAAADABAJ0BKgEAAQABABwlpAADcAD+/gbQAA==';
const TEXT_HTML_BASE64 = 'PGgxPkhlbGxvIFdvcmxkPC9oMT4='; // "<h1>Hello World</h1>"

describe('sniffMediaType', () => {
	test('identifies real 1x1 PNG', () => {
		expect(sniffMediaType(REAL_PNG)).toBe('image/png');
	});

	test('identifies real 1x1 JPEG', () => {
		expect(sniffMediaType(REAL_JPEG)).toBe('image/jpeg');
	});

	test('identifies minimal WebP', () => {
		expect(sniffMediaType(REAL_WEBP)).toBe('image/webp');
	});

	test('returns null for text/HTML base64', () => {
		expect(sniffMediaType(TEXT_HTML_BASE64)).toBeNull();
	});

	test('returns null on truncated input without throwing', () => {
		expect(sniffMediaType('')).toBeNull();
		expect(sniffMediaType('i')).toBeNull();
		expect(sniffMediaType('iV')).toBeNull();
		expect(sniffMediaType('iVB')).toBeNull();
		expect(sniffMediaType('iVBORw==')).toBeNull();
		expect(sniffMediaType('/9')).toBeNull();
		expect(sniffMediaType('UklG')).toBeNull();
		expect(sniffMediaType('UklGRkAAAA==')).toBeNull();
	});

	test('returns null on invalid base64 characters without throwing', () => {
		expect(sniffMediaType('not-valid-base64!')).toBeNull();
		expect(sniffMediaType('????')).toBeNull();
	});
});

describe('acceptImage', () => {
	test('accepts real 1x1 PNG with measured bytes and sniffed mediaType', () => {
		const result = acceptImage('pixel.png', 'image/png', REAL_PNG);
		expect('error' in result).toBe(false);
		const accepted = result as AcceptedImage;
		expect(accepted.mediaType).toBe('image/png');
		expect(accepted.data).toBe(REAL_PNG);
		expect(accepted.bytes).toBe(68);
	});

	test('accepts real 1x1 JPEG', () => {
		const result = acceptImage('photo.jpg', 'image/jpeg', REAL_JPEG);
		expect('error' in result).toBe(false);
		const accepted = result as AcceptedImage;
		expect(accepted.mediaType).toBe('image/jpeg');
		expect(accepted.data).toBe(REAL_JPEG);
		expect(accepted.bytes).toBe(134);
	});

	test('accepts minimal WebP', () => {
		const result = acceptImage('image.webp', 'image/webp', REAL_WEBP);
		expect('error' in result).toBe(false);
		const accepted = result as AcceptedImage;
		expect(accepted.mediaType).toBe('image/webp');
		expect(accepted.data).toBe(REAL_WEBP);
		expect(accepted.bytes).toBe(82);
	});

	test('refuses invalid base64 (rule 1)', () => {
		expect(acceptImage('test.png', 'image/png', 'not valid base64!')).toEqual({
			error: 'That is not base64 data.'
		});
		expect(acceptImage('test.png', 'image/png', '')).toEqual({
			error: 'That is not base64 data.'
		});
		expect(acceptImage('test.png', 'image/png', 'abc===')).toEqual({
			error: 'That is not base64 data.'
		});
		expect(acceptImage('test.png', 'image/png', 'ab=c')).toEqual({
			error: 'That is not base64 data.'
		});
		// Fuzz regression: both lengths pass BASE64_PATTERN, decode to nothing, and the byte
		// formula still reported a size, so intake accepted an image no decoder could read.
		// `/a` is a valid PNG prefix whose 13th character lands on an unpadded 1-mod-4 length.
		expect(acceptImage('test.png', 'image/png', 'iVBORw0KGgoAA')).toEqual({
			error: 'That is not base64 data.'
		});
		expect(acceptImage('test.png', 'image/png', 'AAAA=')).toEqual({
			error: 'That is not base64 data.'
		});
		expect(() => atob('iVBORw0KGgoAA')).toThrow();
		expect(() => atob('AAAA=')).toThrow();
	});

	test('refuses a payload one byte over the cap (rule 2)', () => {
		// 5592408 chars with 1 '=' padding gives floor(5592408 * 3 / 4) - 1 = 4194305 bytes = MAX_IMAGE_BYTES + 1
		const overCapBase64 = 'A'.repeat(5_592_407) + '=';
		expect(Math.floor((overCapBase64.length * 3) / 4) - 1).toBe(MAX_IMAGE_BYTES + 1);
		expect(acceptImage('large.png', 'image/png', overCapBase64)).toEqual({
			error: 'That image is larger than 4 MB.'
		});
	});

	test('evaluates size check at exact cap boundary', () => {
		// 5592408 chars with 2 '=' padding gives floor(5592408 * 3 / 4) - 2 = 4194304 bytes = MAX_IMAGE_BYTES
		const atCapBase64 = 'A'.repeat(5_592_406) + '==';
		expect(Math.floor((atCapBase64.length * 3) / 4) - 2).toBe(MAX_IMAGE_BYTES);
		// It passes the size check, then fails on sniffing because it is not an image
		expect(acceptImage('large.png', 'image/png', atCapBase64)).toEqual({
			error: 'Only PNG, JPEG or WebP images are accepted.'
		});
	});

	test('refuses non-image payloads such as text/HTML (rule 3)', () => {
		expect(acceptImage('doc.png', 'image/png', TEXT_HTML_BASE64)).toEqual({
			error: 'Only PNG, JPEG or WebP images are accepted.'
		});
	});

	test('refuses when sniffed type differs from declared mediaType (rule 4)', () => {
		expect(acceptImage('mismatch.jpg', 'image/jpeg', REAL_PNG)).toEqual({
			error: 'The declared type does not match the image data.'
		});
		expect(acceptImage('mismatch.webp', 'image/webp', REAL_PNG)).toEqual({
			error: 'The declared type does not match the image data.'
		});
		expect(acceptImage('mismatch.png', 'image/png', REAL_JPEG)).toEqual({
			error: 'The declared type does not match the image data.'
		});
	});

	test('refuses when name is missing, empty, whitespace, or too long (rule 5)', () => {
		expect(acceptImage('', 'image/png', REAL_PNG)).toEqual({
			error: 'That file has no usable name.'
		});
		expect(acceptImage('   ', 'image/png', REAL_PNG)).toEqual({
			error: 'That file has no usable name.'
		});
		expect(acceptImage('a'.repeat(201), 'image/png', REAL_PNG)).toEqual({
			error: 'That file has no usable name.'
		});

		// 200 characters is accepted
		const exactly200 = 'a'.repeat(196) + '.png';
		const okResult = acceptImage(exactly200, 'image/png', REAL_PNG);
		expect('error' in okResult).toBe(false);
	});
});

describe('acceptImages', () => {
	test('returns empty results for empty list', () => {
		expect(acceptImages([])).toEqual({ accepted: [], errors: [] });
	});

	test('accepts up to MAX_IMAGES_PER_TURN images without errors', () => {
		const list = [
			{ name: 'first.png', mediaType: 'image/png', base64: REAL_PNG },
			{ name: 'second.jpg', mediaType: 'image/jpeg', base64: REAL_JPEG }
		];
		const result = acceptImages(list);
		expect(result.errors).toEqual([]);
		expect(result.accepted).toHaveLength(2);
		expect(result.accepted[0].mediaType).toBe('image/png');
		expect(result.accepted[1].mediaType).toBe('image/jpeg');
	});

	test('3 images → 2 accepted + 1 error naming the per-turn cap', () => {
		const list = [
			{ name: 'one.png', mediaType: 'image/png', base64: REAL_PNG },
			{ name: 'two.jpg', mediaType: 'image/jpeg', base64: REAL_JPEG },
			{ name: 'three.webp', mediaType: 'image/webp', base64: REAL_WEBP }
		];
		const result = acceptImages(list);
		expect(result.accepted).toHaveLength(MAX_IMAGES_PER_TURN);
		expect(result.errors).toEqual(['At most 2 images per turn.']);
	});

	test('reports every refusal and overflow without silent drop', () => {
		const list = [
			{ name: 'bad.png', mediaType: 'image/png', base64: 'invalid!' },
			{ name: 'good1.png', mediaType: 'image/png', base64: REAL_PNG },
			{ name: 'mismatch.jpg', mediaType: 'image/jpeg', base64: REAL_PNG },
			{ name: 'good2.jpg', mediaType: 'image/jpeg', base64: REAL_JPEG },
			{ name: 'overflow1.webp', mediaType: 'image/webp', base64: REAL_WEBP },
			{ name: 'overflow2.webp', mediaType: 'image/webp', base64: REAL_WEBP }
		];
		const result = acceptImages(list);
		expect(result.accepted).toHaveLength(2);
		expect(result.accepted[0].data).toBe(REAL_PNG);
		expect(result.accepted[1].data).toBe(REAL_JPEG);
		expect(result.errors).toEqual([
			'That is not base64 data.',
			'The declared type does not match the image data.',
			'At most 2 images per turn.',
			'At most 2 images per turn.'
		]);
	});
});

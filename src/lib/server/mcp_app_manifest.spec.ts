import { describe, expect, it } from 'vitest';
import { framePolicy } from '../mcp_app_host';
import {
	manifestRejection,
	MAX_APPS,
	parseAppList,
	parseManifest,
	SURFACES,
	type AppManifest
} from './mcp_app_manifest';

const validManifest: AppManifest = {
	id: 'app-sandbox-1',
	name: 'Sandbox App',
	origin: 'https://app.example.com',
	entry: '/index.html',
	surfaces: ['sidebar', 'panel']
};

describe('mcp_app_manifest allowlist and parser', () => {
	it('parses a valid manifest correctly', () => {
		const parsed = parseManifest(validManifest);
		expect(parsed).toEqual(validManifest);
	});

	it('trims whitespace on name and accepts valid lengths', () => {
		const parsed = parseManifest({
			...validManifest,
			name: '   Trimmed Name   '
		});
		expect(parsed).not.toBeNull();
		expect(parsed?.name).toBe('Trimmed Name');
	});

	it('rejects http: origin', () => {
		expect(
			parseManifest({
				...validManifest,
				origin: 'http://app.example.com'
			})
		).toBeNull();
	});

	it('rejects origin with a path', () => {
		expect(
			parseManifest({
				...validManifest,
				origin: 'https://app.example.com/some/path'
			})
		).toBeNull();
	});

	it('rejects origin with credentials', () => {
		expect(
			parseManifest({
				...validManifest,
				origin: 'https://user:pass@app.example.com'
			})
		).toBeNull();
	});

	it('rejects id with uppercase', () => {
		expect(
			parseManifest({
				...validManifest,
				id: 'AppSandbox'
			})
		).toBeNull();
	});

	it('rejects id starting with a digit-dash', () => {
		expect(
			parseManifest({
				...validManifest,
				id: '-1-app'
			})
		).toBeNull();
		expect(
			parseManifest({
				...validManifest,
				id: '-app'
			})
		).toBeNull();
	});

	it('rejects oversized name (>60 chars after trim)', () => {
		expect(
			parseManifest({
				...validManifest,
				name: 'a'.repeat(61)
			})
		).toBeNull();
		expect(
			parseManifest({
				...validManifest,
				name: `   ${'a'.repeat(61)}   `
			})
		).toBeNull();
		expect(
			parseManifest({
				...validManifest,
				name: '   '
			})
		).toBeNull();
	});

	it('rejects entry with ..', () => {
		expect(
			parseManifest({
				...validManifest,
				entry: '/app/../secret'
			})
		).toBeNull();
	});

	it('rejects entry absolute', () => {
		expect(
			parseManifest({
				...validManifest,
				entry: 'https://app.example.com/index.html'
			})
		).toBeNull();
		expect(
			parseManifest({
				...validManifest,
				entry: 'http://app.example.com/index.html'
			})
		).toBeNull();
	});

	it('rejects entry with //', () => {
		expect(
			parseManifest({
				...validManifest,
				entry: '//evil.com/app'
			})
		).toBeNull();
		expect(
			parseManifest({
				...validManifest,
				entry: '/app//index.html'
			})
		).toBeNull();
	});

	it('rejects unknown surface', () => {
		expect(
			parseManifest({
				...validManifest,
				surfaces: ['sidebar', 'unknown-surface']
			})
		).toBeNull();
	});

	it('rejects duplicate surface', () => {
		expect(
			parseManifest({
				...validManifest,
				surfaces: ['sidebar', 'sidebar']
			})
		).toBeNull();
	});

	it('rejects 5 surfaces', () => {
		expect(
			parseManifest({
				...validManifest,
				surfaces: ['sidebar', 'panel', 'file-editor', 'form', 'sidebar']
			})
		).toBeNull();
	});

	it('rejects non-object or malformed values in parseManifest', () => {
		expect(parseManifest(null)).toBeNull();
		expect(parseManifest(undefined)).toBeNull();
		expect(parseManifest('string')).toBeNull();
		expect(parseManifest(123)).toBeNull();
		expect(parseManifest([])).toBeNull();
	});

	describe('parseAppList', () => {
		it('drops invalid entries and dedupes by id keeping the first', () => {
			const list = [
				validManifest,
				{ ...validManifest, name: 'Duplicate ID with different name' },
				{ ...validManifest, id: 'bad-origin', origin: 'http://insecure.com' },
				{
					id: 'app-second',
					name: 'Second App',
					origin: 'https://second.example.com',
					entry: '/app',
					surfaces: ['panel']
				}
			];
			const result = parseAppList(list);
			expect(result).toHaveLength(2);
			expect(result[0]).toEqual(validManifest);
			expect(result[1].id).toBe('app-second');
			expect(result[1].name).toBe('Second App');
		});

		it('caps at MAX_APPS (20)', () => {
			expect(MAX_APPS).toBe(20);
			const oversizedList: AppManifest[] = [];
			for (let i = 1; i <= 25; i++) {
				oversizedList.push({
					id: `app-${i}`,
					name: `App ${i}`,
					origin: `https://app${i}.example.com`,
					entry: '/index.html',
					surfaces: ['sidebar']
				});
			}
			const result = parseAppList(oversizedList);
			expect(result).toHaveLength(20);
			expect(result[0].id).toBe('app-1');
			expect(result[19].id).toBe('app-20');
		});

		it('returns [] for null/object/string and non-array values', () => {
			expect(parseAppList(null)).toEqual([]);
			expect(parseAppList({})).toEqual([]);
			expect(parseAppList('not-an-array')).toEqual([]);
			expect(parseAppList(undefined)).toEqual([]);
			expect(parseAppList(42)).toEqual([]);
		});
	});

	describe('manifestRejection', () => {
		it('returns null for something parseManifest accepted', () => {
			const parsed = parseManifest(validManifest);
			expect(parsed).not.toBeNull();
			expect(manifestRejection(parsed!)).toBeNull();
		});

		it('returns non-null reason for hand-built bad manifests', () => {
			expect(manifestRejection({ ...validManifest, id: 'INVALID-ID' })).toBeTruthy();
			expect(manifestRejection({ ...validManifest, name: '' })).toBeTruthy();
			expect(
				manifestRejection({ ...validManifest, origin: 'http://insecure.example.com' })
			).toBeTruthy();
			expect(manifestRejection({ ...validManifest, entry: 'https://evil.com/app' })).toBeTruthy();
			expect(manifestRejection({ ...validManifest, entry: '/app/../secret' })).toBeTruthy();
			expect(manifestRejection({ ...validManifest, surfaces: ['nonexistent'] })).toBeTruthy();
			expect(
				manifestRejection({ ...validManifest, surfaces: ['sidebar', 'sidebar'] })
			).toBeTruthy();
		});
	});

	describe('cross-module agreement with framePolicy', () => {
		it('manifest origin accepted here is also accepted by framePolicy', () => {
			const parsed = parseManifest(validManifest);
			expect(parsed).not.toBeNull();
			expect(() => framePolicy(parsed!.origin)).not.toThrow();
			const policy = framePolicy(parsed!.origin);
			expect(policy.sandbox).toBe('allow-scripts');
			expect(policy.referrerPolicy).toBe('no-referrer');
		});

		it('refuses http: origin in both parseManifest and framePolicy', () => {
			const httpOrigin = 'http://app.example.com';
			expect(parseManifest({ ...validManifest, origin: httpOrigin })).toBeNull();
			expect(() => framePolicy(httpOrigin)).toThrow(/must use https: protocol/);
		});
	});

	describe('SURFACES definition', () => {
		it('exposes the expected frozen surface set', () => {
			expect(SURFACES).toEqual(['sidebar', 'panel', 'file-editor', 'form']);
		});
	});
});

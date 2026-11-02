import { describe, expect, it } from 'vitest';
import {
	MAX_INSTRUCTIONS,
	MAX_PROJECT_FILES,
	cleanProjectPath,
	mergeDetail,
	parseDetail,
	type ProjectDetail
} from './projects_extra';

describe('cleanProjectPath', () => {
	it('accepts valid relative paths', () => {
		expect(cleanProjectPath('src/lib/index.ts')).toBe('src/lib/index.ts');
		expect(cleanProjectPath('README.md')).toBe('README.md');
		expect(cleanProjectPath('assets/images/logo_v2-final.min.svg')).toBe(
			'assets/images/logo_v2-final.min.svg'
		);
		expect(cleanProjectPath('archive..name.txt')).toBe('archive..name.txt');
	});

	it('rejects leading slashes', () => {
		expect(cleanProjectPath('/etc/hosts')).toBeNull();
		expect(cleanProjectPath('/app.ts')).toBeNull();
	});

	it('rejects .. segments', () => {
		expect(cleanProjectPath('..')).toBeNull();
		expect(cleanProjectPath('../secret.txt')).toBeNull();
		expect(cleanProjectPath('src/../secret.txt')).toBeNull();
		expect(cleanProjectPath('src/lib/..')).toBeNull();
	});

	it('rejects invalid characters, NUL, and backslashes', () => {
		expect(cleanProjectPath('src\\lib\\file.ts')).toBeNull();
		expect(cleanProjectPath('file with space.ts')).toBeNull();
		expect(cleanProjectPath('file\0null.txt')).toBeNull();
		expect(cleanProjectPath('file@name.txt')).toBeNull();
		expect(cleanProjectPath('file:name.txt')).toBeNull();
	});

	it('enforces 1–300 character bounds', () => {
		expect(cleanProjectPath('')).toBeNull();
		const valid300 = 'a'.repeat(300);
		expect(cleanProjectPath(valid300)).toBe(valid300);
		const invalid301 = 'a'.repeat(301);
		expect(cleanProjectPath(invalid301)).toBeNull();
	});

	it('returns null for non-strings', () => {
		expect(cleanProjectPath(null)).toBeNull();
		expect(cleanProjectPath(undefined)).toBeNull();
		expect(cleanProjectPath(123)).toBeNull();
		expect(cleanProjectPath({})).toBeNull();
	});
});

describe('parseDetail', () => {
	it('returns null for non-objects', () => {
		expect(parseDetail(null)).toBeNull();
		expect(parseDetail(undefined)).toBeNull();
		expect(parseDetail('not-an-object')).toBeNull();
		expect(parseDetail(123)).toBeNull();
		expect(parseDetail([])).toBeNull();
		expect(parseDetail(true)).toBeNull();
	});

	it('parses empty object to default values', () => {
		expect(parseDetail({})).toEqual({
			instructions: '',
			files: []
		});
	});

	it('trims and caps instructions at 2000 chars', () => {
		const parsed = parseDetail({
			instructions: '  Use concise TypeScript.  '
		});
		expect(parsed?.instructions).toBe('Use concise TypeScript.');

		const long = 'a'.repeat(2500);
		const capped = parseDetail({ instructions: long });
		expect(capped?.instructions.length).toBe(MAX_INSTRUCTIONS);
	});

	it('validates files, deduplicates by path, and caps at 20', () => {
		const rawFiles = [
			{ path: 'src/a.ts', bytes: 100 },
			{ path: 'src/a.ts', bytes: 999 }, // duplicate: dropped
			{ path: '/absolute/path.ts', bytes: 50 }, // invalid path: dropped
			{ path: 'src/b.ts', bytes: -5 }, // negative bytes: dropped
			{ path: 'src/c.ts', bytes: 3.14 }, // non-integer: dropped
			{ path: 'src/d.ts', bytes: '10' }, // string bytes: dropped
			{ path: 'src/e.ts', bytes: Infinity }, // non-finite: dropped
			null, // invalid entry
			{ path: 'src/valid.ts', bytes: 0 }
		];

		const parsed = parseDetail({ files: rawFiles });
		expect(parsed?.files).toEqual([
			{ path: 'src/a.ts', bytes: 100 },
			{ path: 'src/valid.ts', bytes: 0 }
		]);

		const manyFiles = Array.from({ length: 25 }, (_, i) => ({
			path: `file${i}.ts`,
			bytes: i * 10
		}));
		const cappedFiles = parseDetail({ files: manyFiles });
		expect(cappedFiles?.files.length).toBe(MAX_PROJECT_FILES);
	});
});

describe('mergeDetail', () => {
	const base: ProjectDetail = {
		instructions: 'Base instructions',
		files: [{ path: 'base.ts', bytes: 42 }]
	};

	it('preserves base on non-object or invalid patch', () => {
		expect(mergeDetail(base, null)).toEqual(base);
		expect(mergeDetail(base, undefined)).toEqual(base);
		expect(mergeDetail(base, 'patch')).toEqual(base);
		expect(mergeDetail(base, [])).toEqual(base);
	});

	it('ignores invalid fields and preserves base fields', () => {
		const merged = mergeDetail(base, {
			instructions: 12345,
			files: 'not-an-array'
		});
		expect(merged).toEqual(base);
	});

	it('updates instructions when valid', () => {
		const merged = mergeDetail(base, {
			instructions: '  New instructions  '
		});
		expect(merged.instructions).toBe('New instructions');
		expect(merged.files).toEqual(base.files);
	});

	it('updates files when valid and applies validation', () => {
		const merged = mergeDetail(base, {
			files: [
				{ path: 'new.ts', bytes: 200 },
				{ path: '/bad.ts', bytes: 10 }
			]
		});
		expect(merged.files).toEqual([{ path: 'new.ts', bytes: 200 }]);
		expect(merged.instructions).toBe(base.instructions);
	});

	it('allows clearing files with empty array', () => {
		const merged = mergeDetail(base, { files: [] });
		expect(merged.files).toEqual([]);
		expect(merged.instructions).toBe(base.instructions);
	});
});

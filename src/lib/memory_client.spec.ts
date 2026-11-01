import { describe, expect, test } from 'vitest';
import {
	MAX_CONTEXT_CHARS,
	MAX_MEMORIES,
	MAX_TEXT_CHARS,
	contextBlock,
	mergeMemories,
	toMemoryRows,
	type MemoryRow
} from './memory_client';

describe('mergeMemories', () => {
	test('cloud non-empty wins', () => {
		const cloud: MemoryRow[] = [{ id: 'c1', text: 'Cloud note', createdAt: 100 }];
		const local: MemoryRow[] = [{ id: 'l1', text: 'Local note', createdAt: 200 }];

		const result = mergeMemories(cloud, local);
		expect(result.source).toBe('cloud');
		expect(result.rows).toEqual(cloud);
		expect(result.droppedLocal).toBe(1);
	});

	test('cloud empty falls back to local', () => {
		const cloud: MemoryRow[] = [];
		const local: MemoryRow[] = [{ id: 'l1', text: 'Local note', createdAt: 200 }];

		const result = mergeMemories(cloud, local);
		expect(result.source).toBe('local');
		expect(result.rows).toEqual(local);
		expect(result.droppedLocal).toBe(0);
	});

	test('cloud null falls back to local', () => {
		const local: MemoryRow[] = [{ id: 'l1', text: 'Local note', createdAt: 200 }];

		const result = mergeMemories(null, local);
		expect(result.source).toBe('local');
		expect(result.rows).toEqual(local);
		expect(result.droppedLocal).toBe(0);
	});

	test('droppedLocal counts only text absent from cloud', () => {
		const cloud: MemoryRow[] = [
			{ id: 'c1', text: 'Shared note', createdAt: 100 },
			{ id: 'c2', text: 'Cloud only', createdAt: 101 }
		];
		const local: MemoryRow[] = [
			{ id: 'l1', text: '  Shared note  ', createdAt: 200 },
			{ id: 'l2', text: 'Local note 1', createdAt: 201 },
			{ id: 'l3', text: 'Local note 2', createdAt: 202 }
		];

		const result = mergeMemories(cloud, local);
		expect(result.source).toBe('cloud');
		expect(result.rows).toEqual(cloud);
		// 'Shared note' is trimmed and matches cloud, so only 2 local notes are absent
		expect(result.droppedLocal).toBe(2);
	});
});

describe('contextBlock', () => {
	test('contextBlock bounded and prefixed - ', () => {
		const rows: MemoryRow[] = [
			{ id: '1', text: 'User prefers TypeScript', createdAt: 1 },
			{ id: '2', text: 'Prefers dark theme', createdAt: 2 },
			{ id: '3', text: 'Keep explanations brief', createdAt: 3 }
		];

		const full = contextBlock(rows);
		expect(full).toBe('- User prefers TypeScript\n- Prefers dark theme\n- Keep explanations brief');
		expect(full.startsWith('- ')).toBe(true);
		expect(full.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);

		// Line 1 is 25 chars ('- User prefers TypeScript'). Max 30 fits only line 1.
		const bounded = contextBlock(rows, 30);
		expect(bounded).toBe('- User prefers TypeScript');

		// Bounded to 46 fits first two lines (25 + 1 + 20)
		const twoLines = contextBlock(rows, 46);
		expect(twoLines).toBe('- User prefers TypeScript\n- Prefers dark theme');

		// Not enough space for the first line
		expect(contextBlock(rows, 10)).toBe('');
		expect(contextBlock(rows, 0)).toBe('');
		expect(contextBlock(rows, -5)).toBe('');

		// Empty rows return empty string
		expect(contextBlock([])).toBe('');
	});
});

describe('toMemoryRows', () => {
	test('drops a numeric id, an empty text and an oversized text; caps at 50', () => {
		const raw = [
			{ id: 12345, text: 'Valid text with numeric id', createdAt: 10 },
			{ id: 'id-empty-text', text: '   ', createdAt: 20 },
			{ id: 'id-no-text', createdAt: 30 },
			{ id: 'id-oversized', text: 'x'.repeat(MAX_TEXT_CHARS + 1), createdAt: 40 },
			{ id: 'id-valid', text: 'Valid note', createdAt: 50 },
			{ _id: 'convex-id', text: 'Convex note', createdAt: 60 },
			{ id: 'id-exact-limit', text: 'y'.repeat(MAX_TEXT_CHARS), createdAt: 70 },
			{ id: 'id-valid', text: 'Duplicate id dropped', createdAt: 80 },
			null,
			'not an object'
		];

		const validated = toMemoryRows(raw);
		expect(validated).toEqual([
			{ id: 'id-valid', text: 'Valid note', createdAt: 50 },
			{ id: 'convex-id', text: 'Convex note', createdAt: 60 },
			{ id: 'id-exact-limit', text: 'y'.repeat(MAX_TEXT_CHARS), createdAt: 70 }
		]);

		// Caps at 50
		const sixtyRows = Array.from({ length: 60 }, (_, i) => ({
			id: `mem-${i}`,
			text: `Note ${i}`,
			createdAt: i
		}));
		const capped = toMemoryRows(sixtyRows);
		expect(capped).toHaveLength(MAX_MEMORIES);
		expect(capped[0].id).toBe('mem-0');
		expect(capped[49].id).toBe('mem-49');

		// Non-array input returns empty array
		expect(toMemoryRows(null)).toEqual([]);
		expect(toMemoryRows({})).toEqual([]);
		expect(toMemoryRows('string')).toEqual([]);
	});
});

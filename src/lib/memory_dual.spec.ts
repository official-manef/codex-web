import { describe, expect, test } from 'vitest';
import { DUAL_WRITE_FLAG, reconcile, shouldDualWrite } from './memory_dual';
import type { MemoryRow } from './memory_client';

describe('shouldDualWrite', () => {
	test('both off cases ("true" + signed out, "1" + signed in) -> disabled', () => {
		expect(shouldDualWrite('true', false)).toEqual({ enabled: false });
		expect(shouldDualWrite('1', true)).toEqual({ enabled: false });
	});

	test('"true" + signed in -> enabled', () => {
		expect(shouldDualWrite('true', true)).toEqual({ enabled: true });
	});

	test('other off cases (unset, arbitrary strings, empty string) -> disabled', () => {
		expect(shouldDualWrite(undefined, true)).toEqual({ enabled: false });
		expect(shouldDualWrite(undefined, false)).toEqual({ enabled: false });
		expect(shouldDualWrite('yes', true)).toEqual({ enabled: false });
		expect(shouldDualWrite('', true)).toEqual({ enabled: false });
		expect(shouldDualWrite('TRUE', true)).toEqual({ enabled: false });
	});

	test('DUAL_WRITE_FLAG is MEMORY_DUAL_WRITE', () => {
		expect(DUAL_WRITE_FLAG).toBe('MEMORY_DUAL_WRITE');
	});
});

describe('reconcile', () => {
	test('empty inputs produce three empty arrays', () => {
		expect(reconcile([], [])).toEqual({ toCloud: [], toLocal: [], conflicts: [] });
	});

	test('local-only rows go to toCloud', () => {
		const local: MemoryRow[] = [
			{ id: 'l1', text: 'Local only note 1', createdAt: 100 },
			{ id: 'l2', text: 'Local only note 2', createdAt: 200 }
		];
		const result = reconcile(local, []);
		expect(result.toCloud).toEqual(local);
		expect(result.toLocal).toEqual([]);
		expect(result.conflicts).toEqual([]);
	});

	test('cloud-only rows go to toLocal', () => {
		const cloud: MemoryRow[] = [
			{ id: 'c1', text: 'Cloud only note 1', createdAt: 100 },
			{ id: 'c2', text: 'Cloud only note 2', createdAt: 200 }
		];
		const result = reconcile([], cloud);
		expect(result.toCloud).toEqual([]);
		expect(result.toLocal).toEqual(cloud);
		expect(result.conflicts).toEqual([]);
	});

	test('the same note with different ids and different whitespace/case -> one entry in conflicts, zero in the other two lists', () => {
		const local: MemoryRow[] = [
			{ id: 'local-1', text: '  User Prefers   TypeScript\n', createdAt: 100 }
		];
		const cloud: MemoryRow[] = [{ id: 'cloud-1', text: 'user prefers typescript', createdAt: 200 }];
		const result = reconcile(local, cloud);
		expect(result.toCloud).toEqual([]);
		expect(result.toLocal).toEqual([]);
		expect(result.conflicts).toEqual([local[0]]);
	});

	test('a malformed row is ignored', () => {
		const local = [
			null,
			undefined,
			'not an object',
			{},
			{ id: 123, text: 'numeric id', createdAt: 10 },
			{ id: '', text: 'empty id', createdAt: 20 },
			{ id: '   ', text: 'whitespace id', createdAt: 30 },
			{ id: 'l1', text: '', createdAt: 40 },
			{ id: 'l2', text: '   \n  ', createdAt: 50 },
			{ id: 'l3', text: 999, createdAt: 60 },
			{ id: 'l-valid', text: 'Valid local note', createdAt: 70 }
		] as unknown as MemoryRow[];

		const cloud = [
			null,
			{ id: '', text: 'cloud empty id' },
			{ id: 'c-valid', text: 'Valid cloud note', createdAt: 80 }
		] as unknown as MemoryRow[];

		const result = reconcile(local, cloud);
		expect(result.toCloud).toEqual([{ id: 'l-valid', text: 'Valid local note', createdAt: 70 }]);
		expect(result.toLocal).toEqual([{ id: 'c-valid', text: 'Valid cloud note', createdAt: 80 }]);
		expect(result.conflicts).toEqual([]);

		// Safe with non-array inputs
		expect(reconcile(null as unknown as MemoryRow[], undefined as unknown as MemoryRow[])).toEqual({
			toCloud: [],
			toLocal: [],
			conflicts: []
		});
	});

	test('input order is preserved', () => {
		const local: MemoryRow[] = [
			{ id: 'l1', text: 'First local only', createdAt: 1 },
			{ id: 'l2', text: 'Shared A', createdAt: 2 },
			{ id: 'l3', text: 'Second local only', createdAt: 3 },
			{ id: 'l4', text: 'Shared B', createdAt: 4 }
		];
		const cloud: MemoryRow[] = [
			{ id: 'c1', text: 'First cloud only', createdAt: 10 },
			{ id: 'c2', text: 'Shared B', createdAt: 20 },
			{ id: 'c3', text: 'Second cloud only', createdAt: 30 },
			{ id: 'c4', text: 'Shared A', createdAt: 40 }
		];

		const result = reconcile(local, cloud);
		expect(result.toCloud.map((r) => r.id)).toEqual(['l1', 'l3']);
		expect(result.toLocal.map((r) => r.id)).toEqual(['c1', 'c3']);
		expect(result.conflicts.map((r) => r.id)).toEqual(['l2', 'l4']);
	});

	test('duplicate notes with same text result in one conflict entry, not one per side', () => {
		const local: MemoryRow[] = [
			{ id: 'l1', text: 'Duplicate note', createdAt: 1 },
			{ id: 'l2', text: 'duplicate   note', createdAt: 2 }
		];
		const cloud: MemoryRow[] = [
			{ id: 'c1', text: 'DUPLICATE NOTE', createdAt: 10 },
			{ id: 'c2', text: 'duplicate note', createdAt: 20 }
		];

		const result = reconcile(local, cloud);
		expect(result.toCloud).toEqual([]);
		expect(result.toLocal).toEqual([]);
		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0].id).toBe('l1');
	});

	test('identical notes with matching id and text are not conflicts', () => {
		const local: MemoryRow[] = [{ id: 'synced-1', text: 'Already synced', createdAt: 1 }];
		const cloud: MemoryRow[] = [{ id: 'synced-1', text: 'Already synced', createdAt: 1 }];

		const result = reconcile(local, cloud);
		expect(result.toCloud).toEqual([]);
		expect(result.toLocal).toEqual([]);
		expect(result.conflicts).toEqual([]);
	});
});

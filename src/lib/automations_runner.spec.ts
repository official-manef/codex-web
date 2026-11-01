import { describe, expect, it } from 'vitest';
import { type DueRow, decideRun, drainOrder, MAX_RUNS_PER_DRAIN } from './automations_runner';

const baseTime = 1_700_000_000_000;

function createRow(overrides: Partial<DueRow> = {}): DueRow {
	return {
		id: 'auto-1',
		prompt: 'summarize metrics',
		intervalMinutes: 15,
		nextRunAt: baseTime,
		enabled: true,
		failureCount: 0,
		...overrides
	};
}

describe('MAX_RUNS_PER_DRAIN', () => {
	it('exports 20 as batch drain limit', () => {
		expect(MAX_RUNS_PER_DRAIN).toBe(20);
	});
});

describe('decideRun precedence rules', () => {
	it('precedence 1: disabled row reports disabled even when overdue, over cap, empty, or invalid interval', () => {
		const row = createRow({
			enabled: false,
			nextRunAt: baseTime - 10_000,
			failureCount: 10,
			prompt: '   ',
			intervalMinutes: 999
		});
		expect(decideRun(row, baseTime)).toEqual({ run: false, reason: 'disabled' });
	});

	it('precedence 1: disabled and overdue row reports disabled, not not_due', () => {
		const row = createRow({
			enabled: false,
			nextRunAt: baseTime - 5000
		});
		expect(decideRun(row, baseTime)).toEqual({ run: false, reason: 'disabled' });
	});

	it('precedence 2: row with >= MAX_FAILURES reports over_cap even when prompt is empty or interval invalid or due', () => {
		const rowWithEmptyPrompt = createRow({
			failureCount: 3,
			prompt: '   ',
			intervalMinutes: 999,
			nextRunAt: baseTime - 1000
		});
		expect(decideRun(rowWithEmptyPrompt, baseTime)).toEqual({ run: false, reason: 'over_cap' });
	});

	it('precedence 2: row with 3 failures and a due time reports over_cap', () => {
		const row = createRow({
			failureCount: 3,
			nextRunAt: baseTime - 1000
		});
		expect(decideRun(row, baseTime)).toEqual({ run: false, reason: 'over_cap' });
	});

	it('precedence 3: empty or whitespace prompt reports empty_prompt even when interval is invalid or due', () => {
		const emptyRow = createRow({
			prompt: '',
			intervalMinutes: 999,
			nextRunAt: baseTime - 1000
		});
		expect(decideRun(emptyRow, baseTime)).toEqual({ run: false, reason: 'empty_prompt' });

		const whitespaceRow = createRow({
			prompt: '  \n\t  ',
			intervalMinutes: 999,
			nextRunAt: baseTime - 1000
		});
		expect(decideRun(whitespaceRow, baseTime)).toEqual({ run: false, reason: 'empty_prompt' });
	});

	it('precedence 4: invalid interval reports over_cap', () => {
		const invalidIntervalRow = createRow({
			intervalMinutes: 45,
			nextRunAt: baseTime - 1000
		});
		expect(decideRun(invalidIntervalRow, baseTime)).toEqual({ run: false, reason: 'over_cap' });

		const zeroIntervalRow = createRow({
			intervalMinutes: 0,
			nextRunAt: baseTime - 1000
		});
		expect(decideRun(zeroIntervalRow, baseTime)).toEqual({ run: false, reason: 'over_cap' });
	});

	it('precedence 5: future nextRunAt reports not_due', () => {
		const futureRow = createRow({
			nextRunAt: baseTime + 10_000
		});
		expect(decideRun(futureRow, baseTime)).toEqual({ run: false, reason: 'not_due' });
	});

	it('precedence 5: non-finite nextRunAt (NaN or Infinity) reports not_due', () => {
		const nanRow = createRow({
			nextRunAt: Number.NaN
		});
		expect(decideRun(nanRow, baseTime)).toEqual({ run: false, reason: 'not_due' });

		const infRow = createRow({
			nextRunAt: Number.POSITIVE_INFINITY
		});
		expect(decideRun(infRow, baseTime)).toEqual({ run: false, reason: 'not_due' });
	});

	it('precedence 5: non-finite now (NaN or Infinity) reports not_due', () => {
		const row = createRow({
			nextRunAt: baseTime
		});
		expect(decideRun(row, Number.NaN)).toEqual({ run: false, reason: 'not_due' });
		expect(decideRun(row, Number.POSITIVE_INFINITY)).toEqual({ run: false, reason: 'not_due' });
	});

	it('precedence 6: decideRun at exactly nextRunAt === now runs', () => {
		const row = createRow({
			nextRunAt: baseTime
		});
		expect(decideRun(row, baseTime)).toEqual({ run: true, reason: 'due' });
	});

	it('precedence 6: decideRun when nextRunAt < now runs', () => {
		const row = createRow({
			nextRunAt: baseTime - 60_000
		});
		expect(decideRun(row, baseTime)).toEqual({ run: true, reason: 'due' });
	});
});

describe('drainOrder', () => {
	it('drops disabled, over-cap, empty prompt, and invalid interval rows', () => {
		const validRow = createRow({ id: 'valid', nextRunAt: baseTime });
		const disabledRow = createRow({ id: 'disabled', enabled: false, nextRunAt: baseTime });
		const overCapRow = createRow({ id: 'over_cap', failureCount: 3, nextRunAt: baseTime });
		const emptyPromptRow = createRow({ id: 'empty', prompt: '   ', nextRunAt: baseTime });
		const invalidIntervalRow = createRow({
			id: 'invalid_interval',
			intervalMinutes: 10,
			nextRunAt: baseTime
		});

		const result = drainOrder([
			disabledRow,
			validRow,
			overCapRow,
			emptyPromptRow,
			invalidIntervalRow
		]);
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('valid');
	});

	it('sorts eligible rows by nextRunAt ascending, then id ascending as tiebreaker', () => {
		const row1 = createRow({ id: 'c', nextRunAt: baseTime + 2000 });
		const row2 = createRow({ id: 'b', nextRunAt: baseTime + 1000 });
		const row3 = createRow({ id: 'a', nextRunAt: baseTime + 1000 });
		const row4 = createRow({ id: 'd', nextRunAt: baseTime });

		const result = drainOrder([row1, row2, row3, row4]);
		expect(result.map((r) => r.id)).toEqual(['d', 'a', 'b', 'c']);
	});

	it('caps at MAX_RUNS_PER_DRAIN (20) when given 25 eligible rows', () => {
		const rows: DueRow[] = [];
		for (let i = 25; i >= 1; i--) {
			rows.push(
				createRow({
					id: `row-${String(i).padStart(2, '0')}`,
					nextRunAt: baseTime + i * 1000
				})
			);
		}
		expect(rows).toHaveLength(25);

		const result = drainOrder(rows);
		expect(result).toHaveLength(20);
		// Should be sorted ascending by nextRunAt, meaning row-01 to row-20
		expect(result.map((r) => r.id)).toEqual([
			'row-01',
			'row-02',
			'row-03',
			'row-04',
			'row-05',
			'row-06',
			'row-07',
			'row-08',
			'row-09',
			'row-10',
			'row-11',
			'row-12',
			'row-13',
			'row-14',
			'row-15',
			'row-16',
			'row-17',
			'row-18',
			'row-19',
			'row-20'
		]);
	});

	it('is pure and does not mutate the input array', () => {
		const rowB = createRow({ id: 'b', nextRunAt: baseTime + 2000 });
		const rowA = createRow({ id: 'a', nextRunAt: baseTime + 1000 });
		const original = [rowB, rowA];
		const snapshot = [...original];

		drainOrder(original);
		expect(original).toEqual(snapshot);
	});
});

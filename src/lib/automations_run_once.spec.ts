import { describe, expect, test } from 'vitest';
import type { DueRow } from './automations_runner';
import { planRunOnce } from './automations_run_once';

function makeRow(overrides: Partial<DueRow> = {}): DueRow {
	return {
		id: 'test-1',
		prompt: 'Run task',
		intervalMinutes: 15,
		nextRunAt: 1000,
		enabled: true,
		failureCount: 0,
		...overrides
	};
}

describe('automations_run_once: planRunOnce', () => {
	test('empty rows -> empty plan, capped:false', () => {
		const plan = planRunOnce({ rows: [], now: 2000, maxRuns: 5 });
		expect(plan).toEqual({
			toRun: [],
			skipped: [],
			capped: false
		});
	});

	test('three due rows with maxRuns:2 -> 2 ids and capped:true, order follows nextRunAt', () => {
		const rows: DueRow[] = [
			makeRow({ id: 'row-3', nextRunAt: 3000 }),
			makeRow({ id: 'row-1', nextRunAt: 1000 }),
			makeRow({ id: 'row-2', nextRunAt: 2000 })
		];
		const plan = planRunOnce({ rows, now: 5000, maxRuns: 2 });
		expect(plan.toRun).toEqual(['row-1', 'row-2']);
		expect(plan.capped).toBe(true);
		expect(plan.skipped).toEqual([{ id: 'row-3', reason: 'due' }]);
	});

	test('a disabled row appears in skipped with "disabled"', () => {
		const rows: DueRow[] = [makeRow({ id: 'row-disabled', enabled: false })];
		const plan = planRunOnce({ rows, now: 5000, maxRuns: 5 });
		expect(plan.toRun).toEqual([]);
		expect(plan.skipped).toEqual([{ id: 'row-disabled', reason: 'disabled' }]);
		expect(plan.capped).toBe(false);
	});

	test('a 3-failure row with "over_cap"', () => {
		const rows: DueRow[] = [makeRow({ id: 'row-failed', failureCount: 3 })];
		const plan = planRunOnce({ rows, now: 5000, maxRuns: 5 });
		expect(plan.toRun).toEqual([]);
		expect(plan.skipped).toEqual([{ id: 'row-failed', reason: 'over_cap' }]);
		expect(plan.capped).toBe(false);
	});

	test('maxRuns:0 still runs one', () => {
		const rows: DueRow[] = [
			makeRow({ id: 'row-1', nextRunAt: 1000 }),
			makeRow({ id: 'row-2', nextRunAt: 2000 })
		];
		const plan = planRunOnce({ rows, now: 5000, maxRuns: 0 });
		expect(plan.toRun).toEqual(['row-1']);
		expect(plan.capped).toBe(true);
		expect(plan.skipped).toEqual([{ id: 'row-2', reason: 'due' }]);
	});

	test('a non-finite maxRuns caps at 20', () => {
		const rows: DueRow[] = Array.from({ length: 25 }, (_, i) =>
			makeRow({ id: `row-${i + 1}`, nextRunAt: 1000 + i * 10 })
		);
		const plan = planRunOnce({ rows, now: 5000, maxRuns: Infinity });
		expect(plan.toRun).toHaveLength(20);
		expect(plan.capped).toBe(true);
		expect(plan.skipped).toHaveLength(5);
	});

	test('no duplicate ids when the input contains a duplicate id', () => {
		const rows: DueRow[] = [
			makeRow({ id: 'row-dup', nextRunAt: 1000 }),
			makeRow({ id: 'row-dup', nextRunAt: 1000 })
		];
		const plan = planRunOnce({ rows, now: 5000, maxRuns: 5 });
		expect(plan.toRun).toEqual(['row-dup']);
		expect(plan.skipped).toEqual([]);
		expect(plan.capped).toBe(false);
	});
});

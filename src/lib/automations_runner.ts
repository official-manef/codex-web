/**
 * Automations runner: decision and batching logic for scheduled runs.
 *
 * This module decides, it does not execute. There is no model call here and
 * none is implied; a runner that calls a model still does not exist.
 */

import { MAX_FAILURES, isValidInterval } from './automations';

export type DueRow = {
	id: string;
	prompt: string;
	intervalMinutes: number;
	nextRunAt: number;
	enabled: boolean;
	failureCount: number;
};

export type RunDecision =
	| { run: true; reason: 'due' }
	| { run: false; reason: 'disabled' | 'not_due' | 'over_cap' | 'empty_prompt' };

export const MAX_RUNS_PER_DRAIN = 20;

/**
 * Decides whether a given automation row may run at timestamp `now`.
 *
 * Rules follow strict precedence:
 * 1. enabled === false -> { run: false, reason: 'disabled' }
 * 2. failureCount >= MAX_FAILURES -> { run: false, reason: 'over_cap' }
 * 3. prompt trimmed is empty -> { run: false, reason: 'empty_prompt' }
 * 4. !isValidInterval(intervalMinutes) -> { run: false, reason: 'over_cap' }
 * 5. nextRunAt > now (or non-finite timestamps) -> { run: false, reason: 'not_due' }
 * 6. otherwise -> { run: true, reason: 'due' }
 */
export function decideRun(row: DueRow, now: number): RunDecision {
	if (!row.enabled) {
		return { run: false, reason: 'disabled' };
	}
	if (row.failureCount >= MAX_FAILURES) {
		return { run: false, reason: 'over_cap' };
	}
	if (row.prompt.trim() === '') {
		return { run: false, reason: 'empty_prompt' };
	}
	if (!isValidInterval(row.intervalMinutes)) {
		return { run: false, reason: 'over_cap' };
	}
	if (!Number.isFinite(now) || !Number.isFinite(row.nextRunAt) || row.nextRunAt > now) {
		return { run: false, reason: 'not_due' };
	}
	return { run: true, reason: 'due' };
}

/**
 * Orders and bounds candidate automation rows for drain processing.
 *
 * Note: this is a pre-filter, not the authority. `decideRun` is the
 * authority per row; `drainOrder` only bounds the batch.
 */
export function drainOrder(rows: DueRow[]): DueRow[] {
	return rows
		.filter(
			(row) =>
				row.enabled &&
				row.failureCount < MAX_FAILURES &&
				row.prompt.trim() !== '' &&
				isValidInterval(row.intervalMinutes)
		)
		.sort((a, b) => {
			if (a.nextRunAt !== b.nextRunAt) {
				return a.nextRunAt - b.nextRunAt;
			}
			return a.id.localeCompare(b.id);
		})
		.slice(0, MAX_RUNS_PER_DRAIN);
}

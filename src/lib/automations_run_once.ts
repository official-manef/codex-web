// This plans; nothing here calls a model, and a runner that does is still not implemented.

import { decideRun, drainOrder, MAX_RUNS_PER_DRAIN, type DueRow } from './automations_runner';

export type RunOnceInput = { rows: DueRow[]; now: number; maxRuns: number };
export type RunOncePlan = {
	toRun: string[];
	skipped: { id: string; reason: string }[];
	capped: boolean;
};

export function planRunOnce(input: RunOnceInput): RunOncePlan {
	if (!input || !Array.isArray(input.rows)) {
		return { toRun: [], skipped: [], capped: false };
	}

	let effectiveMaxRuns: number;
	if (typeof input.maxRuns !== 'number' || !Number.isFinite(input.maxRuns)) {
		effectiveMaxRuns = MAX_RUNS_PER_DRAIN;
	} else if (input.maxRuns < 1) {
		effectiveMaxRuns = 1;
	} else {
		effectiveMaxRuns = Math.min(Math.floor(input.maxRuns), MAX_RUNS_PER_DRAIN);
	}

	const seenIds = new Set<string>();
	const uniqueRows: DueRow[] = [];
	for (const row of input.rows) {
		if (row && typeof row.id === 'string' && !seenIds.has(row.id)) {
			seenIds.add(row.id);
			uniqueRows.push(row);
		}
	}

	const decisions = new Map<string, ReturnType<typeof decideRun>>();
	const runnableRows: DueRow[] = [];

	for (const row of uniqueRows) {
		const decision = decideRun(row, input.now);
		decisions.set(row.id, decision);
		if (decision.run) {
			runnableRows.push(row);
		}
	}

	const orderedRunnable = drainOrder(runnableRows);
	const toRun = orderedRunnable.slice(0, effectiveMaxRuns).map((row) => row.id);
	const toRunSet = new Set(toRun);

	const skipped: { id: string; reason: string }[] = [];
	for (const row of uniqueRows) {
		if (!toRunSet.has(row.id)) {
			const decision = decisions.get(row.id)!;
			skipped.push({ id: row.id, reason: decision.reason });
		}
	}

	const capped = runnableRows.length > toRun.length;

	return {
		toRun,
		skipped,
		capped
	};
}

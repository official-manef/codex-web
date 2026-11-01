import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { error, isHttpError, json } from '@sveltejs/kit';
import { ConvexHttpClient } from 'convex/browser';
import { internal } from '../../../../convex/_generated/api';
import type { FunctionReference } from 'convex/server';
import { decideRun, MAX_RUNS_PER_DRAIN, type DueRow } from '$lib/automations_runner';
import { requireCapabilityAccess } from '$lib/server/access';
import { logEvent } from '$lib/server/log';
import type { RequestHandler } from './$types';

/**
 * Route: POST /api/automations/run
 *
 * Implements a read-only dry-run drain preview of scheduled automations.
 *
 * Data source choice & rationale:
 * We implemented the Convex query path via ConvexHttpClient querying `internal.automations.due`.
 * `src/convex/automations.ts` defines `due` as an internalQuery; when a Convex deployment
 * is configured (CONVEX_URL or PUBLIC_CONVEX_URL), this route connects as a server-side client
 * to inspect due rows. If Convex is unconfigured, unreachable, or the query fails, the route
 * gracefully falls back to an empty set ([]). This satisfies the requirement to preview
 * decisions for actual due automations when backed by Convex, while ensuring the route never
 * crashes, hangs, or mutates data when Convex is absent.
 *
 * Security & boundaries:
 * - Gated behind AUTOMATIONS_ENABLED === 'true' (returns 404 otherwise).
 * - Enforces requireCapabilityAccess(event).
 * - Read-only: strictly no writes, no mutations imported or invoked, and recordRun is never called.
 * - No model execution: returns executor: 'none'.
 * - Response never leaks prompt text; logging records only flat primitives (considered, wouldRun, outcome).
 * - Bounds processing to MAX_RUNS_PER_DRAIN rows.
 */

type RawAutomationDoc = {
	_id?: string;
	id?: string;
	prompt?: unknown;
	intervalMinutes?: unknown;
	nextRunAt?: unknown;
	enabled?: unknown;
	failureCount?: unknown;
};

export const POST: RequestHandler = async (event) => {
	if (env.AUTOMATIONS_ENABLED !== 'true') {
		error(404, 'Automations dry run is disabled.');
	}

	await requireCapabilityAccess(event);

	const now = Date.now();
	let dueDocs: RawAutomationDoc[] = [];

	const convexUrl = [env.CONVEX_URL, publicEnv.PUBLIC_CONVEX_URL].find(
		(url) => url && url.trim().length > 0
	);

	if (convexUrl) {
		try {
			const client = new ConvexHttpClient(convexUrl.trim().replace(/\/$/, ''));
			const queryRef = internal.automations.due as unknown as FunctionReference<
				'query',
				'public',
				{ now?: number },
				unknown
			>;
			const result = await client.query(queryRef, { now });
			if (Array.isArray(result)) {
				dueDocs = result as RawAutomationDoc[];
			}
		} catch {
			// When Convex is unreachable or internal functions cannot be queried,
			// fall back gracefully to an empty set so preview continues safely.
			dueDocs = [];
		}
	}

	try {
		const candidateRows: DueRow[] = dueDocs.slice(0, MAX_RUNS_PER_DRAIN).map((doc) => ({
			id: String(doc._id ?? doc.id ?? ''),
			prompt: typeof doc.prompt === 'string' ? doc.prompt : '',
			intervalMinutes: typeof doc.intervalMinutes === 'number' ? doc.intervalMinutes : 0,
			nextRunAt: typeof doc.nextRunAt === 'number' ? doc.nextRunAt : 0,
			enabled: Boolean(doc.enabled),
			failureCount: typeof doc.failureCount === 'number' ? doc.failureCount : 0
		}));

		const decisions = candidateRows.map((row) => {
			const decision = decideRun(row, now);
			return {
				id: row.id,
				run: decision.run,
				reason: decision.reason
			};
		});

		const considered = candidateRows.length;
		const wouldRun = decisions.filter((d) => d.run).length;

		await logEvent('info', 'automations.run', {
			considered,
			wouldRun,
			outcome: 'ok'
		});

		return json(
			{
				decisions,
				considered,
				wouldRun,
				executor: 'none',
				note: 'Dry run. No prompt is executed and no failure counter changes.'
			},
			{
				headers: {
					'Cache-Control': 'no-store'
				}
			}
		);
	} catch (e) {
		if (isHttpError(e)) {
			throw e;
		}
		await logEvent('warn', 'automations.run', { outcome: 'error' });
		error(500, 'Automations dry run failed.');
	}
};

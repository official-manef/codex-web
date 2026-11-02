import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { error, isHttpError, json } from '@sveltejs/kit';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';
import { decideRun, MAX_RUNS_PER_DRAIN, type DueRow } from '$lib/automations_runner';
import { planRunOnce } from '$lib/automations_run_once';
import { requireCapabilityAccess } from '$lib/server/access';
import { authConfiguration, getConvexToken } from '$lib/server/auth/session';
import { logEvent } from '$lib/server/log';
import type { RequestHandler } from './$types';

/**
 * Route: POST /api/automations/run
 *
 * Read-only dry-run preview of scheduled automations for the signed-in owner.
 *
 * `automations.due` is a **public** query, and this route reaches it as that user: the Convex
 * client is given the same OIDC id token the browser would send, so the handler's `requireUser`
 * sees a real identity and scopes the read to that owner. The previous version cast the internal
 * reference to a public one — an internal function is not callable over HTTP at all, the cast
 * only silenced the type error, and the `catch` below turned every call into `considered: 0`.
 *
 * Security & boundaries:
 * - Gated behind AUTOMATIONS_ENABLED === 'true' (404 otherwise) and requireCapabilityAccess.
 * - No identity, no data: without a session token the query refuses and this returns an empty
 *   preview. It never falls back to an unscoped read.
 * - Read-only: no mutation is imported or invoked; `recordRun` is never called.
 * - No model execution: executor is always 'none'.
 * - The response never leaks prompt text; logging records flat primitives only.
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

	// The owner whose automations this previews. Without a signed-in session there is no owner
	// and therefore nothing this route is allowed to read.
	const idToken = authConfiguration().enabled ? await getConvexToken(event) : null;

	const convexUrl = [env.CONVEX_URL, publicEnv.PUBLIC_CONVEX_URL].find(
		(url) => url && url.trim().length > 0
	);

	if (convexUrl && idToken) {
		try {
			const client = new ConvexHttpClient(convexUrl.trim().replace(/\/$/, ''));
			client.setAuth(idToken);
			const result = await client.query(api.automations.due, { now });
			if (Array.isArray(result)) {
				dueDocs = result as RawAutomationDoc[];
			}
		} catch {
			// Convex unreachable or the query refused: an empty preview, never an unscoped one.
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

		const plan = planRunOnce({
			rows: candidateRows,
			now,
			maxRuns: MAX_RUNS_PER_DRAIN
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
				plan,
				executor: 'none',
				note: 'Dry run. No prompt is executed and no failure counter changes. The plan is what a runner would claim, one row at a time, via claimRun.'
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

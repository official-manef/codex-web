import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { readJsonBody, requireCapabilityAccess } from '$lib/server/access';
import { hubConfigured, hubRequest } from '$lib/server/manef';
import type { RequestHandler } from './$types';

/**
 * The only paths this console exposes from the MANEF AI hub. Anything else in the hub — and
 * any path a caller invents — is not reachable, so the bridge cannot be widened by URL.
 */
const ROUTES = {
	'/api/manef/modules': { path: '/api/modules', method: 'GET', accept: [] },
	// `/ready` answers 503 with `{status:"unconfigured"}` by design; that is a real answer.
	'/api/manef/ready': { path: '/ready', method: 'GET', accept: [503] },
	// Liveness only. The hub answers `{status:"alive"}` and touches nothing else, which is what
	// `Devices`-style "test connection" needs before trusting the rest of the bridge.
	'/api/manef/health': { path: '/health', method: 'GET', accept: [] },
	// The hub's own example workflow, so the console can seed the planner without the operator
	// hand-writing 40 lines of JSON that must match four module descriptors exactly.
	'/api/manef/example': { path: '/api/example', method: 'GET', accept: [503] },
	'/api/manef/plan': { path: '/api/plan', method: 'POST', accept: [] }
} as const;

export const GET: RequestHandler = async (event) => {
	// Reading the registry is what the console renders, and the hub descriptors grant no
	// authority, so this path carries no identity: a deployment without sign-in would otherwise
	// show a dead panel instead of the honest "no hub configured" state it exists to show.
	const route = ROUTES[event.url.pathname as keyof typeof ROUTES];
	if (!route) error(404, 'Unknown MANEF hub path.');
	if (route.method !== 'GET') error(405, 'Use POST for this MANEF hub path.');
	return reply(route.path, route.accept, { method: 'GET' });
};

export const POST: RequestHandler = async (event) => {
	// A plan preview forwards a caller-supplied JSON body into the operator's loopback hub, so it
	// needs an identity even though nothing is executed. The three-path allowlist limits where the
	// body can land; it does not say who may send it.
	await requireCapabilityAccess(event);
	const route = ROUTES[event.url.pathname as keyof typeof ROUTES];
	if (!route) error(404, 'Unknown MANEF hub path.');
	if (route.method !== 'POST') error(405, 'Use GET for this MANEF hub path.');
	const body = await readJsonBody(event.request);
	return reply(route.path, route.accept, { method: 'POST', body: JSON.stringify(body) });
};

async function reply(
	path: string,
	accept: readonly number[],
	init: { method: 'GET' | 'POST'; body?: string }
) {
	// Not configured is a state, not a failure to hide: the console still renders, it just
	// has no hub to read. The shape matches the hub's own `/ready` answer.
	if (!hubConfigured(env.MANEF_HUB_URL))
		return json(
			{ error: { code: 'hub_unconfigured' }, liveAdapters: 'unconfigured' },
			{ status: 503, headers: { 'Cache-Control': 'no-store' } }
		);
	const result = await hubRequest(path, { ...init, accept });
	if (!result.ok)
		return json(
			{ error: { code: result.code } },
			{ status: result.status, headers: { 'Cache-Control': 'no-store' } }
		);
	return json(result.value, { headers: { 'Cache-Control': 'no-store' } });
}

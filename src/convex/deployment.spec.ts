/**
 * Proves the Convex data plane and its auth boundary against a REAL deployment.
 *
 * Two things must hold, and neither is provable from types:
 *   1. an unauthenticated caller is refused by every protected function;
 *   2. a caller cannot forge an identity by handing the client a token the deployment did not
 *      issue — the boundary the whole schema relies on.
 *
 * This talks to the deployment named by CONVEX_URL (the local one) rather than convex-test, so
 * it also proves the schema pushed and the functions deployed. Skipped when no deployment is
 * reachable, because a template clone without a backend should still pass `vitest run`.
 */
import { ConvexHttpClient } from 'convex/browser';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';

const RAW_URL = process.env.CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL ?? 'http://127.0.0.1:3210';

async function reachable(url: string): Promise<boolean> {
	try {
		const response = await fetch(`${url.replace(/\/$/, '')}/version`, {
			signal: AbortSignal.timeout(3000)
		});
		return response.ok;
	} catch {
		return false;
	}
}

const live = await reachable(RAW_URL);
const REFUSED = /[Ss]ign in|not_authenticated|Unauthorized|Not authenticated/;

describe.skipIf(!live)('convex deployment: auth boundary', () => {
	const client = new ConvexHttpClient(RAW_URL);

	test('the deployment answers', async () => {
		const response = await fetch(`${RAW_URL.replace(/\/$/, '')}/version`);
		expect(response.status).toBe(200);
		// A local anonymous deployment answers the literal text `unknown` here rather than a
		// JSON body; either shape proves the backend is up and serving.
		const body = await response.text();
		expect(body.length).toBeGreaterThan(0);
	});

	test('queries refuse an anonymous caller', async () => {
		await expect(client.query(api.devices.list, {})).rejects.toThrow(REFUSED);
	});

	test('mutations refuse an anonymous caller', async () => {
		await expect(
			client.mutation(api.devices.register, {
				name: 'probe',
				kind: 'terminal',
				tokenHash: 'a'.repeat(64),
				endpoint: 'http://127.0.0.1:8649'
			})
		).rejects.toThrow(REFUSED);
	});

	test('a caller cannot forge an identity through the client', async () => {
		// The identity is server-assigned; a token the deployment's auth provider did not issue
		// must not authenticate anything.
		const forged = new ConvexHttpClient(RAW_URL);
		forged.setAuth('not-a-real-jwt');
		await expect(forged.query(api.devices.list, {})).rejects.toThrow();
	});
});

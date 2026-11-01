/**
 * Proves the Convex data plane and its auth boundary against a REAL deployment.
 *
 * Two things must hold, and neither is provable from types:
 *   1. an unauthenticated caller is refused by every protected function;
 *   2. a caller cannot forge an identity by handing the client a token the deployment did not
 *      issue — the boundary the whole schema relies on.
 *
 * This talks to the deployment named by CONVEX_URL (the local one) rather than convex-test, so
 * it also proves the schema pushed and the functions deployed.
 *
 * Three deployment states exist and each is reported as itself (`deployment_probe.ts`):
 *
 *   absent  nothing answers            -> the three auth assertions skip, reason says a deployment is missing
 *   empty   answers, no functions      -> the three auth assertions skip, reason says "functions NOT pushed"
 *   ready   answers, functions pushed  -> the three auth assertions RUN and must pass
 *
 * Only the first two may skip, and neither may skip silently: the state test below always
 * executes and prints what it measured. `deployment_probe.spec.ts` pins that a reachable
 * deployment with functions can never take a skip branch.
 */
import { ConvexHttpClient } from 'convex/browser';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import {
	assertRefused,
	attempt,
	classifyAuthFailure,
	probeDeployment,
	skipReason,
	type DeploymentProbe
} from './deployment_probe';

const probe: DeploymentProbe = await probeDeployment();
const reason = skipReason(probe);
const ready = probe.state === 'ready';

describe('convex deployment: auth boundary', () => {
	// Never skipped. This is the line that makes the skip count explainable instead of
	// mysterious: it is the one test that always runs and states what the probe measured.
	test('the deployment state is classified, not assumed', () => {
		expect(['absent', 'empty', 'ready']).toContain(probe.state);
		expect(probe.detail.length).toBeGreaterThan(0);
		if (ready) {
			// A ready probe must name the URL it actually measured; no URL, no claim.
			expect(probe.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
			expect(reason).toBeNull();
		} else {
			// An absent or empty deployment must say which of the two it is.
			expect(reason).toMatch(probe.state === 'absent' ? /no Convex deployment/ : /NOT proven/);
			console.warn(`[convex] ${reason}`);
		}
	});

	// Built per test rather than at module scope: with no deployment there is no URL, and
	// `new ConvexHttpClient('')` throws before a single assertion could report the real state.
	const client = () => new ConvexHttpClient(probe.url);

	test('queries refuse an anonymous caller', async (ctx) => {
		if (!ready) ctx.skip(reason ?? 'deployment not ready');
		const rejection = await attempt(() => client().query(api.devices.list, {}));
		// Asserts the verdict, which `assertRefused` only enforces by throwing. Both are here
		// because this suite runs with `expect.requireAssertions`: a test whose only check is a
		// thrown error registers zero assertions and is failed by the runner itself.
		expect(classifyAuthFailure(rejection), 'anonymous query was not refused by auth').toBe(
			'refused'
		);
		assertRefused(rejection, 'query', probe.url);
	});

	test('mutations refuse an anonymous caller', async (ctx) => {
		if (!ready) ctx.skip(reason ?? 'deployment not ready');
		const rejection = await attempt(() =>
			client().mutation(api.devices.register, {
				name: 'probe',
				kind: 'terminal',
				tokenHash: 'a'.repeat(64),
				endpoint: 'http://127.0.0.1:8649'
			})
		);
		expect(classifyAuthFailure(rejection), 'anonymous mutation was not refused by auth').toBe(
			'refused'
		);
		assertRefused(rejection, 'mutation', probe.url);
	});

	test('a caller cannot forge an identity through the client', async (ctx) => {
		if (!ready) ctx.skip(reason ?? 'deployment not ready');
		// The identity is server-assigned; a token the deployment's auth provider did not issue
		// must not authenticate anything.
		const forged = new ConvexHttpClient(probe.url);
		forged.setAuth('not-a-real-jwt');
		const rejection = await attempt(() => forged.query(api.devices.list, {}));

		// A missing function answers nothing about the token, so it is not evidence either way.
		expect(classifyAuthFailure(rejection)).not.toBe('missing-functions');
		expect(rejection, 'a forged token authenticated a protected query').not.toBeNull();
	});
});

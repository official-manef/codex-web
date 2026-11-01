/**
 * Guards the gate against lying.
 *
 * `deployment.spec.ts` talks to a real backend, so it cannot run in CI. That is exactly how a
 * dead port (9999) let a reachable deployment (3210) go unnoticed while four security
 * assertions vanished from the run. These tests need no backend: they feed the classifier the
 * answers a deployment really gives, so the skip logic is pinned independently of one.
 *
 * If any of this fails, the auth spec has started claiming more or less than it measured.
 */
import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
	assertRefused,
	classifyAuthFailure,
	classifyQueryAnswer,
	deploymentUrl,
	probeDeployment,
	skipReason,
	type DeploymentProbe
} from './deployment_probe';

// Verbatim from the local dev server on 2026-11-02, Request ID and all.
const NO_FUNCTION_BODY =
	'{"status":"error","errorMessage":"[Request ID: a185ac72221d4c1c] Server Error\\nCould not find public function for \'devices:list\'.\\n"}';
const SIGN_IN_BODY = '{"status":"error","errorMessage":"[Request ID: 1] Please sign in.\\n"}';

function fakeFetch(
	answers: Record<string, { status?: number; body?: string } | Error>
): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		for (const [suffix, answer] of Object.entries(answers)) {
			if (!url.endsWith(suffix)) continue;
			if (answer instanceof Error) throw answer;
			return new Response(answer.body ?? '', { status: answer.status ?? 200 });
		}
		throw new Error(`unexpected fetch: ${url}`);
	}) as typeof fetch;
}

const UP_EMPTY = fakeFetch({
	'/version': { body: 'unknown' },
	'/api/query': { body: NO_FUNCTION_BODY }
});
const UP_READY = fakeFetch({
	'/version': { body: 'unknown' },
	'/api/query': { body: SIGN_IN_BODY }
});
const DOWN = fakeFetch({ '/version': new Error('ECONNREFUSED 127.0.0.1:9999') });

describe('deployment state', () => {
	test('nothing answering is "absent", and skipping says a deployment is missing', async () => {
		const probe = await probeDeployment('http://127.0.0.1:9999', DOWN);
		expect(probe.state).toBe('absent');
		expect(skipReason(probe)).toMatch(/no Convex deployment/);
	});

	test('answering with no functions pushed is "empty", not "absent"', async () => {
		const probe = await probeDeployment('http://127.0.0.1:3210', UP_EMPTY);
		expect(probe.state).toBe('empty');
		expect(probe.detail).toContain('no functions pushed');
		expect(skipReason(probe)).toMatch(/NOT proven/);
	});

	test('answering with functions pushed is "ready", and ready never skips', async () => {
		const probe = await probeDeployment('http://127.0.0.1:3210', UP_READY);
		expect(probe.state).toBe('ready');
		expect(skipReason(probe)).toBeNull();
	});

	test('the three states are mutually exclusive and each names itself', async () => {
		const probes = await Promise.all([
			probeDeployment('http://127.0.0.1:9999', DOWN),
			probeDeployment('http://127.0.0.1:3210', UP_EMPTY),
			probeDeployment('http://127.0.0.1:3210', UP_READY)
		]);
		expect(probes.map((p) => p.state)).toEqual(['absent', 'empty', 'ready']);
		// Every skip reason is distinct: a reader can tell which state produced it.
		const reasons = probes.map(skipReason).filter((r): r is string => r !== null);
		expect(new Set(reasons).size).toBe(reasons.length);
	});

	test('a deployment that answers /version but refuses /api/query is still not ready', async () => {
		const broken = fakeFetch({
			'/version': { body: 'unknown' },
			'/api/query': new Error('tunnel died')
		});
		const probe = await probeDeployment('http://127.0.0.1:3210', broken);
		expect(probe.state).toBe('empty');
		expect(skipReason(probe)).not.toBeNull();
	});

	test('an unreadable /api/query body claims nothing', async () => {
		const weird = fakeFetch({
			'/version': { body: 'unknown' },
			'/api/query': { body: '<html>proxy</html>' }
		});
		const probe = await probeDeployment('http://127.0.0.1:3210', weird);
		expect(probe.state).toBe('empty');
		expect(probe.detail).toContain('unreadable body');
	});
});

describe('the guard against a silent skip', () => {
	test('a reachable deployment with functions must not produce a skip reason', async () => {
		const probe = await probeDeployment('http://127.0.0.1:3210', UP_READY);
		// This is the assertion the old spec could not make: state == ready and a skip reason
		// cannot coexist, so "reachable with functions" can never be reported as skipped.
		expect(probe.state).toBe('ready');
		expect(skipReason(probe)).toBeNull();
	});

	test('the default URL is resolved per checkout, never guessed', () => {
		// The port is a property of this checkout's `.convex/local/default/config.json`, not a
		// constant: two Convex projects on one machine get different ports from the same 3210
		// sequence, so a literal here can point at somebody else's backend.
		expect(deploymentUrl({})).toBeNull();
		expect(deploymentUrl({ CONVEX_URL: '   ' })).toBeNull();
		// An explicit env value still wins, and a trailing slash is trimmed.
		expect(deploymentUrl({ CONVEX_URL: 'https://example.convex.cloud/' })).toBe(
			'https://example.convex.cloud'
		);
		expect(deploymentUrl({ PUBLIC_CONVEX_URL: 'https://a.convex.cloud' })).toBe(
			'https://a.convex.cloud'
		);
		expect(deploymentUrl({ CONVEX_URL: '', PUBLIC_CONVEX_URL: 'https://b.convex.cloud' })).toBe(
			'https://b.convex.cloud'
		);
	});

	test('the local deployment is read from this checkout config, not a constant', async () => {
		const { readLocalDeployment } = await import('../../scripts/convex-local.mjs');
		const config = JSON.stringify({ ports: { cloud: 3214, site: 3215 }, deploymentName: 'mine' });
		const read = (): string => config;
		expect(readLocalDeployment(read as never, 'x')).toEqual({
			port: 3214,
			url: 'http://127.0.0.1:3214',
			deploymentName: 'mine'
		});
		// Anything unusable is "no local deployment", never a guessed port.
		expect(readLocalDeployment((() => 'not json') as never, 'x')).toBeNull();
		expect(readLocalDeployment((() => '{}') as never, 'x')).toBeNull();
		expect(
			readLocalDeployment(
				(() => JSON.stringify({ ports: { cloud: '3214' }, deploymentName: 'x' })) as never,
				'x'
			)
		).toBeNull();
		expect(
			readLocalDeployment(
				(() => JSON.stringify({ ports: { cloud: 3214 }, deploymentName: '' })) as never,
				'x'
			)
		).toBeNull();
	});

	test('a checkout with no deployment reports that, instead of probing a guessed port', async () => {
		const probe = await probeDeployment(null);
		expect(probe.state).toBe('absent');
		expect(probe.detail).toMatch(/no port was guessed/);
		expect(skipReason(probe)).toMatch(/no Convex deployment/);
	});

	// The historic bug in one assertion: the gate pointed at a dead port and four security
	// tests disappeared from a green run. Cheap source scan, no backend needed.
	test('the spec cannot reintroduce a dead port or an unexplained skip', async () => {
		const source = await readFile(new URL('./deployment.spec.ts', import.meta.url), 'utf8');
		const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
		expect(code).not.toContain('9999');
		// The skip must be a function of the measured state, and its reason must be printed.
		expect(code).toMatch(/const reason = skipReason\(probe\)/);
		expect(code).toMatch(/ctx\.skip\(reason/);
		expect(code).toMatch(/probe\.state === 'ready'/);
		// The probe must run before anything is decided, at module scope so a skip still logs.
		expect(code).toMatch(/await probeDeployment\(\)/);
	});
});

describe('answers are classified before they are believed', () => {
	test('an error naming a missing function is not a success and not a refusal', () => {
		expect(classifyQueryAnswer(NO_FUNCTION_BODY)).toBe('missing-functions');
		expect(classifyQueryAnswer(SIGN_IN_BODY)).toBe('ready');
		expect(classifyQueryAnswer('{"status":"success","value":[]}')).toBe('ready');
		expect(classifyQueryAnswer('<html>')).toBe('unclassified');
	});

	test('"Server Error" from a missing function never counts as the boundary holding', () => {
		const missing =
			"[Request ID: 1] Server Error\nCould not find public function for 'devices:list'.\n";
		expect(classifyAuthFailure(missing)).toBe('missing-functions');
		expect(() => assertRefused(missing, 'query', 'http://127.0.0.1:3210')).toThrow(/NOT exercised/);
	});

	test('a rejection the classifier does not recognise fails loudly', () => {
		expect(classifyAuthFailure('Server Error')).toBe('unexpected');
		expect(() => assertRefused('Server Error', 'query', 'http://127.0.0.1:3210')).toThrow(
			/not by the auth boundary/
		);
		// A query that resolved at all is the worst case: the caller was let in.
		expect(() => assertRefused(null, 'query', 'http://127.0.0.1:3210')).toThrow(/was accepted/);
	});

	test('the real refusal message passes', () => {
		expect(classifyAuthFailure('Please sign in.')).toBe('refused');
		expect(() => assertRefused('Please sign in.', 'query', 'http://x')).not.toThrow();
		expect(() => assertRefused('not_authenticated', 'query', 'http://x')).not.toThrow();
	});

	test('every non-ready probe is reported, never silently dropped', async () => {
		const probes: DeploymentProbe[] = [
			await probeDeployment('http://127.0.0.1:9999', DOWN),
			await probeDeployment('http://127.0.0.1:3210', UP_EMPTY)
		];
		for (const probe of probes) {
			const reason = skipReason(probe);
			expect(reason, `${probe.state} produced no reason`).not.toBeNull();
			// The reason must name the URL and the missing thing, not just say "skipped".
			expect(reason).toContain(probe.url);
			expect(reason).toMatch(/NOT exercised|NOT proven/);
		}
	});
});

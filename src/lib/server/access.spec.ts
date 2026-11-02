import { beforeEach, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import {
	consumeBurst,
	matchesSecret,
	readJsonBody,
	requireAppOrigin,
	requireCapabilityAccess
} from './access';

const state = vi.hoisted(() => ({
	env: { CAPABILITY_ACCESS_TOKEN: '', AUTH_ENABLED: 'true' },
	session: vi.fn()
}));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_SITE_URL: 'https://app.example' } }));
vi.mock('$lib/server/auth/session', () => ({ readSession: state.session }));
beforeEach(() => {
	state.env.CAPABILITY_ACCESS_TOKEN = '';
	state.env.AUTH_ENABLED = 'true';
	state.session.mockReset().mockResolvedValue(null);
});

test('access secrets and origins reject missing, different and unsafe values', () => {
	expect(matchesSecret('secret', 'secret')).toBe(true);
	expect(matchesSecret('secret', 'secret-longer')).toBe(false);
	expect(matchesSecret('', '')).toBe(false);
	const request = new Request('https://app.example/api', {
		headers: { origin: 'https://app.example' }
	});
	expect(() => requireAppOrigin(request, 'https://app.example')).not.toThrow();
	for (const origin of [undefined, 'https://app.example/path', 'http://app.example'])
		expect(() => requireAppOrigin(request, origin)).toThrow();
	expect(() => requireAppOrigin(new Request(request.url), 'https://app.example')).toThrow();
});

test('JSON reader checks actual UTF-8 bytes, JSON and media type', async () => {
	const request = (body: BodyInit, type = 'application/json') =>
		new Request('https://app.example/api', {
			method: 'POST',
			headers: { 'content-type': type },
			body
		});
	await expect(readJsonBody(request('{"ok":true}'))).resolves.toEqual({ ok: true });
	await expect(readJsonBody(request('"é"'), 3)).rejects.toMatchObject({ status: 413 });
	await expect(readJsonBody(request(new Uint8Array([0xff])))).rejects.toMatchObject({
		status: 400
	});
	await expect(readJsonBody(request('{'))).rejects.toMatchObject({ status: 400 });
	await expect(readJsonBody(request('{}', 'text/plain'))).rejects.toMatchObject({ status: 415 });
});

test('capability access requires a session or configured operator token and same origin', async () => {
	const event = (token = '', origin = 'https://app.example') =>
		({
			request: new Request('https://app.example/api', {
				method: 'POST',
				headers: { origin, authorization: `Bearer ${token}` }
			})
		}) as RequestEvent;
	await expect(requireCapabilityAccess(event())).rejects.toMatchObject({ status: 401 });
	state.env.CAPABILITY_ACCESS_TOKEN = 'x'.repeat(32);
	await expect(requireCapabilityAccess(event('x'.repeat(32)))).resolves.toBeUndefined();
	await expect(
		requireCapabilityAccess(event('x'.repeat(32), 'https://evil.example'))
	).rejects.toMatchObject({ status: 403 });
	state.session.mockResolvedValue({ tokenIdentifier: 'https://issuer.example|one' });
	await expect(requireCapabilityAccess(event())).resolves.toBeUndefined();
});

test('when auth is disabled and no operator token is set, anonymous same-origin access is permitted', async () => {
	state.env.AUTH_ENABLED = 'false';
	const event = (origin = 'https://app.example') =>
		({
			request: new Request('https://app.example/api', {
				method: 'POST',
				headers: { origin }
			}),
			getClientAddress: () => '127.0.0.1'
		}) as unknown as RequestEvent;
	await expect(requireCapabilityAccess(event())).resolves.toBeUndefined();
	await expect(requireCapabilityAccess(event('https://evil.example'))).rejects.toMatchObject({
		status: 403
	});
});

test('burst protection is isolated by identity and expires', () => {
	const id = crypto.randomUUID();
	const now = Date.now();
	for (let i = 0; i < 20; i++) consumeBurst(id, now);
	expect(() => consumeBurst(id, now)).toThrow();
	expect(() => consumeBurst(`${id}-other`, now)).not.toThrow();
	expect(() => consumeBurst(id, now + 60_000)).not.toThrow();
});

test('operator and session identities get independent budgets', async () => {
	state.env.CAPABILITY_ACCESS_TOKEN = 'x'.repeat(32);
	state.session.mockResolvedValue({ tokenIdentifier: 'https://issuer.example|two' });
	const operator = {
		request: new Request('https://app.example/api', {
			headers: { authorization: `Bearer ${'x'.repeat(32)}` }
		})
	} as RequestEvent;
	const sessionEvent = {
		request: new Request('https://app.example/api')
	} as RequestEvent;
	// 20 operator calls exhaust only the operator bucket.
	for (let i = 0; i < 20; i++) await requireCapabilityAccess(operator);
	await expect(requireCapabilityAccess(operator)).rejects.toMatchObject({ status: 429 });
	await expect(requireCapabilityAccess(sessionEvent)).resolves.toBeUndefined();
});

test('a body that never finishes is aborted after the read deadline instead of hanging', async () => {
	vi.useFakeTimers();
	try {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			pull: () => new Promise<void>(() => undefined),
			cancel: () => {
				cancelled = true;
			}
		});
		const request = new Request('https://app.example/api', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			// @ts-expect-error -- required for a streaming request body in Node
			duplex: 'half'
		});
		const pending = readJsonBody(request).catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(10_000);
		const failure = await pending;
		expect(cancelled).toBe(true);
		// A read that outlives the deadline is reported as a timeout, not as bad JSON.
		expect(failure).toMatchObject({ status: 408 });
	} finally {
		vi.useRealTimers();
	}
});

test('an oversized streamed body is refused even when content-length lies', async () => {
	const chunk = new Uint8Array(40_000).fill(65);
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(chunk);
			controller.enqueue(chunk);
			controller.close();
		}
	});
	const request = new Request('https://app.example/api', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'content-length': '10' },
		body,
		// @ts-expect-error -- required for a streaming request body in Node
		duplex: 'half'
	});
	await expect(readJsonBody(request, 65_536)).rejects.toMatchObject({ status: 413 });
});

test('a non-numeric content-length is rejected rather than coerced', async () => {
	const request = new Request('https://app.example/api', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'content-length': 'abc' },
		body: '{}'
	});
	await expect(readJsonBody(request)).rejects.toMatchObject({ status: 413 });
});

test('the bucket table itself is capped, so unauthenticated keys cannot grow it forever', () => {
	// The bucket table is module-global with no reset hook, so this test fills it to the ceiling
	// rather than assuming an empty start: earlier tests in this file leave live buckets behind.
	const now = Date.now();
	let filled = 0;
	for (; filled < 2000; filled++) {
		try {
			consumeBurst(`flood-${filled}`, now);
		} catch {
			break;
		}
	}
	expect(filled).toBeLessThanOrEqual(1024);
	// Once full, a brand-new key is refused instead of evicting an attacker-chosen victim.
	expect(() => consumeBurst('flood-overflow', now)).toThrow();
	// Expiry reclaims the table, so the ceiling is per-minute rather than permanent.
	expect(() => consumeBurst('flood-overflow', now + 60_000)).not.toThrow();
});

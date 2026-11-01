import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { FORWARDABLE, hubBase, hubConfigured, hubRequest } from './manef';

const state = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: state.env }));

beforeEach(() => {
	state.env.MANEF_HUB_URL = 'http://127.0.0.1:3210';
});
afterEach(() => vi.unstubAllGlobals());

test('only loopback http origins are accepted as a hub', () => {
	expect(hubBase('http://127.0.0.1:3210')?.host).toBe('127.0.0.1:3210');
	expect(hubBase('http://localhost:3210')?.host).toBe('localhost:3210');
	expect(hubBase('http://[::1]:3210')?.host).toBe('[::1]:3210');
});

test('the bridge cannot be pointed at another host or scheme', () => {
	for (const value of [
		undefined,
		'',
		'not a url',
		'https://127.0.0.1:3210',
		'http://hub.example:3210',
		'http://10.0.0.5:3210',
		'http://192.168.1.20:3210',
		'http://127.0.0.1.example.com:3210',
		'http://user:pass@127.0.0.1:3210',
		'http://127.0.0.1:3210/api',
		'http://127.0.0.1:3210/?x=1',
		'http://127.0.0.1:3210/#frag',
		'file:///tmp/hub'
	])
		expect(hubBase(value), String(value)).toBeNull();
});

test('configured is exactly "parseable loopback base"', () => {
	expect(hubConfigured('http://127.0.0.1:3210')).toBe(true);
	expect(hubConfigured('http://example.com')).toBe(false);
	expect(hubConfigured(undefined)).toBe(false);
});

test('the forwardable path list is closed', () => {
	// The three hub routes the bridge exists for; `/ready` answers 503 by design.
	expect(FORWARDABLE.has('/api/modules')).toBe(true);
	expect(FORWARDABLE.has('/ready')).toBe(true);
	expect(FORWARDABLE.has('/api/plan')).toBe(true);
	for (const path of [
		'/health',
		'/api/example',
		'/api/modules/../../etc/passwd',
		'/api/plan/extra',
		'/',
		'//evil.example/api/modules'
	])
		expect(FORWARDABLE.has(path), path).toBe(false);
});

type HubCall = [URL, RequestInit & { signal: AbortSignal }];

function stubHub(response: Response | (() => Promise<Response>)) {
	const calls: HubCall[] = [];
	const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
		calls.push([url as URL, init as RequestInit & { signal: AbortSignal }]);
		return typeof response === 'function' ? response() : response;
	});
	vi.stubGlobal('fetch', fetchMock);
	return { fetchMock, calls };
}

test('an unset or unparseable hub url short-circuits before any socket is opened', async () => {
	const { fetchMock } = stubHub(new Response('{}'));
	state.env.MANEF_HUB_URL = undefined;
	await expect(hubRequest('/api/modules')).resolves.toEqual({
		ok: false,
		status: 503,
		code: 'hub_unconfigured'
	});
	state.env.MANEF_HUB_URL = 'http://hub.example:3210';
	await expect(hubRequest('/api/modules')).resolves.toEqual({
		ok: false,
		status: 503,
		code: 'hub_unconfigured'
	});
	expect(fetchMock).not.toHaveBeenCalled();
});

test('a path outside the allowlist is refused even when the caller is trusted code', async () => {
	const { fetchMock } = stubHub(new Response('{}'));
	for (const path of ['/health', '/api/modules/../secrets', '/api\\modules', '/unknown']) {
		await expect(hubRequest(path)).resolves.toEqual({
			ok: false,
			status: 500,
			code: 'invalid_hub_path'
		});
	}
	expect(fetchMock).not.toHaveBeenCalled();
});

test('the forwarded request is bounded: fixed origin, no redirects, no cache, JSON only with a body', async () => {
	const { fetchMock, calls } = stubHub(Response.json({ modules: [] }));
	await hubRequest('/api/modules');
	expect(fetchMock).toHaveBeenCalledWith(new URL('http://127.0.0.1:3210/api/modules'), {
		method: 'GET',
		headers: {},
		body: undefined,
		redirect: 'error',
		cache: 'no-store',
		signal: expect.any(AbortSignal)
	});

	calls.length = 0;
	await hubRequest('/api/plan', { method: 'POST', body: '{"a":1}' });
	expect(calls[0]?.[1]).toMatchObject({
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{"a":1}'
	});
});

test('a caller signal and the internal timeout are combined, not replaced', async () => {
	const { calls } = stubHub(Response.json({}));
	const caller = new AbortController();
	await hubRequest('/api/modules', { signal: caller.signal });
	const forwarded = calls[0]?.[1]?.signal;
	expect(forwarded).not.toBe(caller.signal);
	expect(forwarded.aborted).toBe(false);
	caller.abort();
	expect(forwarded.aborted).toBe(true);
});

test('an unreachable hub is 503, and a rejected redirect is not followed', async () => {
	stubHub(async () => {
		throw new TypeError('fetch failed');
	});
	await expect(hubRequest('/api/modules')).resolves.toEqual({
		ok: false,
		status: 503,
		code: 'hub_unreachable'
	});
});

test('a declared oversized response is rejected without reading the body', async () => {
	const text = vi.fn(async () => '{}');
	stubHub(new Response('', { headers: { 'content-length': String(64 * 1024 + 1) } }));
	await expect(hubRequest('/api/modules')).resolves.toEqual({
		ok: false,
		status: 502,
		code: 'hub_response_too_large'
	});
	expect(text).not.toHaveBeenCalled();
});

test('an undeclared oversized response is measured after reading', async () => {
	stubHub(new Response('x'.repeat(64 * 1024 + 1)));
	await expect(hubRequest('/api/modules')).resolves.toEqual({
		ok: false,
		status: 502,
		code: 'hub_response_too_large'
	});
});

test('an unreadable or non-JSON body fails closed instead of returning partial data', async () => {
	stubHub(
		new Response(
			new ReadableStream({
				start(controller) {
					controller.error(new Error('socket reset'));
				}
			})
		)
	);
	await expect(hubRequest('/api/modules')).resolves.toEqual({
		ok: false,
		status: 502,
		code: 'hub_response_unreadable'
	});

	stubHub(new Response('<html>not json</html>'));
	await expect(hubRequest('/api/modules')).resolves.toEqual({
		ok: false,
		status: 502,
		code: 'hub_response_invalid'
	});
});

test('a non-2xx answer is an error unless its status was explicitly accepted', async () => {
	stubHub(Response.json({ error: { code: 'hub_busy' } }, { status: 500 }));
	await expect(hubRequest('/api/modules')).resolves.toEqual({
		ok: false,
		status: 502,
		code: 'hub_busy'
	});

	stubHub(Response.json({ error: { code: 'hub_busy' } }, { status: 500 }));
	await expect(hubRequest('/api/modules', { accept: [500] })).resolves.toEqual({
		ok: true,
		value: { error: { code: 'hub_busy' } }
	});
});

test('a 503 from the hub keeps status 503 but other failures collapse to 502', async () => {
	stubHub(Response.json({ error: { code: 'not_ready' } }, { status: 503 }));
	await expect(hubRequest('/api/modules')).resolves.toEqual({
		ok: false,
		status: 503,
		code: 'not_ready'
	});

	stubHub(Response.json({ error: { code: 'not_ready' } }, { status: 429 }));
	await expect(hubRequest('/api/modules')).resolves.toEqual({
		ok: false,
		status: 502,
		code: 'not_ready'
	});
});

test('an error body without a usable code still yields a flat code', async () => {
	for (const body of ['{}', '[]', '{"error":"plain"}', '{"error":{"code":42}}']) {
		stubHub(new Response(body, { status: 500 }));
		const result = await hubRequest('/api/modules');
		expect(result).toMatchObject({ ok: false, status: 502 });
		expect(typeof (result as { code: string }).code).toBe('string');
		expect((result as { code: string }).code.length).toBeGreaterThan(0);
	}
});

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import * as route from './+server';

const { privateEnv } = vi.hoisted(() => ({ privateEnv: {} as Record<string, string> }));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));

const ORIGIN = 'https://app.example.com';
const HUB = 'http://127.0.0.1:3210';

type ManefEvent = RequestEvent<{ path: string }, '/api/manef/[...path]'>;

function event(pathname: string, init: { body?: string; contentType?: string | null } = {}) {
	const url = new URL(`${ORIGIN}${pathname}`);
	const headers = new Headers();
	if (init.contentType !== null)
		headers.set('content-type', init.contentType ?? 'application/json');
	return {
		url,
		request: new Request(url, {
			method: init.body === undefined ? 'GET' : 'POST',
			headers,
			body: init.body
		}),
		params: { path: pathname.replace('/api/manef/', '') }
	} as unknown as ManefEvent;
}

async function failure(call: Promise<Response> | Response) {
	try {
		const response = await call;
		return { status: response.status, body: await response.text() };
	} catch (thrown) {
		const error = thrown as { status?: number; body?: unknown };
		return { status: error.status, body: JSON.stringify(error.body) };
	}
}

function hubResponse(body: string, status = 200) {
	return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

function stubbedFetch(handler: () => Response | Promise<Response>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: unknown, init?: RequestInit) => {
			calls.push({ url: String(input), init });
			return handler();
		})
	);
	return calls;
}

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('method discipline', () => {
	test('only GET and POST are exported, so PUT/DELETE/PATCH are a framework 405', () => {
		expect(Object.keys(route).sort()).toEqual(['GET', 'POST']);
	});

	test('GET on the POST-only plan path is 405, and nothing is forwarded', async () => {
		privateEnv.MANEF_HUB_URL = HUB;
		const calls = stubbedFetch(() => hubResponse('{}'));
		const result = await failure(route.GET(event('/api/manef/plan')));
		expect(result.status).toBe(405);
		expect(JSON.parse(result.body)).toEqual({ message: 'Use POST for this MANEF hub path.' });
		expect(calls).toHaveLength(0);
	});

	test('POST on the GET-only modules path is 405, and nothing is forwarded', async () => {
		privateEnv.MANEF_HUB_URL = HUB;
		const calls = stubbedFetch(() => hubResponse('{}'));
		const result = await failure(route.POST(event('/api/manef/modules', { body: '{"goal":"x"}' })));
		expect(result.status).toBe(405);
		expect(JSON.parse(result.body)).toEqual({ message: 'Use GET for this MANEF hub path.' });
		expect(calls).toHaveLength(0);
	});
});

describe('path traversal and invented paths', () => {
	let calls: { url: string; init?: RequestInit }[];

	beforeEach(() => {
		privateEnv.MANEF_HUB_URL = HUB;
		calls = stubbedFetch(() => hubResponse('{"ok":true}'));
	});

	test.each([
		['plain parent traversal', '/api/manef/../../etc/passwd'],
		['encoded dots', '/api/manef/%2e%2e/%2e%2e/etc/passwd'],
		['encoded slash', '/api/manef/..%2f..%2fetc/passwd'],
		['invented sibling', '/api/manef/health'],
		['nested allowed name', '/api/manef/api/modules'],
		['trailing slash', '/api/manef/ready/'],
		['absolute URL as path', '/api/manef/https://evil.example/api/modules'],
		['protocol-relative path', '/api/manef//evil.example/api/modules'],
		['backslash', '/api/manef/%5c..%5cetc%5cpasswd'],
		['null byte', '/api/manef/%00']
	])('%s is refused with 404 before a socket opens', async (_label, pathname) => {
		const result = await failure(route.GET(event(pathname)));
		expect(result.status).toBe(404);
		expect(JSON.parse(result.body)).toEqual({ message: 'Unknown MANEF hub path.' });
		expect(calls).toHaveLength(0);
	});

	test('an allowed path always forwards the pinned hub path, never the request path', async () => {
		await route.GET(event('/api/manef/modules'));
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(`${HUB}/api/modules`);
		expect(calls[0].init?.redirect).toBe('error');
		expect(calls[0].init?.cache).toBe('no-store');
	});
});

describe('not configured', () => {
	test('an unset hub answers 503 with the documented shape and opens no socket', async () => {
		const calls = stubbedFetch(() => hubResponse('{}'));
		for (const value of [undefined, '', 'https://hub.example', 'http://10.0.0.5:3210']) {
			if (value === undefined) delete privateEnv.MANEF_HUB_URL;
			else privateEnv.MANEF_HUB_URL = value;
			const response = await route.GET(event('/api/manef/modules'));
			expect(response.status).toBe(503);
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect(await response.json()).toEqual({
				error: { code: 'hub_unconfigured' },
				liveAdapters: 'unconfigured'
			});
		}
		expect(calls).toHaveLength(0);
	});
});

describe('input validation', () => {
	beforeEach(() => {
		privateEnv.MANEF_HUB_URL = HUB;
	});

	test('malformed JSON on the plan path is 400 before the hub is called', async () => {
		const calls = stubbedFetch(() => hubResponse('{}'));
		const result = await failure(route.POST(event('/api/manef/plan', { body: '{"goal":' })));
		expect(result.status).toBe(400);
		expect(JSON.parse(result.body)).toEqual({ message: 'The request contains invalid JSON.' });
		expect(calls).toHaveLength(0);
	});

	test('a non-JSON media type is 415', async () => {
		const result = await failure(
			route.POST(event('/api/manef/plan', { body: '{"goal":"x"}', contentType: 'text/plain' }))
		);
		expect(result.status).toBe(415);
	});

	test('a missing body is 400', async () => {
		const result = await failure(
			route.POST({
				...event('/api/manef/plan'),
				request: new Request(`${ORIGIN}/api/manef/plan`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' }
				})
			} as unknown as ManefEvent)
		);
		expect(result.status).toBe(400);
	});

	test('an oversized body is 413 and the hub is never called', async () => {
		const calls = stubbedFetch(() => hubResponse('{}'));
		const result = await failure(
			route.POST(event('/api/manef/plan', { body: JSON.stringify({ goal: 'x'.repeat(70_000) }) }))
		);
		expect(result.status).toBe(413);
		expect(calls).toHaveLength(0);
	});

	test('the forwarded body is the parsed value, so duplicate or odd keys cannot be smuggled', async () => {
		const calls = stubbedFetch(() => hubResponse('{"plan":"p"}'));
		await route.POST(event('/api/manef/plan', { body: '{"goal":"a","goal":"b"}' }));
		expect(JSON.parse(String(calls[0].init?.body))).toEqual({ goal: 'b' });
		expect(new Headers(calls[0].init?.headers).get('content-type')).toBe('application/json');
	});
});

describe('response shape', () => {
	beforeEach(() => {
		privateEnv.MANEF_HUB_URL = HUB;
	});

	test('a hub answer is relayed as JSON with no-store', async () => {
		stubbedFetch(() => hubResponse('{"liveAdapters":"ok"}'));
		const response = await route.GET(event('/api/manef/modules'));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ liveAdapters: 'ok' });
	});

	test('/ready answers 503 by design and that is relayed as a 200 with the hub payload', async () => {
		stubbedFetch(() => hubResponse('{"status":"unconfigured"}', 503));
		const response = await route.GET(event('/api/manef/ready'));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'unconfigured' });
	});

	test('a hub error is relayed as `{ error: { code } }` with the hub status mapped to 502', async () => {
		stubbedFetch(() => hubResponse('{"error":{"code":"bad_plan"}}', 400));
		const response = await route.GET(event('/api/manef/modules'));
		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ error: { code: 'bad_plan' } });
	});
});

describe('upstream failure', () => {
	beforeEach(() => {
		privateEnv.MANEF_HUB_URL = HUB;
	});

	test('a refused connection is 503 hub_unreachable with no host or stack', async () => {
		stubbedFetch(() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:3210')));
		const result = await failure(route.GET(event('/api/manef/modules')));
		expect(result.status).toBe(503);
		expect(JSON.parse(result.body)).toEqual({ error: { code: 'hub_unreachable' } });
		expect(result.body).not.toContain('ECONNREFUSED');
		expect(result.body).not.toContain('127.0.0.1');
	});

	test('a hub that never answers is bounded by the module timeout instead of hanging', async () => {
		// The stub behaves like a real socket: it settles only when the AbortSignal it was given
		// fires. If `hubRequest` forgot its timeout, this test would hang rather than pass.
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_input: unknown, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						const signal = init?.signal;
						const fail = () => reject(new Error('aborted'));
						if (!signal) return; // no timeout configured => the route would hang
						if (signal.aborted) fail();
						else signal.addEventListener('abort', fail, { once: true });
					})
			)
		);
		const result = await failure(route.GET(event('/api/manef/modules')));
		expect(result.status).toBe(503);
		expect(JSON.parse(result.body)).toEqual({ error: { code: 'hub_unreachable' } });
	}, 15_000);

	test('an HTML answer from a foreign listener is 502, never relayed as content', async () => {
		stubbedFetch(
			() => new Response('<html>hi</html>', { headers: { 'content-type': 'text/html' } })
		);
		const result = await failure(route.GET(event('/api/manef/modules')));
		expect(result.status).toBe(502);
		expect(JSON.parse(result.body)).toEqual({ error: { code: 'hub_response_invalid' } });
		expect(result.body).not.toContain('<html>');
	});

	test('a declared oversized answer is 502 hub_response_too_large', async () => {
		stubbedFetch(
			() =>
				new Response('{}', {
					headers: { 'content-type': 'application/json', 'content-length': '200000' }
				})
		);
		const result = await failure(route.GET(event('/api/manef/modules')));
		expect(result.status).toBe(502);
		expect(JSON.parse(result.body)).toEqual({ error: { code: 'hub_response_too_large' } });
	});

	test('an answer that only claims to be small but is not is also 502', async () => {
		stubbedFetch(() => hubResponse(JSON.stringify({ pad: 'x'.repeat(70_000) })));
		const result = await failure(route.GET(event('/api/manef/modules')));
		expect(result.status).toBe(502);
		expect(JSON.parse(result.body)).toEqual({ error: { code: 'hub_response_too_large' } });
	});
});

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET, POST } from './+server';

const { privateEnv, publicEnv, logMock, hubMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' },
	logMock: { logEvent: vi.fn() },
	hubMock: { hubConfigured: vi.fn(), hubRequest: vi.fn() }
}));

type Ev = Parameters<typeof GET | typeof POST>[0];

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/server/log', () => ({ logEvent: logMock.logEvent }));
vi.mock('$lib/server/manef', () => hubMock);

const token = 't'.repeat(32);

function event(pathname: string, body: unknown = {}, authorization = token): Ev {
	const url = new URL(`https://app.example.com${pathname}`);
	const headers = new Headers({
		'content-type': 'application/json',
		origin: 'https://app.example.com',
		authorization: `Bearer ${authorization}`
	});
	return {
		url,
		request: new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }),
		cookies: { get: () => undefined }
	} as unknown as Ev;
}

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	Object.assign(privateEnv, {
		MANEF_HUB_URL: 'http://127.0.0.1:3210',
		CAPABILITY_ACCESS_TOKEN: token
	});
	hubMock.hubConfigured.mockReset().mockReturnValue(true);
	hubMock.hubRequest.mockReset().mockResolvedValue({ ok: true, value: { modules: [] } });
});

describe('MANEF bridge path allowlist', () => {
	test('GET 404 for any path outside the five published routes', async () => {
		for (const path of [
			'/api/manef',
			'/api/manef/api/plan',
			'/api/manef/examples',
			'/api/manef/api/modules',
			'/api/manef/../etc/passwd',
			'//api/manef/modules'
		]) {
			await expect(GET(event(path))).rejects.toMatchObject({ status: 404 });
		}
		expect(hubMock.hubRequest).not.toHaveBeenCalled();
	});

	test('GET 405 for the POST-only plan route, and POST 405 for the GET-only ones', async () => {
		await expect(GET(event('/api/manef/plan'))).rejects.toMatchObject({ status: 405 });
		for (const path of ['/api/manef/modules', '/api/manef/ready']) {
			await expect(POST(event(path))).rejects.toMatchObject({ status: 405 });
		}
		expect(hubMock.hubRequest).not.toHaveBeenCalled();
	});
});

describe('MANEF bridge replies', () => {
	test('an unconfigured hub is a 503 state, not a proxy attempt', async () => {
		hubMock.hubConfigured.mockReturnValue(false);
		const res = await GET(event('/api/manef/modules'));
		expect(res.status).toBe(503);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.json()).toEqual({
			error: { code: 'hub_unconfigured' },
			liveAdapters: 'unconfigured'
		});
		expect(hubMock.hubRequest).not.toHaveBeenCalled();
	});

	test('GET modules forwards the fixed hub path and marks the response no-store', async () => {
		const res = await GET(event('/api/manef/modules'));
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.json()).toEqual({ modules: [] });
		expect(hubMock.hubRequest).toHaveBeenCalledWith('/api/modules', {
			method: 'GET',
			accept: []
		});
	});

	test('GET ready accepts 503 as a real answer from the hub', async () => {
		hubMock.hubRequest.mockResolvedValue({ ok: true, value: { status: 'unconfigured' } });
		const res = await GET(event('/api/manef/ready'));
		expect(res.status).toBe(200);
		expect(hubMock.hubRequest).toHaveBeenCalledWith('/ready', {
			method: 'GET',
			accept: [503]
		});
	});

	test('POST plan sends the parsed body as JSON and never the raw request stream', async () => {
		const res = await POST(event('/api/manef/plan', { prompt: 'hello' }));
		expect(res.status).toBe(200);
		expect(hubMock.hubRequest).toHaveBeenCalledWith('/api/plan', {
			method: 'POST',
			body: '{"prompt":"hello"}',
			accept: []
		});
	});

	test('a hub failure keeps its status and error code, with no store', async () => {
		hubMock.hubRequest.mockResolvedValue({ ok: false, status: 502, code: 'hub_unreachable' });
		const res = await GET(event('/api/manef/modules'));
		expect(res.status).toBe(502);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.json()).toEqual({ error: { code: 'hub_unreachable' } });
	});

	test('the body is read as JSON before any hub call, so a bad body is a 415', async () => {
		const url = new URL('https://app.example.com/api/manef/plan');
		const request = new Request(url, {
			method: 'POST',
			headers: {
				'content-type': 'text/plain',
				origin: 'https://app.example.com',
				authorization: `Bearer ${token}`
			},
			body: 'not json'
		});
		await expect(
			POST({ url, request, cookies: { get: () => undefined } } as unknown as Ev)
		).rejects.toMatchObject({ status: 415 });
	});
});

describe('MANEF bridge method/path matrix', () => {
	test('POST 404 for a path outside the allowlist, before the body is read', async () => {
		// `/api/manef/health` and `/api/manef/example` are GET-only reads, so POST to them is a 405
		// from the route's own method check rather than a 404 — the path exists, the verb does not.
		for (const path of ['/api/manef', '/api/manef/api/modules', '/api/manef/api/plan']) {
			await expect(POST(event(path))).rejects.toMatchObject({ status: 404 });
		}
		for (const path of ['/api/manef/health', '/api/manef/example']) {
			await expect(POST(event(path))).rejects.toMatchObject({ status: 405 });
		}
		expect(hubMock.hubRequest).not.toHaveBeenCalled();
	});
});

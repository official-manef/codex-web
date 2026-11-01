import { beforeEach, describe, expect, test, vi } from 'vitest';
import { POST } from './+server';

const { privateEnv, publicEnv, logMock, serverMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' as string | undefined },
	logMock: { logEvent: vi.fn() },
	serverMock: { statusMcpResponse: vi.fn() }
}));

type Ev = Parameters<typeof POST>[0];

// POST returns `MaybePromise<Response>`; awaiting it keeps the rejection type visible here.
async function failureOf(result: ReturnType<typeof POST>) {
	return Promise.resolve(result).catch((error: unknown) => error);
}

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/server/log', () => ({ logEvent: logMock.logEvent }));
vi.mock('$lib/server/mcp/server', () => serverMock);

// Each test gets its own token: `consumeBurst` is keyed by token and lives for a minute, so a
// shared token would make the 20-request ceiling leak between tests.
let token = 'm'.repeat(48);

function makeEvent(
	body: unknown,
	{
		authorization = `Bearer ${token}`,
		origin = 'https://app.example.com'
	}: { authorization?: string | null; origin?: string | null } = {}
): Ev {
	const url = new URL('https://app.example.com/api/mcp/server');
	const headers = new Headers({ 'content-type': 'application/json' });
	if (authorization) headers.set('authorization', authorization);
	if (origin) headers.set('origin', origin);
	return {
		url,
		request: new Request(url, {
			method: 'POST',
			headers,
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	} as unknown as Ev;
}

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	token = `${Math.random().toString(36).slice(2)}`.padEnd(48, 'm').slice(0, 48);
	Object.assign(privateEnv, { MCP_SERVER_ENABLED: 'true', MCP_SERVER_TOKEN: token });
	publicEnv.PUBLIC_SITE_URL = 'https://app.example.com';
	logMock.logEvent.mockReset().mockResolvedValue(undefined);
	serverMock.statusMcpResponse
		.mockReset()
		.mockImplementation(
			async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } })
		);
});

describe('/api/mcp/server POST', () => {
	test('404 when the MCP server is disabled', async () => {
		privateEnv.MCP_SERVER_ENABLED = 'false';
		await expect(POST(makeEvent({}))).rejects.toMatchObject({ status: 404 });
		expect(serverMock.statusMcpResponse).not.toHaveBeenCalled();
	});

	test('503 when the configured token is missing or outside the 32..4096 bound', async () => {
		for (const value of [undefined, 'short', 'x'.repeat(4097)]) {
			if (value === undefined) delete privateEnv.MCP_SERVER_TOKEN;
			else privateEnv.MCP_SERVER_TOKEN = value;
			await expect(POST(makeEvent({}))).rejects.toMatchObject({ status: 503 });
		}
		expect(serverMock.statusMcpResponse).not.toHaveBeenCalled();
	});

	test('401 for a missing or merely similar bearer token', async () => {
		// A trailing space is not listed: `Headers` trims it, so it is the same credential.
		for (const authorization of [
			null,
			'',
			token,
			`Bearer ${token}x`,
			`Basic ${token}`,
			`Bearer ${token.slice(1)}`
		]) {
			await expect(POST(makeEvent({}, { authorization }))).rejects.toMatchObject({ status: 401 });
		}
		expect(serverMock.statusMcpResponse).not.toHaveBeenCalled();
	});

	test('403 when an Origin header is present but is not this application', async () => {
		await expect(POST(makeEvent({}, { origin: 'https://evil.example' }))).rejects.toMatchObject({
			status: 403
		});
		expect(serverMock.statusMcpResponse).not.toHaveBeenCalled();
	});

	test('503 when PUBLIC_SITE_URL is unset, because origin cannot be proven', async () => {
		publicEnv.PUBLIC_SITE_URL = undefined;
		await expect(POST(makeEvent({}, { origin: 'https://app.example.com' }))).rejects.toMatchObject({
			status: 503
		});
	});

	test('an absent Origin header is accepted for non-browser MCP clients', async () => {
		const res = await POST(
			makeEvent({ jsonrpc: '2.0', method: 'tools/list', id: 1 }, { origin: null })
		);
		expect(res.status).toBe(200);
	});

	test('returns the MCP handler response unchanged (cache headers come from the handler)', async () => {
		const res = await POST(makeEvent({ jsonrpc: '2.0', method: 'tools/list', id: 1 }));
		expect(res.status).toBe(200);
		expect(serverMock.statusMcpResponse).toHaveBeenCalledWith(expect.any(Request), {
			jsonrpc: '2.0',
			method: 'tools/list',
			id: 1
		});
		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'mcp.server', {
			method: 'tools/list',
			status: 200,
			outcome: 'ok'
		});
	});

	test('only the JSON-RPC method name is logged, never params or ids', async () => {
		await POST(
			makeEvent({
				jsonrpc: '2.0',
				method: 'tools/call',
				id: 'client-secret-id',
				params: { name: 'starter_status', arguments: { leak: 'should-not-appear' } }
			})
		);
		const fields = logMock.logEvent.mock.calls[0][2];
		expect(fields).toEqual({ method: 'tools/call', status: 200, outcome: 'ok' });
		const written = JSON.stringify(logMock.logEvent.mock.calls);
		expect(written).not.toContain('should-not-appear');
		expect(written).not.toContain('client-secret-id');
	});

	test('unrecognised method shapes are logged as "unknown" instead of the raw value', async () => {
		// `makeEvent` sends strings verbatim, so pre-encoded JSON keeps these bodies parseable.
		const cases: unknown[] = [
			{ method: 'has space' },
			{ method: 'x'.repeat(65) },
			{ method: '1leading-digit' },
			{ method: 42 },
			null,
			'"plain string"',
			[]
		];
		for (const body of cases) {
			logMock.logEvent.mockClear();
			await POST(makeEvent(body));
			expect(logMock.logEvent.mock.calls[0][2].method).toBe('unknown');
		}
	});

	test('a handler failure becomes 500 and is logged without the payload', async () => {
		serverMock.statusMcpResponse.mockRejectedValue(new Error('transport exploded'));
		const failure = await failureOf(POST(makeEvent({ jsonrpc: '2.0', method: 'tools/call' })));
		expect(failure).toMatchObject({ status: 500 });
		expect(JSON.stringify(failure)).not.toContain('transport exploded');
		expect(logMock.logEvent).toHaveBeenCalledWith('warn', 'mcp.server', {
			method: 'tools/call',
			outcome: 'error'
		});
	});

	test('a non-JSON content type is rejected before the handler runs', async () => {
		const url = new URL('https://app.example.com/api/mcp/server');
		const request = new Request(url, {
			method: 'POST',
			headers: {
				'content-type': 'text/plain',
				authorization: `Bearer ${token}`,
				origin: 'https://app.example.com'
			},
			body: 'hello'
		});
		await expect(POST({ url, request } as unknown as Ev)).rejects.toMatchObject({
			status: 415
		});
		expect(serverMock.statusMcpResponse).not.toHaveBeenCalled();
	});

	test('the 21st request in a minute from one token is throttled', async () => {
		for (let i = 0; i < 20; i++) await POST(makeEvent({ jsonrpc: '2.0', method: 'ping' }));
		await expect(POST(makeEvent({ jsonrpc: '2.0', method: 'ping' }))).rejects.toMatchObject({
			status: 429
		});
	});
});

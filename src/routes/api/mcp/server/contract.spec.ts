import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import * as route from './+server';

const { privateEnv, publicEnv, logMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' },
	logMock: { logEvent: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/server/log', () => ({ logEvent: logMock.logEvent }));

const ORIGIN = 'https://app.example.com';
const ACCEPT = 'application/json, text/event-stream';
let tokenSeq = 0;

function serverToken() {
	tokenSeq++;
	return `mcp-server-token-${tokenSeq}`.padEnd(48, '0');
}

const toolsList = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

function event(
	init: {
		body?: string;
		authorization?: string;
		origin?: string | null;
		accept?: string | null;
		contentType?: string | null;
		path?: string;
	} = {}
) {
	const url = new URL(init.path ?? '/api/mcp/server', ORIGIN);
	const headers = new Headers();
	if (init.contentType !== null)
		headers.set('content-type', init.contentType ?? 'application/json');
	if (init.accept !== null) headers.set('accept', init.accept ?? ACCEPT);
	if (init.authorization) headers.set('authorization', init.authorization);
	if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
	return {
		url,
		request: new Request(url, { method: 'POST', headers, body: init.body ?? undefined }),
		cookies: { get: () => undefined, set: () => undefined, delete: () => undefined },
		setHeaders: vi.fn(),
		// The burst bucket is per caller address, so a fixed address would make one test's
		// 20-request ceiling leak into the next.
		getClientAddress: () => `10.${tokenSeq % 250}.0.1`
	} as unknown as RequestEvent<Record<string, never>, never>;
}

async function failure(created: RequestEvent<Record<string, never>, never>) {
	try {
		const response = await route.POST(created);
		return { status: response.status, body: await response.text() };
	} catch (thrown) {
		const error = thrown as { status?: number; body?: unknown };
		return { status: error.status, body: JSON.stringify(error.body) };
	}
}

function expectNoInternals(text: string, secrets: string[] = []) {
	expect(text).not.toMatch(/\n\s+at .+:\d+:\d+/);
	expect(text).not.toContain('/home/');
	for (const secret of secrets.filter(Boolean)) expect(text).not.toContain(secret);
}

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	publicEnv.PUBLIC_SITE_URL = ORIGIN;
	logMock.logEvent.mockReset().mockResolvedValue(undefined);
});

describe('method discipline', () => {
	test('only POST is exported, so GET/DELETE stream attempts are a framework 405', () => {
		expect(Object.keys(route).sort()).toEqual(['POST']);
	});
});

describe('feature disabled and misconfigured', () => {
	test('any value other than the exact "true" is 404 before the token is compared', async () => {
		for (const value of [undefined, 'false', 'TRUE', '1']) {
			privateEnv.MCP_SERVER_ENABLED = value as string;
			const result = await failure(
				event({ body: JSON.stringify(toolsList), authorization: 'Bearer anything' })
			);
			expect(result.status, String(value)).toBe(404);
			expect(JSON.parse(result.body)).toEqual({ message: 'MCP server is disabled.' });
		}
	});

	test('a missing or out-of-range server token is 503 and is never echoed', async () => {
		privateEnv.MCP_SERVER_ENABLED = 'true';
		for (const token of [undefined, 'x'.repeat(31), 'x'.repeat(4097)]) {
			if (token === undefined) delete privateEnv.MCP_SERVER_TOKEN;
			else privateEnv.MCP_SERVER_TOKEN = token;
			const result = await failure(
				event({ body: JSON.stringify(toolsList), authorization: `Bearer ${token ?? 'none'}` })
			);
			expect(result.status).toBe(503);
			expect(JSON.parse(result.body)).toEqual({ message: 'MCP server setup is incomplete.' });
			expectNoInternals(result.body, [token ?? '']);
		}
	});
});

describe('auth boundary', () => {
	let token: string;
	beforeEach(() => {
		token = serverToken();
		Object.assign(privateEnv, { MCP_SERVER_ENABLED: 'true', MCP_SERVER_TOKEN: token });
	});

	test('no header, wrong token and a prefix token are all 401 with the same body', async () => {
		for (const authorization of [
			undefined,
			'',
			`Bearer ${'z'.repeat(token.length)}`,
			`Bearer ${token.slice(0, -1)}`,
			token,
			`Basic ${token}`
		]) {
			const result = await failure(event({ body: JSON.stringify(toolsList), authorization }));
			expect(result.status, String(authorization)).toBe(401);
			expect(JSON.parse(result.body)).toEqual({ message: 'MCP authorization required.' });
			expectNoInternals(result.body, [token]);
		}
	});

	test('a valid token from a foreign origin is 403 and does not run the request', async () => {
		const result = await failure(
			event({
				body: JSON.stringify(toolsList),
				authorization: `Bearer ${token}`,
				origin: 'https://attacker.example'
			})
		);
		expect(result.status).toBe(403);
		expect(JSON.parse(result.body)).toEqual({
			message: 'This request must come from this application.'
		});
	});

	test('no Origin header skips the origin check because the bearer token is the credential', async () => {
		const response = await route.POST(
			event({ body: JSON.stringify(toolsList), authorization: `Bearer ${token}`, origin: null })
		);
		expect(response.status).toBe(200);
	});

	test('the burst limit is per caller address and answers 429 with a clean body', async () => {
		const authorization = `Bearer ${token}`;
		for (let attempt = 0; attempt < 20; attempt++)
			expect(
				(await route.POST(event({ body: JSON.stringify(toolsList), authorization }))).status
			).toBe(200);
		const limited = await failure(event({ body: JSON.stringify(toolsList), authorization }));
		expect(limited.status).toBe(429);
		expect(JSON.parse(limited.body)).toEqual({
			message: 'Too many requests. Try again in a minute.'
		});
	});
});

describe('input validation', () => {
	let token: string;
	let authorization: string;
	beforeEach(() => {
		token = serverToken();
		authorization = `Bearer ${token}`;
		Object.assign(privateEnv, { MCP_SERVER_ENABLED: 'true', MCP_SERVER_TOKEN: token });
	});

	test('malformed JSON is 400 before the MCP transport sees it', async () => {
		const result = await failure(event({ body: '{"jsonrpc":', authorization }));
		expect(result.status).toBe(400);
		expect(JSON.parse(result.body)).toEqual({ message: 'The request contains invalid JSON.' });
	});

	test('a non-JSON media type is 415 and a non-JSON Accept is 406', async () => {
		expect(
			(await failure(event({ body: '{}', authorization, contentType: 'text/plain' }))).status
		).toBe(415);
		const notAcceptable = await failure(
			event({ body: JSON.stringify(toolsList), authorization, accept: 'text/event-stream' })
		);
		expect(notAcceptable.status).toBe(406);
	});

	test('a body that is JSON but not JSON-RPC is a 400 JSON-RPC parse error, not a 500', async () => {
		const result = await failure(event({ body: '{"jsonrpc":"1.0"}', authorization }));
		expect(result.status).toBe(400);
		const body = JSON.parse(result.body) as { jsonrpc: string; error: { code: number } };
		expect(body.jsonrpc).toBe('2.0');
		expect(body.error.code).toBe(-32700);
		expectNoInternals(result.body, [token]);
	});

	test('an unknown method is a -32601 error in a 200 envelope, which is the protocol contract', async () => {
		const response = await route.POST(
			event({
				body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'admin/shutdown', params: {} }),
				authorization
			})
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { error: { code: number } };
		expect(body.error.code).toBe(-32601);
	});

	test('a body with no method field cannot reach the transport as a valid call', async () => {
		const result = await failure(event({ body: '{"jsonrpc":"2.0","id":1}', authorization }));
		expect([200, 400]).toContain(result.status);
		expect(result.status).not.toBe(500);
	});

	test('an oversized body is 413', async () => {
		const result = await failure(
			event({
				body: JSON.stringify({ ...toolsList, params: { pad: 'x'.repeat(70_000) } }),
				authorization
			})
		);
		expect(result.status).toBe(413);
	});
});

describe('response shape', () => {
	let token: string;
	let authorization: string;
	beforeEach(() => {
		token = serverToken();
		authorization = `Bearer ${token}`;
		Object.assign(privateEnv, { MCP_SERVER_ENABLED: 'true', MCP_SERVER_TOKEN: token });
	});

	test('tools/list is JSON with no-store and advertises exactly the read-only status tool', async () => {
		const response = await route.POST(event({ body: JSON.stringify(toolsList), authorization }));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(response.headers.get('cache-control')).toBe('no-store');
		const body = (await response.json()) as {
			jsonrpc: string;
			result: { tools: { name: string; annotations: Record<string, boolean> }[] };
		};
		expect(body.jsonrpc).toBe('2.0');
		expect(body.result.tools.map(({ name }) => name)).toEqual(['starter_status']);
		expect(body.result.tools[0].annotations).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false
		});
	});

	test('a call to an unknown tool is an in-band tool error carrying no server detail', async () => {
		const response = await route.POST(
			event({
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: { name: 'exec_shell', arguments: { command: 'id' } }
				}),
				authorization
			})
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			result: { isError: boolean; content: { text: string }[] };
		};
		expect(body.result.isError).toBe(true);
		expect(body.result.content[0].text).toContain('not found');
		expectNoInternals(JSON.stringify(body), [token]);
	});

	test('the status tool returns identity and version only', async () => {
		const response = await route.POST(
			event({
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 4,
					method: 'tools/call',
					params: { name: 'starter_status', arguments: {} }
				}),
				authorization
			})
		);
		const body = (await response.json()) as {
			result: { content: { text: string }[] };
		};
		expect(Object.keys(JSON.parse(body.result.content[0].text)).sort()).toEqual([
			'backend',
			'name',
			'version'
		]);
	});

	test('logging carries the method name only, never arguments or the token', async () => {
		await route.POST(
			event({
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 5,
					method: 'tools/call',
					params: { name: 'starter_status', arguments: { secret: 'do-not-log' } }
				}),
				authorization
			})
		);
		const serialized = JSON.stringify(logMock.logEvent.mock.calls);
		expect(serialized).not.toContain('do-not-log');
		expect(serialized).not.toContain(token);
		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'mcp.server', {
			method: 'tools/call',
			status: 200,
			outcome: 'ok'
		});
	});

	test('a hostile method name is recorded as "unknown" rather than as a log line', async () => {
		await route.POST(
			event({
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 6,
					method: 'evil\n{"level":"error","event":"forged"}',
					params: {}
				}),
				authorization
			})
		);
		expect(logMock.logEvent).toHaveBeenCalledWith(
			'info',
			'mcp.server',
			expect.objectContaining({ method: 'unknown' })
		);
	});
});

describe('upstream failure', () => {
	let token: string;
	let authorization: string;
	beforeEach(() => {
		token = serverToken();
		authorization = `Bearer ${token}`;
		Object.assign(privateEnv, { MCP_SERVER_ENABLED: 'true', MCP_SERVER_TOKEN: token });
	});

	test('a transport that throws becomes a 500 with a fixed message, never a hang', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/mcp/server', () => ({
			statusMcpResponse: vi.fn().mockRejectedValue(new Error('boom at /home/app/secret.ts'))
		}));
		try {
			const isolated = (await import('./+server')) as typeof route;
			const created = event({ body: JSON.stringify(toolsList), authorization });
			const result = await Promise.resolve(isolated.POST(created)).then(
				async (response) => ({ status: response.status, body: await response.text() }),
				(thrown: { status?: number; body?: unknown }) => ({
					status: thrown.status,
					body: JSON.stringify(thrown.body)
				})
			);
			expect(result.status).toBe(500);
			expect(JSON.parse(result.body)).toEqual({
				message: 'MCP request could not be processed.'
			});
			expectNoInternals(result.body, [token]);
		} finally {
			vi.doUnmock('$lib/server/mcp/server');
			vi.resetModules();
		}
	});
});

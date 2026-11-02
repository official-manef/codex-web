import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import * as route from './+server';

const { privateEnv, publicEnv, logMock, clientMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' },
	logMock: { logEvent: vi.fn() },
	clientMock: { listRemoteTools: vi.fn(), executeRemoteTool: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/server/log', () => ({ logEvent: logMock.logEvent }));
// The SDK client is the only outbound call; mock it so no socket is ever opened.
vi.mock('$lib/server/mcp/client', () => ({
	listRemoteTools: clientMock.listRemoteTools,
	executeRemoteTool: clientMock.executeRemoteTool
}));

const ORIGIN = 'https://app.example.com';
const BYOK = 'fake-remote-token';
const SERVERS = [
	{ alias: 'alpha', url: 'https://mcp.alpha.example/mcp', auth: 'bearer', tools: ['echo', 'read'] }
];
let tokenSeq = 0;

function operatorToken() {
	tokenSeq++;
	return `tools-token-${tokenSeq}`.padEnd(40, '0');
}

function event(body: unknown, headers: Record<string, string> = {}) {
	const url = new URL('/api/mcp/tools', ORIGIN);
	return {
		url,
		request: new Request(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: ORIGIN,
				...(headers as Record<string, string>)
			},
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		cookies: { get: () => undefined, set: () => undefined, delete: () => undefined },
		setHeaders: vi.fn()
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

/**
 * Issue a real one-shot approval the way the browser does, so an execute test exercises the
 * stateful confirmation instead of asserting `confirmed: true`.
 */
async function prepare(
	headers: Record<string, string>,
	overrides: Record<string, unknown> = {}
): Promise<{ approval: string; arguments: Record<string, unknown> }> {
	const args = (overrides.arguments as Record<string, unknown> | undefined) ?? {};
	const response = await route.POST(
		event(
			{
				action: 'prepare',
				alias: 'alpha',
				token: BYOK,
				tool: 'echo',
				...overrides,
				arguments: args
			},
			headers
		)
	);
	if (response.status !== 200) throw new Error(`prepare failed with ${response.status}`);
	return (await response.json()) as { approval: string; arguments: Record<string, unknown> };
}

function expectNoInternals(text: string, secrets: string[] = []) {
	expect(text).not.toMatch(/\n\s+at .+:\d+:\d+/);
	expect(text).not.toContain('/home/');
	expect(text).not.toContain('mcp.alpha.example');
	for (const secret of secrets.filter(Boolean)) expect(text).not.toContain(secret);
}

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	publicEnv.PUBLIC_SITE_URL = ORIGIN;
	logMock.logEvent.mockReset().mockResolvedValue(undefined);
	clientMock.listRemoteTools
		.mockReset()
		.mockResolvedValue([
			{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object' } }
		]);
	clientMock.executeRemoteTool
		.mockReset()
		.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
});

describe('method discipline', () => {
	test('only POST is exported', () => {
		expect(Object.keys(route).sort()).toEqual(['POST']);
	});
});

describe('feature disabled', () => {
	test('any value other than the exact "true" is 404 and calls nothing', async () => {
		for (const value of [undefined, 'false', 'TRUE', '1']) {
			privateEnv.MCP_CLIENT_ENABLED = value as string;
			const result = await failure(event({ action: 'list', alias: 'alpha', token: BYOK }));
			expect(result.status, String(value)).toBe(404);
			expect(JSON.parse(result.body)).toEqual({ message: 'Remote tools are disabled.' });
		}
		expect(clientMock.listRemoteTools).not.toHaveBeenCalled();
	});
});

describe('auth boundary', () => {
	test('enabled with no credential is 401', async () => {
		const token = operatorToken();
		Object.assign(privateEnv, {
			MCP_CLIENT_ENABLED: 'true',
			MCP_SERVERS_JSON: JSON.stringify(SERVERS),
			CAPABILITY_ACCESS_TOKEN: token
		});
		const result = await failure(event({ action: 'list', alias: 'alpha', token: BYOK }));
		expect(result.status).toBe(401);
		expect(JSON.parse(result.body)).toEqual({
			message: 'Sign in or provide the application access token.'
		});
		expect(clientMock.listRemoteTools).not.toHaveBeenCalled();
	});

	test('enabled with a wrong credential is 401 and never reaches the remote server', async () => {
		const token = operatorToken();
		Object.assign(privateEnv, {
			MCP_CLIENT_ENABLED: 'true',
			MCP_SERVERS_JSON: JSON.stringify(SERVERS),
			CAPABILITY_ACCESS_TOKEN: token
		});
		const result = await failure(
			event(
				{ action: 'list', alias: 'alpha', token: BYOK },
				{ authorization: `Bearer ${'z'.repeat(40)}` }
			)
		);
		expect(result.status).toBe(401);
		expect(clientMock.listRemoteTools).not.toHaveBeenCalled();
	});

	test('a valid credential from a foreign origin is 403', async () => {
		const token = operatorToken();
		Object.assign(privateEnv, {
			MCP_CLIENT_ENABLED: 'true',
			MCP_SERVERS_JSON: JSON.stringify(SERVERS),
			CAPABILITY_ACCESS_TOKEN: token
		});
		const result = await failure(
			event(
				{ action: 'list', alias: 'alpha', token: BYOK },
				{ authorization: `Bearer ${token}`, origin: 'https://attacker.example' }
			)
		);
		expect(result.status).toBe(403);
		expect(clientMock.listRemoteTools).not.toHaveBeenCalled();
	});
});

describe('input validation', () => {
	let headers: Record<string, string>;

	beforeEach(() => {
		const token = operatorToken();
		headers = { authorization: `Bearer ${token}` };
		Object.assign(privateEnv, {
			MCP_CLIENT_ENABLED: 'true',
			MCP_SERVERS_JSON: JSON.stringify(SERVERS),
			CAPABILITY_ACCESS_TOKEN: token
		});
	});

	const reject = async (body: unknown, extraHeaders: Record<string, string> = {}) => {
		const result = await failure(event(body, { ...headers, ...extraHeaders }));
		expect(result.status).toBe(400);
		expect(JSON.parse(result.body)).toEqual({
			message: 'Check the configured server, token, tool and explicit confirmation.'
		});
		expectNoInternals(result.body, [BYOK]);
		return result;
	};

	test('malformed JSON is 400 before validation', async () => {
		const result = await failure(event('{"action":', headers));
		expect(result.status).toBe(400);
		expect(JSON.parse(result.body)).toEqual({ message: 'The request contains invalid JSON.' });
	});

	test('a non-JSON media type is 415', async () => {
		const result = await failure(
			event(
				{ action: 'list', alias: 'alpha', token: BYOK },
				{ ...headers, 'content-type': 'text/plain' }
			)
		);
		expect(result.status).toBe(415);
	});

	test('an oversized body is 413', async () => {
		const result = await failure(
			event({ action: 'list', alias: 'alpha', token: BYOK, pad: 'x'.repeat(70_000) }, headers)
		);
		expect(result.status).toBe(413);
	});

	test('an unknown action is 400 and starts no client', async () => {
		await reject({ action: 'delete', alias: 'alpha', token: BYOK });
		expect(clientMock.listRemoteTools).not.toHaveBeenCalled();
		expect(clientMock.executeRemoteTool).not.toHaveBeenCalled();
	});

	test('missing and wrongly typed fields are 400', async () => {
		const { approval } = await prepare(headers);
		for (const body of [
			{},
			{ action: 'list', alias: 'alpha' },
			{ action: 'list', alias: 'alpha', token: BYOK, extra: true },
			{ action: 'list', alias: 42, token: BYOK },
			{ action: 'list', alias: 'x'.repeat(41), token: BYOK },
			// An execute with no approval field at all is a 400, not an unconfirmed execution.
			{ action: 'execute', alias: 'alpha', token: BYOK, tool: 'echo', arguments: {} },
			{
				action: 'prepare',
				alias: 'alpha',
				token: BYOK,
				tool: 'echo',
				arguments: {},
				confirmed: true
			},
			{
				action: 'execute',
				alias: 'alpha',
				token: BYOK,
				tool: 'echo',
				arguments: {},
				approval: 42
			},
			{
				action: 'execute',
				alias: 'alpha',
				token: BYOK,
				tool: 'echo',
				arguments: 'not-an-object',
				approval
			}
		])
			await reject(body);
	});

	test('a short or non-printable BYOK token is 400 rather than sent upstream', async () => {
		await reject({ action: 'list', alias: 'alpha', token: 'short' });
		await reject({ action: 'list', alias: 'alpha', token: 'has a space here' });
		expect(clientMock.listRemoteTools).not.toHaveBeenCalled();
	});

	test('an unknown or disabled alias is 400 and names neither the alias list nor a URL', async () => {
		await reject({ action: 'list', alias: 'ghost', token: BYOK });
		const result = await reject({ action: 'list', alias: 'ghost', token: BYOK });
		expect(result.body).not.toContain('alpha');
		expect(clientMock.listRemoteTools).not.toHaveBeenCalled();
	});

	test('a tool outside the allowlist is 400 before any network call', async () => {
		await reject({
			action: 'execute',
			alias: 'alpha',
			token: BYOK,
			tool: 'shell',
			arguments: {},
			approval: 'a'.repeat(64)
		});
		expect(clientMock.executeRemoteTool).not.toHaveBeenCalled();
	});

	test('an invalid MCP_SERVERS_JSON is a 503 for the operator, not a 400 blaming the caller', async () => {
		privateEnv.MCP_SERVERS_JSON = JSON.stringify([
			{ alias: 'alpha', url: 'http://mcp.alpha.example/mcp', auth: 'bearer', tools: ['echo'] }
		]);
		const result = await failure(event({ action: 'list', alias: 'alpha', token: BYOK }, headers));
		expect(result.status).toBe(503);
		expect(JSON.parse(result.body)).toEqual({
			message: 'Remote tool setup is incomplete. Check the private server configuration.'
		});
		expectNoInternals(result.body);
		expect(clientMock.listRemoteTools).not.toHaveBeenCalled();
	});

	test('a missing MCP_SERVERS_JSON is also 503 and never forwarded', async () => {
		delete privateEnv.MCP_SERVERS_JSON;
		const result = await failure(event({ action: 'list', alias: 'alpha', token: BYOK }, headers));
		expect(result.status).toBe(503);
		expect(clientMock.listRemoteTools).not.toHaveBeenCalled();
	});
});

describe('upstream failure', () => {
	let headers: Record<string, string>;

	beforeEach(() => {
		const token = operatorToken();
		headers = { authorization: `Bearer ${token}` };
		Object.assign(privateEnv, {
			MCP_CLIENT_ENABLED: 'true',
			MCP_SERVERS_JSON: JSON.stringify(SERVERS),
			CAPABILITY_ACCESS_TOKEN: token
		});
	});

	test('a rejected client becomes 502 with a fixed message that names no host or token', async () => {
		clientMock.listRemoteTools.mockRejectedValue(
			new Error(`ECONNRESET https://mcp.alpha.example/mcp?token=${BYOK}`)
		);
		const result = await failure(event({ action: 'list', alias: 'alpha', token: BYOK }, headers));
		expect(result.status).toBe(502);
		expect(JSON.parse(result.body)).toEqual({
			message:
				'The remote tool request failed or exceeded its limits. A submitted action may have completed; inspect its state before retrying.'
		});
		expectNoInternals(result.body, [BYOK]);
	});

	test('an aborted request is turned into a clean 502 rather than a hang', async () => {
		// The route must hand the request signal to the client; a client that only settles on
		// abort is exactly the "slow upstream" case that used to hang the handler.
		clientMock.listRemoteTools.mockImplementation(
			(_connection: unknown, _token: string, signal: AbortSignal) =>
				new Promise((_resolve, rejectSignal) => {
					const fail = () => rejectSignal(new Error('aborted'));
					if (signal.aborted) fail();
					else signal.addEventListener('abort', fail, { once: true });
				})
		);
		const controller = new AbortController();
		const created = event({ action: 'list', alias: 'alpha', token: BYOK }, headers);
		const aborted = {
			...created,
			request: new Request(created.url, {
				method: 'POST',
				headers: created.request.headers,
				body: JSON.stringify({ action: 'list', alias: 'alpha', token: BYOK }),
				signal: controller.signal
			})
		} as unknown as RequestEvent<Record<string, never>, never>;
		controller.abort();
		const result = await failure(aborted);
		expect(result.status).toBe(502);
		expect(clientMock.listRemoteTools).toHaveBeenCalledWith(
			expect.objectContaining({ alias: 'alpha' }),
			BYOK,
			expect.any(AbortSignal)
		);
	});

	test('an execute failure never claims success', async () => {
		clientMock.executeRemoteTool.mockRejectedValue(new Error('Remote tool failed'));
		const { approval } = await prepare(headers, { arguments: { text: 'hi' } });
		const result = await failure(
			event(
				{
					action: 'execute',
					alias: 'alpha',
					token: BYOK,
					tool: 'echo',
					arguments: { text: 'hi' },
					approval
				},
				headers
			)
		);
		expect(result.status).toBe(502);
		expect(result.body).not.toContain('"ok"');
	});
});

describe('response shape', () => {
	let headers: Record<string, string>;

	beforeEach(() => {
		const token = operatorToken();
		headers = { authorization: `Bearer ${token}` };
		Object.assign(privateEnv, {
			MCP_CLIENT_ENABLED: 'true',
			MCP_SERVERS_JSON: JSON.stringify(SERVERS),
			CAPABILITY_ACCESS_TOKEN: token
		});
	});

	test('list returns the client payload as JSON with no-store', async () => {
		const response = await route.POST(
			event({ action: 'list', alias: 'alpha', token: BYOK }, headers)
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual([
			{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object' } }
		]);
		expect(clientMock.listRemoteTools).toHaveBeenCalledWith(
			expect.objectContaining({ alias: 'alpha' }),
			BYOK,
			expect.any(AbortSignal)
		);
	});

	test('prepare returns a one-shot approval and executes nothing', async () => {
		const response = await route.POST(
			event(
				{ action: 'prepare', alias: 'alpha', token: BYOK, tool: 'echo', arguments: { text: 'hi' } },
				headers
			)
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const preview = (await response.json()) as Record<string, unknown>;
		expect(preview.approval).toMatch(/^[0-9a-f]{64}$/);
		expect(preview).toMatchObject({
			alias: 'alpha',
			tool: 'echo',
			arguments: { text: 'hi' }
		});
		expect(clientMock.executeRemoteTool).not.toHaveBeenCalled();
		expect(clientMock.listRemoteTools).not.toHaveBeenCalled();
	});

	test('execute redeems the approval and forwards the parsed arguments', async () => {
		const { approval } = await prepare(headers, { arguments: { text: 'hi' } });
		const response = await route.POST(
			event(
				{
					action: 'execute',
					alias: 'alpha',
					token: BYOK,
					tool: 'echo',
					arguments: { text: 'hi' },
					approval
				},
				headers
			)
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ content: [{ type: 'text', text: 'ok' }] });
		expect(clientMock.executeRemoteTool).toHaveBeenCalledWith(
			expect.objectContaining({ alias: 'alpha' }),
			BYOK,
			'echo',
			{ text: 'hi' },
			expect.any(AbortSignal)
		);
	});

	test('logging names the action and alias only, never the token or arguments', async () => {
		const { approval } = await prepare(headers, { arguments: { secret: 'do-not-log' } });
		await route.POST(
			event(
				{
					action: 'execute',
					alias: 'alpha',
					token: BYOK,
					tool: 'echo',
					arguments: { secret: 'do-not-log' },
					approval
				},
				headers
			)
		);
		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'mcp.tools', {
			action: 'execute',
			alias: 'alpha',
			tool: 'echo',
			outcome: 'ok'
		});
		const serialized = JSON.stringify(logMock.logEvent.mock.calls);
		expect(serialized).not.toContain('do-not-log');
		expect(serialized).not.toContain(BYOK);
	});
});

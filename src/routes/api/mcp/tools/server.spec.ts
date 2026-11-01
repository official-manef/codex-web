import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { POST } from './+server';

const { privateEnv, publicEnv, logMock, clientMock, configMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' },
	logMock: { logEvent: vi.fn() },
	clientMock: { listRemoteTools: vi.fn(), executeRemoteTool: vi.fn() },
	configMock: { connectionFor: vi.fn(), mcpConnections: vi.fn() }
}));

type Ev = Parameters<typeof POST>[0];

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/server/log', () => ({ logEvent: logMock.logEvent }));
vi.mock('$lib/server/mcp/client', () => clientMock);
vi.mock('$lib/server/mcp/config', () => configMock);

const token = 'w'.repeat(32);

// POST returns `MaybePromise<Response>`; awaiting it keeps the rejection type visible here.
async function failureOf(result: ReturnType<typeof POST>) {
	return Promise.resolve(result).catch((error: unknown) => error);
}
const secret = 'remote-token-abcdef123456';

function makeEvent(body: unknown, authorization = token): Ev {
	const url = new URL('https://app.example.com/api/mcp/tools');
	const headers = new Headers({
		'content-type': 'application/json',
		origin: 'https://app.example.com'
	});
	if (authorization) headers.set('authorization', `Bearer ${authorization}`);
	return {
		url,
		request: new Request(url, {
			method: 'POST',
			headers,
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		cookies: { get: () => undefined }
	} as unknown as Ev;
}

const connection = {
	alias: 'hub',
	url: 'https://mcp.example.com/mcp',
	auth: 'bearer' as const,
	tools: ['echo', 'status']
};

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	Object.assign(privateEnv, {
		MCP_CLIENT_ENABLED: 'true',
		CAPABILITY_ACCESS_TOKEN: token
	});
	logMock.logEvent.mockReset().mockResolvedValue(undefined);
	configMock.connectionFor.mockReset().mockReturnValue(connection);
	// The route validates the operator's catalog before the caller's body: an unparseable
	// MCP_SERVERS_JSON is a 503, by design (test/api). Stub the parse so these gating cases
	// still exercise their own 400 path.
	configMock.mcpConnections.mockReset().mockReturnValue([connection]);
	clientMock.listRemoteTools.mockReset().mockResolvedValue([{ name: 'echo' }]);
	clientMock.executeRemoteTool.mockReset().mockResolvedValue({ content: [] });
});

afterEach(() => vi.clearAllMocks());

describe('/api/mcp/tools POST gating', () => {
	test('404 when the MCP client is disabled, before auth or body parsing', async () => {
		privateEnv.MCP_CLIENT_ENABLED = 'false';
		await expect(
			POST(makeEvent({ action: 'list', alias: 'hub', token: secret }))
		).rejects.toMatchObject({ status: 404 });
		expect(clientMock.listRemoteTools).not.toHaveBeenCalled();
	});

	test('401 without the operator/session credential', async () => {
		await expect(
			POST(makeEvent({ action: 'list', alias: 'hub', token: secret }, ''))
		).rejects.toMatchObject({ status: 401 });
	});

	test('400 for an unapproved tool name, and the remote call never happens', async () => {
		await expect(
			POST(
				makeEvent({
					action: 'execute',
					alias: 'hub',
					token: secret,
					tool: 'rm_rf',
					arguments: {},
					confirmed: true
				})
			)
		).rejects.toMatchObject({ status: 400 });
		expect(clientMock.executeRemoteTool).not.toHaveBeenCalled();
	});

	test('400 when confirmed is not literally true — the allowlist cannot be bypassed by omission', async () => {
		for (const confirmed of [undefined, false, 'true', 1]) {
			const body: Record<string, unknown> = {
				action: 'execute',
				alias: 'hub',
				token: secret,
				tool: 'echo',
				arguments: {}
			};
			if (confirmed !== undefined) body.confirmed = confirmed;
			await expect(POST(makeEvent(body))).rejects.toMatchObject({ status: 400 });
		}
		expect(clientMock.executeRemoteTool).not.toHaveBeenCalled();
	});

	test('400 for unknown actions, extra fields and a short bearer token', async () => {
		await expect(
			POST(makeEvent({ action: 'delete', alias: 'hub', token: secret }))
		).rejects.toMatchObject({ status: 400 });
		await expect(
			POST(makeEvent({ action: 'list', alias: 'hub', token: secret, confirmed: true }))
		).rejects.toMatchObject({ status: 400 });
		await expect(
			POST(makeEvent({ action: 'list', alias: 'hub', token: 'short' }))
		).rejects.toMatchObject({ status: 400 });
	});

	test('400 when the alias is not a configured connection', async () => {
		configMock.connectionFor.mockImplementation(() => {
			throw new Error('MCP connection is disabled or unknown');
		});
		await expect(
			POST(makeEvent({ action: 'list', alias: 'ghost', token: secret }))
		).rejects.toMatchObject({ status: 400 });
	});

	test('list returns the discovered tools with no-store and logs the action but not the token', async () => {
		const res = await POST(makeEvent({ action: 'list', alias: 'hub', token: secret }));
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(await res.json()).toEqual([{ name: 'echo' }]);
		expect(clientMock.listRemoteTools).toHaveBeenCalledWith(
			connection,
			secret,
			expect.any(AbortSignal)
		);
		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'mcp.tools', {
			action: 'list',
			alias: 'hub',
			outcome: 'ok'
		});
		expect(JSON.stringify(logMock.logEvent.mock.calls)).not.toContain(secret);
	});

	test('execute forwards the allowlisted tool, arguments and confirmation', async () => {
		const res = await POST(
			makeEvent({
				action: 'execute',
				alias: 'hub',
				token: secret,
				tool: 'echo',
				arguments: { text: 'hi' },
				confirmed: true
			})
		);
		expect(res.status).toBe(200);
		expect(clientMock.executeRemoteTool).toHaveBeenCalledWith(
			connection,
			secret,
			'echo',
			{ text: 'hi' },
			true,
			expect.any(AbortSignal)
		);
		const fields = logMock.logEvent.mock.calls[0][2];
		expect(fields).toEqual({ action: 'execute', alias: 'hub', tool: 'echo', outcome: 'ok' });
	});

	test('a remote failure becomes 502 with an explicit warning that the action may have run', async () => {
		clientMock.executeRemoteTool.mockRejectedValue(new Error(`upstream 500 ${secret}`));
		const failure = await failureOf(
			POST(
				makeEvent({
					action: 'execute',
					alias: 'hub',
					token: secret,
					tool: 'echo',
					arguments: {},
					confirmed: true
				})
			)
		);
		expect(failure).toMatchObject({ status: 502 });
		const message = String((failure as { body?: { message?: string } }).body?.message);
		expect(message).toContain('may have completed');
		expect(message).not.toContain(secret);
		expect(JSON.stringify(failure)).not.toContain('mcp.example.com');
		expect(logMock.logEvent).toHaveBeenCalledWith('warn', 'mcp.tools', {
			action: 'execute',
			alias: 'hub',
			tool: 'echo',
			outcome: 'error'
		});
	});
});

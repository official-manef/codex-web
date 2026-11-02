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

function makeEvent(body: unknown, authorization = operatorToken): Ev {
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

/** Ask the route for a real approval, exactly like the browser's Review step. */
async function prepare(args: Record<string, unknown> = {}) {
	const res = await POST(
		makeEvent({
			action: 'prepare',
			alias: 'hub',
			token: secret,
			tool: 'echo',
			arguments: args
		})
	);
	if (res.status !== 200) throw new Error(`prepare failed with ${res.status}`);
	return (await res.json()) as { approval: string };
}

// `consumeBurst` is keyed by the operator token and lives for a minute, and this file now makes
// more requests per test (prepare + execute), so each test gets its own bucket.
let operatorToken = token;

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	operatorToken = `op-${Math.random().toString(36).slice(2)}`.padEnd(40, '0').slice(0, 40);
	Object.assign(privateEnv, {
		MCP_CLIENT_ENABLED: 'true',
		CAPABILITY_ACCESS_TOKEN: operatorToken
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
		// `prepare` is the step that would mint a token, so it must refuse first: an unapproved
		// tool never gets an approval at all.
		await expect(
			POST(
				makeEvent({
					action: 'prepare',
					alias: 'hub',
					token: secret,
					tool: 'rm_rf',
					arguments: {}
				})
			)
		).rejects.toMatchObject({ status: 400 });
		await expect(
			POST(
				makeEvent({
					action: 'execute',
					alias: 'hub',
					token: secret,
					tool: 'rm_rf',
					arguments: {},
					approval: 'a'.repeat(64)
				})
			)
		).rejects.toMatchObject({ status: 400 });
		expect(clientMock.executeRemoteTool).not.toHaveBeenCalled();
	});

	test('400 when the caller asserts confirmation instead of holding a token', async () => {
		// The old shape: `confirmed: true` is an assertion by the caller, not proof of a review.
		for (const confirmed of [undefined, false, 'true', 1, true]) {
			const body: Record<string, unknown> = {
				action: 'execute',
				alias: 'hub',
				token: secret,
				tool: 'echo',
				arguments: {}
			};
			if (confirmed !== undefined) body.confirmed = confirmed;
			await expect(POST(makeEvent(body)), String(confirmed)).rejects.toMatchObject({
				status: 400
			});
		}
		expect(clientMock.executeRemoteTool).not.toHaveBeenCalled();
	});

	test('409 for a token that was never issued, or was spent on other arguments', async () => {
		const body = (approval: string, overrides: Record<string, unknown> = {}) => ({
			action: 'execute',
			alias: 'hub',
			token: secret,
			tool: 'echo',
			arguments: {},
			approval,
			...overrides
		});
		// Never issued by this process.
		await expect(POST(makeEvent(body('f'.repeat(64))))).rejects.toMatchObject({ status: 409 });
		// A real token bound to different arguments is refused, and spending it burns it.
		const first = await prepare({ text: 'one' });
		await expect(
			POST(makeEvent(body(first.approval, { arguments: { text: 'other' } })))
		).rejects.toMatchObject({ status: 409 });
		await expect(
			POST(makeEvent(body(first.approval, { arguments: { text: 'one' } })))
		).rejects.toMatchObject({ status: 409 });
		expect(clientMock.executeRemoteTool).not.toHaveBeenCalled();
	});

	test('one approval runs exactly one call, and the replay is refused', async () => {
		const { approval } = await prepare();
		const body = {
			action: 'execute',
			alias: 'hub',
			token: secret,
			tool: 'echo',
			arguments: {},
			approval
		};
		expect((await POST(makeEvent(body))).status).toBe(200);
		await expect(POST(makeEvent(body))).rejects.toMatchObject({ status: 409 });
		// A token issued for one tool cannot be redeemed against another.
		const other = await prepare();
		await expect(
			POST(makeEvent({ ...body, tool: 'status', approval: other.approval }))
		).rejects.toMatchObject({ status: 409 });
		expect(clientMock.executeRemoteTool).toHaveBeenCalledTimes(1);
	});

	test('a spent approval cannot be extended by retrying', async () => {
		const { approval } = await prepare();
		// A token from a previous process, or one whose ticket was evicted, is simply unknown.
		await expect(
			POST(
				makeEvent({
					action: 'execute',
					alias: 'hub',
					token: secret,
					tool: 'echo',
					arguments: {},
					approval
				})
			)
		).resolves.toMatchObject({ status: 200 });
		await expect(
			POST(
				makeEvent({
					action: 'execute',
					alias: 'hub',
					token: secret,
					tool: 'echo',
					arguments: {},
					approval
				})
			)
		).rejects.toMatchObject({ status: 409 });
	});

	test('preparing many tickets never fails the request outright', async () => {
		// The store evicts its oldest ticket past the cap instead of throwing, so a prepare burst
		// cannot surface as the generic "the remote call may have completed" 502.
		for (let i = 0; i < 5; i++) expect((await prepare()).approval).toMatch(/^[0-9a-f]{64}$/);
	});

	test('list needs no approval, so a read-only call cannot be blocked by the token store', async () => {
		const res = await POST(makeEvent({ action: 'list', alias: 'hub', token: secret }));
		expect(res.status).toBe(200);
		expect(clientMock.listRemoteTools).toHaveBeenCalledTimes(1);
	});

	test('400 for unknown actions, extra fields and a short bearer token', async () => {
		await expect(
			POST(makeEvent({ action: 'delete', alias: 'hub', token: secret }))
		).rejects.toMatchObject({ status: 400 });
		await expect(
			POST(makeEvent({ action: 'list', alias: 'hub', token: secret, approval: 'a'.repeat(64) }))
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

	test('execute forwards the allowlisted tool and arguments once the approval is redeemed', async () => {
		const { approval } = await prepare({ text: 'hi' });
		clientMock.executeRemoteTool.mockClear();
		const res = await POST(
			makeEvent({
				action: 'execute',
				alias: 'hub',
				token: secret,
				tool: 'echo',
				arguments: { text: 'hi' },
				approval
			})
		);
		expect(res.status).toBe(200);
		expect(clientMock.executeRemoteTool).toHaveBeenCalledWith(
			connection,
			secret,
			'echo',
			{ text: 'hi' },
			expect.any(AbortSignal)
		);
		const fields = logMock.logEvent.mock.calls.at(-1)?.[2];
		expect(fields).toEqual({ action: 'execute', alias: 'hub', tool: 'echo', outcome: 'ok' });
	});

	test('a remote failure becomes 502 with an explicit warning that the action may have run', async () => {
		clientMock.executeRemoteTool.mockRejectedValue(new Error(`upstream 500 ${secret}`));
		const { approval } = await prepare();
		const failure = await failureOf(
			POST(
				makeEvent({
					action: 'execute',
					alias: 'hub',
					token: secret,
					tool: 'echo',
					arguments: {},
					approval
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

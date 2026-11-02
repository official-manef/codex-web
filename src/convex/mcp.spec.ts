/**
 * BYOK MCP connections: owner scoping, the at-rest secret and the single-use approval.
 *
 * `convex-test` runs the real functions against an in-memory deployment and can present a
 * signed-in user, which is the only way to prove owner scoping without a live Google session.
 * Nothing here reaches the network: discovery and execution are stubbed on `fetch`.
 */
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');

const ALICE = { subject: 'alice', tokenIdentifier: 'https://issuer|alice' };
const BOB = { subject: 'bob', tokenIdentifier: 'https://issuer|bob' };

// 32 base64 bytes: the only shape `masterKey` accepts.
const MASTER = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));

beforeEach(() => {
	process.env.MODELS_ENC_KEY = MASTER;
});
afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.MODELS_ENC_KEY;
});

const connection = {
	alias: 'hub',
	url: 'https://mcp.example.com/mcp',
	auth: 'bearer' as const,
	secret: 'secret-token-value',
	tools: ['echo']
};

function stubToolServer(options: { advertised?: string[]; callText?: string } = {}) {
	const advertised = options.advertised ?? connection.tools;
	const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
		const rpc = init.body ? JSON.parse(String(init.body)) : undefined;
		const method = init.method ?? 'GET';
		if (method === 'DELETE') return new Response(null, { status: 200 });
		if (method === 'GET') return new Response(null, { status: 405 });
		if (rpc?.method === 'notifications/initialized') return new Response(null, { status: 202 });
		let result: unknown;
		if (rpc?.method === 'initialize')
			result = {
				protocolVersion: '2025-06-18',
				capabilities: { tools: {} },
				serverInfo: { name: 'fixture', version: '1.0.0' }
			};
		else if (rpc?.method === 'tools/list')
			result = { tools: advertised.map((name) => ({ name, inputSchema: { type: 'object' } })) };
		else
			result = {
				content: [{ type: 'text', text: options.callText ?? 'tool output' }]
			};
		return Response.json(
			{ jsonrpc: '2.0', id: rpc.id, result },
			{ headers: { 'mcp-session-id': 'fixture-session' } }
		);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('connect', () => {
	test('stores the credential encrypted and never returns it', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const row = await asAlice.action(api.mcp.connect, connection);

		expect(row).toMatchObject({ alias: 'hub', url: connection.url, auth: 'bearer', enabled: true });
		expect(JSON.stringify(row)).not.toContain(connection.secret);

		// The stored ciphertext is opaque: the plaintext must not appear anywhere in the row.
		const stored = await t.run(async (ctx) => await ctx.db.query('mcpConnections').collect());
		expect(stored).toHaveLength(1);
		expect(stored[0].ciphertext).not.toContain(connection.secret);
		expect(stored[0].owner).toBe(ALICE.tokenIdentifier);
	});

	test('refuses a duplicate alias, so a second connect cannot silently replace a secret', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.mcp.connect, connection);
		await expect(
			asAlice.action(api.mcp.connect, { ...connection, secret: 'a-different-secret' })
		).rejects.toThrow('already connected');
		const stored = await t.run(async (ctx) => await ctx.db.query('mcpConnections').collect());
		expect(stored).toHaveLength(1);
	});

	test('rejects an invalid alias, url, tool list or secret before writing anything', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const cases: Array<[Partial<typeof connection>, string]> = [
			[{ alias: 'Has Space' }, 'alias'],
			[{ alias: '' }, 'alias'],
			[{ url: 'http://mcp.example.com/mcp' }, 'HTTPS'],
			[{ url: 'https://127.0.0.1/mcp' }, 'HTTPS'],
			// A wildcard resolver returns the address encoded in the name, so the shape check can
			// refuse it without a DNS lookup. This is the whole `nip.io` class.
			[{ url: 'https://127.0.0.1.nip.io/mcp' }, 'HTTPS'],
			[{ url: 'https://169.254.169.254.nip.io/mcp' }, 'HTTPS'],
			[{ url: 'https://10.0.0.1.sslip.io/mcp' }, 'HTTPS'],
			[{ url: 'https://user:pass@mcp.example.com/mcp' }, 'HTTPS'],
			[{ tools: [] }, 'tool names'],
			[{ tools: ['COMPOSIO_MULTI_EXECUTE_TOOL'] }, 'tool names'],
			[{ secret: '' }, 'credential'],
			// A leading/trailing space is refused so a paste cannot smuggle one in; an interior
			// space is printable ASCII and therefore legitimate.
			[{ secret: ' padded' }, 'credential'],
			[{ secret: 'has\ttab' }, 'credential']
		];
		for (const [patch, message] of cases) {
			await expect(asAlice.action(api.mcp.connect, { ...connection, ...patch })).rejects.toThrow(
				message
			);
		}
		expect(await t.run(async (ctx) => await ctx.db.query('mcpConnections').collect())).toEqual([]);
	});

	test('caps tool names at the shared maximum and trims the label', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const row = await asAlice.action(api.mcp.connect, {
			...connection,
			tools: ['echo', 'other'],
			label: `  ${'x'.repeat(120)}  `
		});
		expect(row.label).toHaveLength(80);
		expect(row.tools).toEqual(['echo', 'other']);
	});
});

describe('list', () => {
	test('shows only the signed-in owner rows and no ciphertext', async () => {
		const t = convexTest(schema, modules);
		await t.withIdentity(ALICE).action(api.mcp.connect, connection);
		await t
			.withIdentity(BOB)
			.action(api.mcp.connect, { ...connection, alias: 'bobs', url: 'https://bob.example/mcp' });

		const aliceRows = await t.withIdentity(ALICE).query(api.mcp.list, {});
		expect(aliceRows.connections.map((row) => row.alias)).toEqual(['hub']);

		const bobRows = await t.withIdentity(BOB).query(api.mcp.list, {});
		expect(bobRows.connections.map((row) => row.alias)).toEqual(['bobs']);

		// The public shape has no credential field at all, encrypted or otherwise.
		expect(JSON.stringify(aliceRows)).not.toContain('ciphertext');
	});

	test('an anonymous caller is refused', async () => {
		const t = convexTest(schema, modules);
		await expect(t.query(api.mcp.list, {})).rejects.toThrow();
	});
});

describe('disconnect and setEnabled', () => {
	test('both are owner-scoped: Bob cannot touch Alice rows', async () => {
		const t = convexTest(schema, modules);
		await t.withIdentity(ALICE).action(api.mcp.connect, connection);

		expect(await t.withIdentity(BOB).mutation(api.mcp.disconnect, { alias: 'hub' })).toEqual({
			removed: false
		});
		expect(
			await t.withIdentity(BOB).mutation(api.mcp.setEnabled, { alias: 'hub', enabled: false })
		).toEqual({ updated: false });
		const rows = await t.withIdentity(ALICE).query(api.mcp.list, {});
		expect(rows.connections[0].enabled).toBe(true);

		expect(await t.withIdentity(ALICE).mutation(api.mcp.disconnect, { alias: 'hub' })).toEqual({
			removed: true
		});
		expect((await t.withIdentity(ALICE).query(api.mcp.list, {})).connections).toEqual([]);
	});

	test('an invalid alias is a no-op rather than an error', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		expect(await asAlice.mutation(api.mcp.disconnect, { alias: 'NOT VALID' })).toEqual({
			removed: false
		});
		expect(await asAlice.mutation(api.mcp.setEnabled, { alias: '', enabled: true })).toEqual({
			updated: false
		});
	});

	test('toggling off is visible to the next action and blocks the network', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.mcp.connect, connection);
		await asAlice.mutation(api.mcp.setEnabled, { alias: 'hub', enabled: false });
		const stub = stubToolServer();
		await expect(asAlice.action(api.mcp.discover, { alias: 'hub' })).rejects.toThrow('turned off');
		expect(stub).not.toHaveBeenCalled();
	});
});

describe('discover', () => {
	test('returns only advertised names that are also allowlisted', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.mcp.connect, connection);
		stubToolServer({ advertised: ['echo', 'not-allowed'] });
		expect(await asAlice.action(api.mcp.discover, { alias: 'hub' })).toEqual({
			reachable: true,
			error: null,
			tools: ['echo']
		});
	});

	test('an unknown alias or a bad alias shape fails before any request', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const stub = stubToolServer();
		await expect(asAlice.action(api.mcp.discover, { alias: 'ghost' })).rejects.toThrow(
			'No MCP server'
		);
		await expect(asAlice.action(api.mcp.discover, { alias: 'BAD ALIAS' })).rejects.toThrow(
			'not valid'
		);
		expect(stub).not.toHaveBeenCalled();
	});

	test('a rotated master key surfaces as reconnect, not as a decrypt crash', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.mcp.connect, connection);
		process.env.MODELS_ENC_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, () => 7)));
		await expect(asAlice.action(api.mcp.discover, { alias: 'hub' })).rejects.toThrow(
			'can no longer be decrypted'
		);
	});
});

describe('prepare and call', () => {
	async function connected() {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.mcp.connect, connection);
		stubToolServer();
		return { t, asAlice };
	}

	test('prepare refuses a tool outside the allowlist without touching the network', async () => {
		const { t, asAlice } = await connected();
		vi.unstubAllGlobals();
		const stub = stubToolServer();
		await expect(
			asAlice.action(api.mcp.prepare, { alias: 'hub', tool: 'rm_rf', arguments: {} })
		).rejects.toThrow('not in this server allowlist');
		expect(stub).not.toHaveBeenCalled();
		expect(await t.run(async (ctx) => await ctx.db.query('mcpApprovals').collect())).toEqual([]);
	});

	test('prepare refuses arguments that are not a bounded object snapshot', async () => {
		const { asAlice } = await connected();
		await expect(
			asAlice.action(api.mcp.prepare, {
				alias: 'hub',
				tool: 'echo',
				arguments: { big: 'x'.repeat(17_000) }
			})
		).rejects.toThrow('16 000');
	});

	test('prepare refuses a tool the server stopped advertising', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.mcp.connect, connection);
		stubToolServer({ advertised: [] });
		await expect(
			asAlice.action(api.mcp.prepare, { alias: 'hub', tool: 'echo', arguments: {} })
		).rejects.toThrow('does not advertise');
		expect(await t.run(async (ctx) => await ctx.db.query('mcpApprovals').collect())).toEqual([]);
	});

	test('prepare stores only the token hash and never the token or the secret', async () => {
		const { t, asAlice } = await connected();
		const approval = await asAlice.action(api.mcp.prepare, {
			alias: 'hub',
			tool: 'echo',
			arguments: { text: 'hi' }
		});
		expect(approval.token).toMatch(/^[0-9a-f]{64}$/);
		expect(approval).toMatchObject({ alias: 'hub', tool: 'echo' });
		const rows = await t.run(async (ctx) => await ctx.db.query('mcpApprovals').collect());
		expect(rows).toHaveLength(1);
		expect(rows[0].tokenHash).not.toBe(approval.token);
		expect(JSON.stringify(rows)).not.toContain(connection.secret);
		expect(JSON.stringify(rows)).not.toContain(approval.token);
	});

	test('the pending argument snapshot is stored encrypted, not as pasted cleartext', async () => {
		const { t, asAlice } = await connected();
		// A pasted secret in a tool argument must not sit in the database for two minutes.
		const approval = await asAlice.action(api.mcp.prepare, {
			alias: 'hub',
			tool: 'echo',
			arguments: { apiKey: 'sk-live-do-not-store-me' }
		});
		// The preview is plaintext on purpose: it is what the user reads and confirms.
		expect(approval.arguments).toContain('sk-live-do-not-store-me');
		const rows = await t.run(async (ctx) => await ctx.db.query('mcpApprovals').collect());
		expect(rows).toHaveLength(1);
		expect(rows[0].arguments).not.toContain('sk-live-do-not-store-me');
		expect(JSON.stringify(rows)).not.toContain('sk-live-do-not-store-me');
		// Still redeemable: the ciphertext decrypts back to the exact snapshot that was previewed.
		const result = await asAlice.action(api.mcp.call, { token: approval.token });
		expect(result.isError).toBe(false);
	});

	test('an unreadable pending snapshot is refused instead of crashing the call', async () => {
		const { t, asAlice } = await connected();
		const { token } = await asAlice.action(api.mcp.prepare, {
			alias: 'hub',
			tool: 'echo',
			arguments: {}
		});
		// Simulates a rotated MODELS_ENC_KEY or a tampered row: the blob no longer decrypts.
		await t.run(async (ctx) => {
			const rows = await ctx.db.query('mcpApprovals').collect();
			for (const row of rows)
				await ctx.db.patch('mcpApprovals', row._id, { arguments: btoa('not-a-real-blob') });
		});
		await expect(asAlice.action(api.mcp.call, { token })).rejects.toThrow('can no longer be read');
	});

	test('a token can be redeemed exactly once, and the row is gone before the call', async () => {
		const { t, asAlice } = await connected();
		const { token } = await asAlice.action(api.mcp.prepare, {
			alias: 'hub',
			tool: 'echo',
			arguments: { text: 'hi' }
		});
		const result = await asAlice.action(api.mcp.call, { token });
		expect(result).toEqual({ content: 'tool output', isError: false });
		expect(await t.run(async (ctx) => await ctx.db.query('mcpApprovals').collect())).toEqual([]);
		await expect(asAlice.action(api.mcp.call, { token })).rejects.toThrow('already used');
	});

	test('a malformed token is refused without a database read', async () => {
		const { t, asAlice } = await connected();
		for (const token of ['', 'short', 'Z'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)])
			await expect(asAlice.action(api.mcp.call, { token })).rejects.toThrow('not valid');
		expect(await t.run(async (ctx) => await ctx.db.query('mcpApprovals').collect())).toEqual([]);
	});

	test('another user cannot redeem a token issued to Alice', async () => {
		const { t, asAlice } = await connected();
		const { token } = await asAlice.action(api.mcp.prepare, {
			alias: 'hub',
			tool: 'echo',
			arguments: {}
		});
		await expect(t.withIdentity(BOB).action(api.mcp.call, { token })).rejects.toThrow(
			'already used'
		);
		// Alice's approval is still redeemable; Bob's attempt did not consume or leak it.
		expect(await asAlice.action(api.mcp.call, { token })).toMatchObject({ isError: false });
	});

	test('an expired approval is refused after being consumed', async () => {
		const { t, asAlice } = await connected();
		const { token } = await asAlice.action(api.mcp.prepare, {
			alias: 'hub',
			tool: 'echo',
			arguments: {}
		});
		// Rewrite the deadline instead of waiting two minutes.
		await t.run(async (ctx) => {
			const rows = await ctx.db.query('mcpApprovals').collect();
			for (const row of rows) await ctx.db.patch('mcpApprovals', row._id, { expiresAt: 1 });
		});
		await expect(asAlice.action(api.mcp.call, { token })).rejects.toThrow('expired');
		// Expired tokens are single-use too: a retry says "already used", not "expired".
		await expect(asAlice.action(api.mcp.call, { token })).rejects.toThrow('already used');
	});

	test('a tool removed from the allowlist after approval is never executed', async () => {
		const { t, asAlice } = await connected();
		const { token } = await asAlice.action(api.mcp.prepare, {
			alias: 'hub',
			tool: 'echo',
			arguments: {}
		});
		await t.run(async (ctx) => {
			const rows = await ctx.db.query('mcpConnections').collect();
			for (const row of rows) await ctx.db.patch('mcpConnections', row._id, { tools: ['other'] });
		});
		vi.unstubAllGlobals();
		const stub = stubToolServer();
		await expect(asAlice.action(api.mcp.call, { token })).rejects.toThrow(
			'no longer in this server allowlist'
		);
		expect(stub).not.toHaveBeenCalled();
	});

	test('a disconnected server leaves the approval unredeemable', async () => {
		const { asAlice } = await connected();
		const { token } = await asAlice.action(api.mcp.prepare, {
			alias: 'hub',
			tool: 'echo',
			arguments: {}
		});
		await asAlice.mutation(api.mcp.disconnect, { alias: 'hub' });
		await expect(asAlice.action(api.mcp.call, { token })).rejects.toThrow('No MCP server');
	});

	test('a remote failure is redacted and says the call may have completed remotely', async () => {
		const { asAlice } = await connected();
		const { token } = await asAlice.action(api.mcp.prepare, {
			alias: 'hub',
			tool: 'echo',
			arguments: {}
		});
		vi.unstubAllGlobals();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: unknown, init: RequestInit) => {
				const rpc = init.body ? JSON.parse(String(init.body)) : undefined;
				if ((init.method ?? 'GET') === 'GET') return new Response(null, { status: 405 });
				if (rpc?.method === 'notifications/initialized') return new Response(null, { status: 202 });
				if (rpc?.method === 'initialize')
					return Response.json(
						{
							jsonrpc: '2.0',
							id: rpc.id,
							result: {
								protocolVersion: '2025-06-18',
								capabilities: { tools: {} },
								serverInfo: { name: 'f', version: '1' }
							}
						},
						{ headers: { 'mcp-session-id': 's' } }
					);
				if (rpc?.method === 'tools/list')
					return Response.json(
						{
							jsonrpc: '2.0',
							id: rpc.id,
							result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
						},
						{ headers: { 'mcp-session-id': 's' } }
					);
				// The call itself fails with text containing the credential.
				return Response.json(
					{
						jsonrpc: '2.0',
						id: rpc.id,
						result: {
							content: [{ type: 'text', text: `boom ${connection.secret}` }],
							isError: true
						}
					},
					{ headers: { 'mcp-session-id': 's' } }
				);
			})
		);
		// A remote `isError` is a successful round trip, so it is returned as data rather than
		// thrown: the caller can show the redacted cause and still offer a retry.
		const result = await asAlice.action(api.mcp.call, { token });
		expect(result.isError).toBe(true);
		expect(result.content).toContain('boom');
		expect(result.content).not.toContain(connection.secret);
		expect(result.content).toContain('[redacted]');
	});
});

describe('insert and capacity', () => {
	test('the per-owner connection limit is enforced by insert itself', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		for (let i = 0; i < 16; i++)
			await asAlice.action(api.mcp.connect, {
				...connection,
				alias: `hub-${i}`,
				url: `https://mcp${i}.example.com/mcp`
			});
		await expect(
			asAlice.action(api.mcp.connect, {
				...connection,
				alias: 'overflow',
				url: 'https://overflow.example.com/mcp'
			})
		).rejects.toThrow('16 servers');
		const rows = await t.run(async (ctx) => await ctx.db.query('mcpConnections').collect());
		expect(rows).toHaveLength(16);
	});
});

describe('call network failure', () => {
	test('a transport error is redacted and warns that the call may have completed', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.mcp.connect, connection);
		stubToolServer();
		const { token } = await asAlice.action(api.mcp.prepare, {
			alias: 'hub',
			tool: 'echo',
			arguments: {}
		});
		// Discovery still answers, but `tools/call` throws with the credential in the message.
		vi.unstubAllGlobals();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: unknown, init: RequestInit) => {
				const rpc = init.body ? JSON.parse(String(init.body)) : undefined;
				const method = init.method ?? 'GET';
				if (method === 'GET') return new Response(null, { status: 405 });
				if (rpc?.method === 'notifications/initialized') return new Response(null, { status: 202 });
				if (rpc?.method === 'initialize')
					return Response.json(
						{
							jsonrpc: '2.0',
							id: rpc.id,
							result: {
								protocolVersion: '2025-06-18',
								capabilities: { tools: {} },
								serverInfo: { name: 'f', version: '1' }
							}
						},
						{ headers: { 'mcp-session-id': 's' } }
					);
				if (rpc?.method === 'tools/list')
					return Response.json(
						{
							jsonrpc: '2.0',
							id: rpc.id,
							result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
						},
						{ headers: { 'mcp-session-id': 's' } }
					);
				throw new Error(`socket closed with ${connection.secret}`);
			})
		);
		const failure = await asAlice.action(api.mcp.call, { token }).catch((error: unknown) => error);
		const text = JSON.stringify(failure);
		expect(text).not.toContain(connection.secret);
		expect(text).toContain('may have completed remotely');
	});
});

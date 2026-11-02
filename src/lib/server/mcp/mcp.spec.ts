import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { assertPublicHost, connectionFor, isPublicAddress, mcpConnections } from './config';
import { executeRemoteTool, listRemoteTools } from './client';
import { statusMcpResponse } from './server';

// No test may touch a real resolver: `assertPublicHost` runs before every connection.
const { lookupMock } = vi.hoisted(() => ({
	lookupMock: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
}));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

const connection = {
	alias: 'test',
	url: 'https://mcp.example.com/mcp',
	auth: 'x-api-key' as const,
	tools: ['echo']
};
const token = 'secret-test-token';
const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };
beforeEach(() =>
	lookupMock.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
);
afterEach(() => vi.unstubAllGlobals());

test('MCP config is off by default and permits only configured HTTPS aliases and direct tools', () => {
	expect(mcpConnections({})).toEqual([]);
	const config = (change = {}) => ({
		MCP_CLIENT_ENABLED: 'true',
		MCP_SERVERS_JSON: JSON.stringify([{ ...connection, ...change }])
	});
	expect(mcpConnections(config())).toEqual([connection]);
	for (const url of [
		'http://mcp.example.com',
		'https://127.0.0.1/mcp',
		'https://localhost/mcp',
		'https://a:b@mcp.example.com',
		'https://mcp.example.com?token=secret',
		// Same name to the resolver as the two above; the trailing dot must not be a bypass.
		'https://localhost./mcp',
		'https://box.local./mcp',
		'https://127.0.0.1./mcp'
	])
		expect(() => mcpConnections(config({ url }))).toThrow();
	expect(() => mcpConnections(config({ tools: ['COMPOSIO_MULTI_EXECUTE_TOOL'] }))).toThrow(
		'direct toolkit'
	);
});

function protocol(options: { repeatCursor?: boolean; failTool?: boolean } = {}) {
	const requests: { method: string; rpc?: Record<string, unknown>; headers: Headers }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: unknown, init: RequestInit) => {
			const method = init.method ?? 'GET';
			const rpc = init.body ? JSON.parse(String(init.body)) : undefined;
			requests.push({ method, rpc, headers: new Headers(init.headers) });
			if (method === 'GET') return new Response(null, { status: 405 });
			if (method === 'DELETE') return new Response(null, { status: 200 });
			if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
			let result: unknown;
			if (rpc.method === 'initialize')
				result = {
					protocolVersion: '2025-11-25',
					capabilities: { tools: {} },
					serverInfo: { name: 'fixture', version: '1.0.0' }
				};
			else if (rpc.method === 'tools/list')
				result = {
					tools: [
						{ name: 'echo', description: `Description ${token}`, inputSchema: schema },
						{ name: 'not-allowed', inputSchema: { type: 'object' } }
					],
					...(options.repeatCursor ? { nextCursor: 'same-cursor' } : {})
				};
			else
				result = {
					content: [{ type: 'text', text: `result ${token}` }],
					...(options.failTool ? { isError: true } : {})
				};
			return Response.json(
				{ jsonrpc: '2.0', id: rpc.id, result },
				{ headers: { 'mcp-session-id': 'fixture-session' } }
			);
		})
	);
	return requests;
}

test('official SDK discovers only allowed tools, redacts secrets and terminates its session', async () => {
	const requests = protocol();
	const tools = await listRemoteTools(connection, token, new AbortController().signal);
	expect(tools).toEqual([
		{ name: 'echo', description: 'Description [redacted]', inputSchema: schema }
	]);
	expect(requests.some(({ rpc }) => rpc?.method === 'initialize')).toBe(true);
	expect(requests.some(({ method }) => method === 'DELETE')).toBe(true);
	expect(requests.every(({ headers }) => headers.get('x-api-key') === token)).toBe(true);
});

test('each execution needs an allowlisted tool before network, then rechecks discovery', async () => {
	const requests = protocol();
	await expect(
		executeRemoteTool(connection, token, 'not-allowed', {}, new AbortController().signal)
	).rejects.toThrow('not approved');
	expect(requests).toHaveLength(0);
	const output = await executeRemoteTool(
		connection,
		token,
		'echo',
		{ text: 'Approved' },
		new AbortController().signal
	);
	expect(JSON.stringify(output)).toContain('[redacted]');
	expect(JSON.stringify(output)).not.toContain(token);
	expect(requests.filter(({ rpc }) => rpc?.method === 'tools/call')).toHaveLength(1);
	expect(requests.some(({ method }) => method === 'DELETE')).toBe(true);
});

test('incomplete discovery and remote tool errors fail without returning provider error contents', async () => {
	let requests = protocol({ repeatCursor: true });
	await expect(listRemoteTools(connection, token, new AbortController().signal)).rejects.toThrow(
		'cursor repeated'
	);
	expect(requests.some(({ method }) => method === 'DELETE')).toBe(true);
	requests = protocol({ failTool: true });
	await expect(
		executeRemoteTool(connection, token, 'echo', { text: 'Approved' }, new AbortController().signal)
	).rejects.toThrow('Remote tool failed');
	expect(requests.some(({ method }) => method === 'DELETE')).toBe(true);
});

test('official stateless MCP server advertises only read-only template status', async () => {
	const request = (body: unknown) =>
		new Request('https://app.example.com/api/mcp/server', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				'MCP-Protocol-Version': '2025-11-25'
			},
			body: JSON.stringify(body)
		});
	const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
	const response = await statusMcpResponse(request(list), list);
	const data = await response.json();
	expect(data.result.tools).toHaveLength(1);
	expect(data.result.tools[0]).toMatchObject({
		name: 'starter_status',
		annotations: { readOnlyHint: true, destructiveHint: false }
	});
	const call = {
		jsonrpc: '2.0',
		id: 2,
		method: 'tools/call',
		params: { name: 'starter_status', arguments: {} }
	};
	const output = await (await statusMcpResponse(request(call), call)).json();
	expect(JSON.parse(output.result.content[0].text)).toMatchObject({ backend: 'convex' });
});

const allowlistEnv = (servers: unknown) => ({
	MCP_CLIENT_ENABLED: 'true',
	MCP_SERVERS_JSON: typeof servers === 'string' ? servers : JSON.stringify(servers)
});

test('an unset, oversized or malformed server list refuses to enable the client at all', () => {
	expect(() => mcpConnections({ MCP_CLIENT_ENABLED: 'true' })).toThrow(
		'Configure MCP_SERVERS_JSON'
	);
	expect(() => mcpConnections(allowlistEnv('x'.repeat(32_001)))).toThrow(
		'Configure MCP_SERVERS_JSON'
	);
	expect(() => mcpConnections(allowlistEnv('{not json'))).toThrow();
	// An empty list is not "allow everything": it fails the min(1) bound.
	expect(() => mcpConnections(allowlistEnv([]))).toThrow();
	expect(() => mcpConnections(allowlistEnv(Array.from({ length: 9 }, () => connection)))).toThrow();
});

test('duplicate aliases are refused so an allowlist cannot shadow another entry', () => {
	expect(() =>
		mcpConnections(
			allowlistEnv([
				{ ...connection, tools: ['echo'] },
				{ ...connection, url: 'https://other.example.com/mcp', tools: ['other'] }
			])
		)
	).toThrow('Duplicate MCP alias');
});

test('every local and non-HTTPS URL shape stays out, including ports and trailing dots', () => {
	for (const url of [
		'https://mcp.example.com:8443/mcp',
		'https://[::1]/mcp',
		'https://10.0.0.1/mcp',
		'https://192.168.1.1/mcp',
		'https://box.local/mcp',
		'https://sub.localhost/mcp',
		'https://mcp.example.com/mcp#frag',
		'https://mcp.example.com/mcp?apiKey=1',
		'https://mcp.example.com/mcp?X-Api-Key=1',
		'https://mcp.example.com/mcp?password=x',
		'ftp://mcp.example.com/mcp',
		'not a url'
	])
		expect(() => mcpConnections(allowlistEnv([{ ...connection, url }])), url).toThrow();
});

test('an approved URL is normalised once, so the stored endpoint matches what is called', () => {
	const [parsed] = mcpConnections(
		allowlistEnv([{ ...connection, url: 'https://MCP.example.com:443/mcp' }])
	);
	expect(parsed.url).toBe('https://mcp.example.com/mcp');
});

test('wildcard-resolver names are refused by shape, before any DNS lookup happens', () => {
	// These resolve to the address encoded in the name, so no lookup can make them safe.
	for (const url of [
		'https://127.0.0.1.nip.io/mcp',
		'https://10.0.0.1.nip.io/mcp',
		'https://169.254.169.254.nip.io/mcp',
		'https://127-0-0-1.sslip.io/mcp',
		'https://10.0.0.1.sslip.io/mcp',
		'https://127.0.0.1.xip.io/mcp',
		'https://localtest.me/mcp'
	])
		expect(() => mcpConnections(allowlistEnv([{ ...connection, url }])), url).toThrow();
});

test('address classification covers loopback, RFC1918, link-local, CGNAT and IPv6', () => {
	for (const address of [
		'127.0.0.1',
		'10.1.2.3',
		'172.16.0.1',
		'192.168.0.1',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'255.255.255.255',
		'::1',
		'::',
		'fd00::1',
		'fe80::1',
		'::ffff:127.0.0.1',
		'::ffff:7f00:1'
	])
		expect(isPublicAddress(address), address).toBe(false);
	for (const address of ['93.184.216.34', '1.1.1.1', '2606:2800:220:1:248:1893:25c8:1946'])
		expect(isPublicAddress(address), address).toBe(true);
});

async function refusal(host = 'mcp.attacker.example'): Promise<string> {
	try {
		await assertPublicHost(host);
		return 'accepted';
	} catch (error) {
		return (error as Error).message;
	}
}

test('a name that resolves to a private address is refused, not just a private literal', async () => {
	lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
	expect(await refusal()).toContain('private address');
	lookupMock.mockResolvedValue([
		{ address: '93.184.216.34', family: 4 },
		{ address: '169.254.169.254', family: 4 }
	]);
	// One private answer is enough: a mixed reply must not hide behind the public record.
	expect(await refusal()).toContain('private address');
	lookupMock.mockResolvedValue([]);
	expect(await refusal()).toContain('private address');
	lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
	expect(await refusal()).toContain('does not resolve');
});

test('an IPv4 or IPv6 literal endpoint is classified without a lookup', async () => {
	lookupMock.mockClear();
	expect(await refusal('93.184.216.34')).toBe('accepted');
	expect(await refusal('127.0.0.1')).toContain('private address');
	expect(await refusal('169.254.169.254')).toContain('private address');
	expect(await refusal('2606:2800:220:1:248:1893:25c8:1946')).toBe('accepted');
	expect(await refusal('::1')).toContain('private address');
	expect(lookupMock).not.toHaveBeenCalled();
});

test('a resolved private host never reaches the network, even when the URL shape is fine', async () => {
	const requests = protocol();
	lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
	await expect(listRemoteTools(connection, token, new AbortController().signal)).rejects.toThrow(
		'private address'
	);
	expect(requests).toHaveLength(0);
});

test('connectionFor resolves only an exact alias and refuses a disabled client', () => {
	expect(connectionFor(allowlistEnv([connection]), 'test').url).toBe(connection.url);
	expect(() => connectionFor(allowlistEnv([connection]), 'other')).toThrow('disabled or unknown');
	expect(() => connectionFor({ MCP_CLIENT_ENABLED: 'false' }, 'test')).toThrow(
		'disabled or unknown'
	);
	// No case-folding or prefix matching: the alias is the allowlist key.
	expect(() => connectionFor(allowlistEnv([connection]), 'TEST')).toThrow('disabled or unknown');
	expect(() => connectionFor(allowlistEnv([connection]), 'tes')).toThrow('disabled or unknown');
});

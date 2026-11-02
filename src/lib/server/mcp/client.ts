/**
 * Outbound MCP client for the operator allowlist path.
 *
 * Bounds that actually exist here, verified against the code, so a refactor cannot quietly
 * drop one:
 * - One connection per request, closed in `finally`; the remote session is terminated with a
 *   separate 2-second cleanup deadline.
 * - A 15-second deadline per request, combined with the caller's abort signal.
 * - Redirects are refused (`redirect: 'error'`) and the SDK may not send a request to any URL
 *   other than the configured endpoint ("MCP request escaped its configured endpoint").
 * - Each response body is capped at 2 MiB while streaming.
 * - Discovery: at most 8 pages and 128 advertised tools; a repeated cursor or an incomplete
 *   page count fails rather than looping.
 * - Arguments are capped at 16 000 serialized characters, results at 64 000.
 * - The tool allowlist is re-checked and the tool is rediscovered before every execution, so a
 *   tool removed by the operator or by the server is not called.
 * - The credential and the endpoint are redacted from every description and result.
 *
 * The host is also resolved before the first byte is sent (`assertPublicHost`), because
 * `config.ts` only inspects the URL shape. See the `ponytail` note in `withClient` for the
 * remaining window.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import packageJson from '../../../../package.json';
import { assertPublicHost } from './config';
import type { McpConnection } from './config';

export function redact(value: unknown, secrets: string[]): unknown {
	if (typeof value === 'string')
		return secrets
			.filter(Boolean)
			.reduce((text, secret) => text.split(secret).join('[redacted]'), value);
	if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [redact(key, secrets), redact(item, secrets)])
		);
	return value;
}

async function withClient<T>(
	connection: McpConnection,
	token: string,
	signal: AbortSignal,
	run: (client: Client, signal: AbortSignal) => Promise<T>
): Promise<T> {
	// Resolve before the socket exists: the URL check is shape-only, so `127.0.0.1.nip.io` and
	// any public name that answers with loopback/link-local/metadata would otherwise connect.
	// ponytail: this verifies the answer, it does not pin it — a resolver that changes its reply
	// between this lookup and the connection still wins. Pin the address (custom dispatcher or
	// `lookup` hook) when the deployment cannot rely on outbound network policy.
	await assertPublicHost(new URL(connection.url).hostname);
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
	let cleanup = false;
	const client = new Client({ name: packageJson.name, version: packageJson.version });
	const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
		requestInit: {
			headers:
				connection.auth === 'bearer' ? { Authorization: `Bearer ${token}` } : { 'x-api-key': token }
		},
		fetch: async (url, init) => {
			if (String(url) !== connection.url)
				throw new Error('MCP request escaped its configured endpoint');
			const response = await fetch(url, {
				...init,
				redirect: 'error',
				signal: cleanup
					? AbortSignal.timeout(2000)
					: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])])
			});
			if (!response.body) return response;
			let bytes = 0;
			const limited = response.body.pipeThrough(
				new TransformStream<Uint8Array, Uint8Array>({
					transform(chunk, controller) {
						bytes += chunk.byteLength;
						if (bytes > 2_097_152) throw new Error('MCP response too large');
						controller.enqueue(chunk);
					}
				})
			);
			return new Response(limited, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers
			});
		}
	});
	// Transport errors reach the request handler; never log remote payloads or credentials.
	client.onerror = () => {};
	try {
		await client.connect(transport, { signal: deadline, timeout: 15_000 });
		return await run(client, deadline);
	} finally {
		cleanup = true;
		if (transport.sessionId) {
			try {
				await transport.terminateSession();
			} catch {
				/* Closing locally remains required if remote cleanup fails. */
			}
		}
		await client.close();
	}
}

async function discover(client: Client, connection: McpConnection, signal: AbortSignal) {
	const tools = [];
	const cursors = new Set<string>();
	let cursor: string | undefined;
	for (let page = 0; page < 8; page++) {
		const result = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 15_000 });
		tools.push(...result.tools);
		if (tools.length > 128) throw new Error('MCP discovery limit exceeded');
		if (!result.nextCursor)
			return tools
				.filter((tool) => connection.tools.includes(tool.name))
				.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
		if (cursors.has(result.nextCursor)) throw new Error('MCP discovery cursor repeated');
		cursors.add(result.nextCursor);
		cursor = result.nextCursor;
	}
	throw new Error('MCP discovery incomplete');
}

export async function listRemoteTools(
	connection: McpConnection,
	token: string,
	signal: AbortSignal
) {
	return withClient(connection, token, signal, async (client, deadline) =>
		redact(await discover(client, connection, deadline), [token, connection.url])
	);
}

export async function executeRemoteTool(
	connection: McpConnection,
	token: string,
	tool: string,
	args: Record<string, unknown>,
	signal: AbortSignal
) {
	// The one-shot approval is redeemed by the route before this runs; the allowlist is re-checked
	// here so no caller path can reach a tool the operator did not approve.
	if (!connection.tools.includes(tool)) throw new Error('Tool is not approved for this call');
	if (JSON.stringify(args).length > 16000) throw new Error('Tool arguments exceed the limit');
	return withClient(connection, token, signal, async (client, deadline) => {
		const tools = await discover(client, connection, deadline);
		if (!tools.some((item) => item.name === tool))
			throw new Error('Tool is not currently advertised');
		const result = await client.callTool({ name: tool, arguments: args }, CallToolResultSchema, {
			signal: deadline,
			timeout: 15_000
		});
		if (result.isError) throw new Error('Remote tool failed');
		const output = redact(
			{ content: result.content, structuredContent: result.structuredContent },
			[token, connection.url]
		);
		if (JSON.stringify(output).length > 64000)
			throw new Error('Tool result exceeds the display limit');
		return output;
	});
}

import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { error } from '@sveltejs/kit';
import { consumeBurst, matchesSecret, readJsonBody, requireAppOrigin } from '$lib/server/access';
import { statusMcpResponse } from '$lib/server/mcp/server';
import { logEvent } from '$lib/server/log';
import type { RequestHandler } from './$types';

// The JSON-RPC method name is the only field of the body this route ever records.
function methodOf(body: unknown): string {
	const method =
		typeof body === 'object' && body !== null ? (body as { method?: unknown }).method : null;
	return typeof method === 'string' && /^[a-z][a-z/._-]{0,63}$/i.test(method) ? method : 'unknown';
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (env.MCP_SERVER_ENABLED !== 'true') error(404, 'MCP server is disabled.');
	const token = env.MCP_SERVER_TOKEN;
	if (!token || token.length < 32 || token.length > 4096)
		error(503, 'MCP server setup is incomplete.');
	if (!matchesSecret(request.headers.get('authorization') ?? '', `Bearer ${token}`))
		error(401, 'MCP authorization required.');
	// Optional by design: this header is not an independent control. The bearer token above is
	// the authentication boundary, and a non-browser MCP client legitimately sends no `Origin`.
	// A present `Origin` is checked only so a browser page on another site cannot replay a leaked
	// token through a victim's browser; absence is not a bypass of anything.
	if (request.headers.has('origin')) requireAppOrigin(request, publicEnv.PUBLIC_SITE_URL);
	// Keyed by caller address, not by token: the token is shared by every client of this
	// deployment, so a token-keyed bucket let one noisy client lock out all the others.
	// ponytail: `getClientAddress` is the socket peer unless the adapter trusts a proxy header;
	// behind a trusted proxy a whole NAT shares one bucket. Set `ADDRESS_HEADER` on the adapter
	// when that matters. A runtime that cannot report an address falls back to one shared bucket
	// rather than failing the request.
	let address = 'unknown';
	try {
		address = getClientAddress?.() || 'unknown';
	} catch {
		/* The bucket is best-effort; the bearer token remains the authentication boundary. */
	}
	consumeBurst(`mcp-server:${address}`);
	const body = await readJsonBody(request);
	try {
		const response = await statusMcpResponse(request, body);
		await logEvent('info', 'mcp.server', {
			method: methodOf(body),
			status: response.status,
			outcome: 'ok'
		});
		return response;
	} catch {
		await logEvent('warn', 'mcp.server', { method: methodOf(body), outcome: 'error' });
		error(500, 'MCP request could not be processed.');
	}
};

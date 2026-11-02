import { lookup } from 'node:dns/promises';
import { z } from 'zod';
import type { IntegrationEnv } from '../integrations/config';
import { flag } from '../ai/config';

/**
 * Shape rules for the operator allowlist. The same rules live in
 * `src/convex/_shared/mcp_rules.ts` because Convex cannot import this module; keep them in step.
 *
 * Nothing here resolves DNS: `mcpConnections` is synchronous and runs inside request handlers.
 * `assertPublicHost` below is the resolving half and is called by `client.ts` before any socket
 * is opened, so a name that *looks* public but answers with a loopback address never connects.
 */
// A dotted quad anywhere in the name is a resolver wildcard, not a host: `127.0.0.1.nip.io`,
// `10-0-0-1.sslip.io` and friends all reduce to a private address at lookup time.
const EMBEDDED_IPV4 = /(?:^|\.)\d{1,3}(?:\.\d{1,3}){3}(?:\.|$)/;
// Hosting wildcards whose whole purpose is to resolve an arbitrary name to an address encoded
// in that name. Refused by suffix, because the address they return is the address asked for.
const WILDCARD_RESOLVER =
	/^(?:.*\.)?(?:nip\.io|sslip\.io|xip\.io|traefik\.me|lvh\.me|vcap\.me|localtest\.me|local\.gd)$/i;

/** True when an IPv4/IPv6 literal is routable on the public internet. */
export function isPublicAddress(input: string): boolean {
	const address = input
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, '');
	const quad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
	if (quad) {
		const bytes = quad.slice(1, 5).map(Number);
		if (bytes.some((byte) => byte > 255)) return false;
		const [a, b] = bytes;
		return !(
			a === 0 ||
			a === 10 ||
			a === 127 ||
			a >= 224 ||
			(a === 100 && b >= 64 && b <= 127) || // carrier NAT
			(a === 169 && b === 254) || // link-local, includes 169.254.169.254 metadata
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 192 && b === 0) || // 192.0.0.0/24 and the TEST-NET-1 block
			(a === 192 && b === 88) || // 6to4 relay anycast
			(a === 198 && (b === 18 || b === 19)) || // benchmarking
			(a === 198 && b === 51) || // TEST-NET-2
			(a === 203 && b === 0) // TEST-NET-3
		);
	}
	// IPv4 embedded in IPv6: mapped (::ffff:7f00:1, ::ffff:127.0.0.1) and NAT64 (64:ff9b::/96).
	const trailing = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
	if (trailing) return isPublicAddress(trailing[1]);
	const mapped = /^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
	if (mapped) {
		const high = parseInt(mapped[1], 16);
		const low = parseInt(mapped[2], 16);
		return isPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
	}
	if (address === '::' || address === '::1') return false;
	if (/^f[cd]/.test(address)) return false; // fc00::/7 unique local
	if (/^fe[89ab]/.test(address)) return false; // fe80::/10 link-local
	if (/^ff/.test(address)) return false; // multicast
	if (/^2001:0?db8:/.test(address)) return false; // documentation
	return /^[0-9a-f:.]+$/.test(address) && address.includes(':');
}

/**
 * Reject an endpoint host whose DNS answer is not entirely public, or that does not resolve.
 * A mixed answer is refused, so one private record cannot hide behind a public one.
 *
 * `lookup` is called with `all: true`, which is also what makes the check meaningful for a host
 * with both A and AAAA records.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
	const host = hostname.replace(/^\[|\]$/g, '');
	if (!host) throw new Error('MCP endpoint has no host');
	const literal = isPublicAddress(host);
	if (host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
		if (!literal) throw new Error('MCP endpoint resolves to a private address');
		return;
	}
	let addresses: { address: string }[];
	try {
		addresses = await lookup(host, { all: true, verbatim: true });
	} catch {
		throw new Error('MCP endpoint host does not resolve');
	}
	if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
		throw new Error('MCP endpoint resolves to a private address');
}

const schema = z
	.array(
		z
			.object({
				alias: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
				url: z.url(),
				auth: z.enum(['bearer', 'x-api-key']),
				tools: z
					.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/))
					.min(1)
					.max(128)
			})
			.strict()
	)
	.min(1)
	.max(8);
export type McpConnection = z.infer<typeof schema>[number];

export function mcpConnections(env: IntegrationEnv): McpConnection[] {
	if (!flag(env.MCP_CLIENT_ENABLED, 'MCP_CLIENT_ENABLED')) return [];
	if (!env.MCP_SERVERS_JSON || env.MCP_SERVERS_JSON.length > 32000)
		throw new Error('Configure MCP_SERVERS_JSON');
	const connections = schema.parse(JSON.parse(env.MCP_SERVERS_JSON));
	if (new Set(connections.map(({ alias }) => alias)).size !== connections.length)
		throw new Error('Duplicate MCP alias');
	for (const connection of connections) {
		if (connection.tools.some((name) => name.startsWith('COMPOSIO_')))
			throw new Error('Select direct toolkit tools, not Composio execution/router metatools');
		const url = new URL(connection.url);
		const local = /^(localhost|.*\.localhost|.*\.local|\[.*\]|\d+(?:\.\d+){3})$/i;
		// A trailing dot is the same host to the resolver: `localhost.` and `127.0.0.1.` are
		// loopback. Compare the stripped name, or the denylist never fires.
		const host = url.hostname.replace(/\.$/, '');
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.hash ||
			url.port ||
			local.test(host) ||
			EMBEDDED_IPV4.test(host) ||
			WILDCARD_RESOLVER.test(host)
		)
			throw new Error('MCP endpoints must be approved public HTTPS URLs');
		for (const key of url.searchParams.keys())
			if (/token|secret|key|password/i.test(key))
				throw new Error('MCP credentials belong in request headers');
		connection.url = url.href;
	}
	return connections;
}

export function connectionFor(env: IntegrationEnv, alias: string) {
	const connection = mcpConnections(env).find((item) => item.alias === alias);
	if (!connection) throw new Error('MCP connection is disabled or unknown');
	return connection;
}

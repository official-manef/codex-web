import { z } from 'zod';
import type { IntegrationEnv } from '../integrations/config';
import { flag } from '../ai/config';

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
		if (
			url.protocol !== 'https:' ||
			url.username ||
			url.password ||
			url.hash ||
			url.port ||
			// A trailing dot is the same host to the resolver: `localhost.` and `127.0.0.1.` are
			// loopback. Compare the stripped name, or the denylist never fires.
			local.test(url.hostname.replace(/\.$/, ''))
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

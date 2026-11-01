import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCapabilityAccess, readJsonBody } from '$lib/server/access';
import { byokToken } from '$lib/server/ai/config';
import { connectionFor, mcpConnections } from '$lib/server/mcp/config';
import { executeRemoteTool, listRemoteTools } from '$lib/server/mcp/client';
import { logEvent } from '$lib/server/log';
import type { RequestHandler } from './$types';

const bodySchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('list'), alias: z.string().max(40), token: z.string() }).strict(),
	z
		.object({
			action: z.literal('execute'),
			alias: z.string().max(40),
			token: z.string(),
			tool: z.string().max(128),
			arguments: z.record(z.string(), z.unknown()),
			confirmed: z.literal(true)
		})
		.strict()
]);

export const POST: RequestHandler = async (event) => {
	if (env.MCP_CLIENT_ENABLED !== 'true') error(404, 'Remote tools are disabled.');
	await requireCapabilityAccess(event);
	if (env.MCP_CLIENT_ENABLED !== 'true') error(404, 'MCP client is disabled.');
	const value = await readJsonBody(event.request);
	let input: z.infer<typeof bodySchema>;
	let connection: ReturnType<typeof connectionFor>;
	// A broken MCP_SERVERS_JSON is the operator's fault, not the caller's. Separate it from the
	// caller's own mistakes below, or an unparseable catalog is reported as a 400 that blames the
	// request body and sends whoever reads it hunting for a field that was never wrong.
	try {
		mcpConnections(env);
	} catch {
		await logEvent('warn', 'mcp.tools', { outcome: 'invalid-configuration' });
		error(503, 'Remote tool setup is incomplete. Check the private server configuration.');
	}
	try {
		input = bodySchema.parse(value);
		byokToken(input.token);
		connection = connectionFor(env, input.alias);
		if (input.action === 'execute' && !connection.tools.includes(input.tool))
			throw new Error('Unapproved tool');
	} catch {
		await logEvent('warn', 'mcp.tools', { outcome: 'invalid-request' });
		error(400, 'Check the configured server, token, tool and explicit confirmation.');
	}
	const fields = {
		action: input.action,
		alias: input.alias,
		...(input.action === 'execute' ? { tool: input.tool } : {})
	};
	try {
		const output =
			input.action === 'list'
				? await listRemoteTools(connection, input.token, event.request.signal)
				: await executeRemoteTool(
						connection,
						input.token,
						input.tool,
						input.arguments,
						input.confirmed,
						event.request.signal
					);
		await logEvent('info', 'mcp.tools', { ...fields, outcome: 'ok' });
		return json(output, { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		await logEvent('warn', 'mcp.tools', { ...fields, outcome: 'error' });
		error(
			502,
			'The remote tool request failed or exceeded its limits. A submitted action may have completed; inspect its state before retrying.'
		);
	}
};

import { createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCapabilityAccess, readJsonBody } from '$lib/server/access';
import { byokToken } from '$lib/server/ai/config';
import { connectionFor, mcpConnections } from '$lib/server/mcp/config';
import { executeRemoteTool, listRemoteTools } from '$lib/server/mcp/client';
import { logEvent } from '$lib/server/log';
import type { RequestHandler } from './$types';

/**
 * `confirmed: true` used to *be* the confirmation, which any same-origin script (XSS, a
 * compromised dependency) could assert to run a destructive allowlisted tool. It is now two
 * steps, mirroring the cloud path in `src/convex/mcp.ts`:
 *
 * - `prepare` freezes alias, tool and the exact argument snapshot, and returns a 120-second
 *   one-shot token. Nothing is sent to the remote server.
 * - `execute` spends that token before the first byte leaves this process. The token is stored
 *   only as SHA-256, is bound to the whole call (so it cannot be replayed with other arguments),
 *   and the row is deleted whether or not the redeemed call then succeeds.
 *
 * ponytail: the store is process memory, exactly like `consumeBurst` in `access.ts`. With more
 * than one replica a `prepare` and its `execute` can land on different workers. Upgrade path: a
 * shared store (the Convex approval table) behind the same two calls.
 */
const APPROVAL_TTL_MS = 120_000;
const MAX_PENDING = 1024;
const pending = new Map<string, { digest: string; expiresAt: number }>();

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

/** Bound to every field of the call, so one token cannot be spent on a different tool. */
function bindingOf(alias: string, tool: string, args: string): string {
	return sha256(`${alias}\u0000${tool}\u0000${args}`);
}

function issueApproval(alias: string, tool: string, args: string, now = Date.now()): string {
	for (const [id, entry] of pending) if (entry.expiresAt <= now) pending.delete(id);
	// ponytail: over the cap, the oldest ticket is evicted rather than refused, so a prepare
	// burst cannot turn into a misleading "the remote call may have completed" 502.
	for (const oldest of pending.keys()) {
		if (pending.size < MAX_PENDING) break;
		pending.delete(oldest);
	}
	const token = randomBytes(32).toString('hex');
	pending.set(sha256(token), {
		digest: bindingOf(alias, tool, args),
		expiresAt: now + APPROVAL_TTL_MS
	});
	return token;
}

/** Single use: the row is deleted whenever the token matches, even if the arguments do not. */
function takeApproval(
	token: string,
	alias: string,
	tool: string,
	args: string,
	now = Date.now()
): boolean {
	if (!/^[0-9a-f]{64}$/.test(token)) return false;
	const id = sha256(token);
	const entry = pending.get(id);
	if (!entry) return false;
	pending.delete(id);
	return entry.expiresAt > now && entry.digest === bindingOf(alias, tool, args);
}

const bodySchema = z.discriminatedUnion('action', [
	z.object({ action: z.literal('list'), alias: z.string().max(40), token: z.string() }).strict(),
	z
		.object({
			action: z.literal('prepare'),
			alias: z.string().max(40),
			token: z.string(),
			tool: z.string().max(128),
			arguments: z.record(z.string(), z.unknown())
		})
		.strict(),
	z
		.object({
			action: z.literal('execute'),
			alias: z.string().max(40),
			token: z.string(),
			tool: z.string().max(128),
			arguments: z.record(z.string(), z.unknown()),
			approval: z.string().max(64)
		})
		.strict()
]);

/** The exact JSON snapshot that was previewed and is sent verbatim on the call. */
function snapshotOf(args: Record<string, unknown>): string {
	const snapshot = JSON.stringify(args);
	if (snapshot.length > 16_000) throw new Error('Tool arguments exceed the limit');
	return snapshot;
}

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
		// Allowlist re-checked here and again in `executeRemoteTool`, so neither step alone is
		// the only gate on what may be called.
		if (input.action !== 'list' && !connection.tools.includes(input.tool))
			throw new Error('Unapproved tool');
		if (input.action !== 'list') snapshotOf(input.arguments);
	} catch {
		await logEvent('warn', 'mcp.tools', { outcome: 'invalid-request' });
		error(400, 'Check the configured server, token, tool and explicit confirmation.');
	}
	const fields = {
		action: input.action,
		alias: input.alias,
		...(input.action === 'list' ? {} : { tool: input.tool })
	};
	// Spend the approval before anything leaves the process. A replay, an expired token or the
	// same token with different arguments is refused here; a failed attempt cannot be retried.
	if (
		input.action === 'execute' &&
		!takeApproval(input.approval, connection.alias, input.tool, snapshotOf(input.arguments))
	) {
		await logEvent('warn', 'mcp.tools', { ...fields, outcome: 'approval-refused' });
		error(409, 'This approval was already used or expired. Review the call again.');
	}
	try {
		const output =
			input.action === 'list'
				? await listRemoteTools(connection, input.token, event.request.signal)
				: input.action === 'prepare'
					? {
							approval: issueApproval(connection.alias, input.tool, snapshotOf(input.arguments)),
							alias: connection.alias,
							tool: input.tool,
							arguments: input.arguments
						}
					: await executeRemoteTool(
							connection,
							input.token,
							input.tool,
							input.arguments,
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

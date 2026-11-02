import { v } from 'convex/values';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { fail, requireUser } from './_shared/auth';
import { decryptSecret, encryptSecret } from './crypto';
import {
	MAX_TOOLS,
	redactSecrets,
	snapshotArguments,
	validAlias,
	validPublicMcpUrl,
	validSecret,
	validTools
} from './_shared/mcp_rules';
import { callRemoteToolOnce, discoverToolNames } from './_shared/mcp_transport';
import type { McpEndpoint } from './_shared/mcp_transport';

/**
 * Per-user BYOK MCP connections.
 *
 * Same rule as `credentials.ts`: the owner comes from the session, the secret is posted once
 * and stored as an AES-256-GCM blob under `MODELS_ENC_KEY`, and no read ever returns it.
 *
 * This module is deliberately NOT a `'use node'` module. The wire protocol is spoken with
 * plain `fetch` (`_shared/mcp_transport.ts`) instead of importing
 * `@modelcontextprotocol/sdk`, because a Node module may only export actions — and `list`
 * must stay a query and `disconnect` a mutation. Bounds match the operator client in
 * `src/lib/server/mcp/client.ts`: 8 discovery pages, 128 tools, 15 s, 2 MiB per response,
 * 16 000 argument characters, 64 000 result characters.
 *
 * Nothing here executes a tool automatically. `prepare` returns a preview plus a one-shot
 * token; only `call` with that token reaches the network, and it re-checks the allowlist.
 *
 * The pending snapshot is encrypted at rest with the same `MODELS_ENC_KEY` blob as the
 * credential: `mcpApprovals.arguments` holds AES-256-GCM ciphertext, not the JSON the caller
 * submitted. A user who pastes a secret into a tool argument therefore does not leave it in the
 * database for the up-to-120-second approval window; the plaintext exists only in the action's
 * memory and in the response returned to the browser that asked for the preview.
 */

const MAX_CONNECTIONS = 16;
const APPROVAL_TTL_MS = 120_000;
/** Pending approvals one owner may hold. Also the page the sweep reads. */
const APPROVALS_SCANNED = 16;

const publicConnection = v.object({
	alias: v.string(),
	url: v.string(),
	auth: v.string(),
	tools: v.array(v.string()),
	label: v.optional(v.string()),
	enabled: v.boolean(),
	updatedAt: v.number()
});

type PublicConnection = {
	alias: string;
	url: string;
	auth: string;
	tools: string[];
	label?: string;
	enabled: boolean;
	updatedAt: number;
};

function hex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return hex(new Uint8Array(digest));
}

/**
 * One owned row, decrypted, for an action. The URL is re-validated on every read so a row
 * written under older rules can never reach a private address.
 */
async function resolveConnection(
	ctx: ActionCtx,
	owner: string,
	aliasInput: string
): Promise<{ alias: string; endpoint: McpEndpoint; secret: string; tools: string[] }> {
	const alias = validAlias(aliasInput);
	if (!alias) fail('invalid_request', 'That alias is not valid.');
	const row = await ctx.runQuery(internal.mcp.getRow, { owner, alias });
	if (!row) fail('not_found', `No MCP server is connected as ${alias}.`);
	if (!row.enabled) fail('invalid_request', `${alias} is turned off. Enable it in Tools first.`);
	const url = validPublicMcpUrl(row.url);
	if (!url || (row.auth !== 'bearer' && row.auth !== 'x-api-key'))
		fail('invalid_request', `${alias} has an endpoint or auth mode that is no longer allowed.`);
	const tools = validTools(row.tools);
	if (!tools) fail('invalid_request', `${alias} has no usable tool allowlist. Reconnect it.`);
	let secret: string;
	try {
		secret = await decryptSecret(row.ciphertext);
	} catch {
		// A rotated MODELS_ENC_KEY makes old rows unreadable. That is a user-actionable state.
		fail('no_credential', `The credential for ${alias} can no longer be decrypted. Reconnect it.`);
	}
	return { alias, endpoint: { url, auth: row.auth }, secret, tools };
}

export const list = query({
	args: {},
	returns: v.object({ connections: v.array(publicConnection) }),
	handler: async (ctx) => {
		const owner = await requireUser(ctx);
		const rows = await ctx.db
			.query('mcpConnections')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_CONNECTIONS);
		return {
			connections: rows.map(({ alias, url, auth, tools, label, enabled, updatedAt }) => ({
				alias,
				url,
				auth,
				tools,
				label,
				enabled,
				updatedAt
			}))
		};
	}
});

export const connect = action({
	args: {
		alias: v.string(),
		url: v.string(),
		auth: v.union(v.literal('bearer'), v.literal('x-api-key')),
		secret: v.string(),
		tools: v.array(v.string()),
		label: v.optional(v.string())
	},
	returns: publicConnection,
	handler: async (ctx, args): Promise<PublicConnection> => {
		const owner = await requireUser(ctx);
		const alias = validAlias(args.alias);
		if (!alias)
			fail('invalid_request', 'An alias is lowercase letters, digits and dashes, 1-40 characters.');
		const url = validPublicMcpUrl(args.url);
		if (!url)
			fail(
				'invalid_request',
				'Use a public HTTPS endpoint with no credentials, fragment, IP literal or local host.'
			);
		const tools = validTools(args.tools);
		if (!tools)
			fail(
				'invalid_request',
				'List 1-128 tool names of letters, digits, "_", ".", ":" or "-". Composio metatools are refused.'
			);
		const secret = validSecret(args.secret);
		if (!secret)
			fail('invalid_request', 'The credential must be non-empty printable ASCII under 16 KiB.');

		const ciphertext = await encryptSecret(secret);
		const row = await ctx.runMutation(internal.mcp.insert, {
			owner,
			alias,
			url,
			auth: args.auth,
			ciphertext,
			tools,
			label: args.label?.trim().slice(0, 80) || undefined
		});
		if (!row)
			fail(
				'invalid_request',
				`${alias} is already connected, or you already have ${MAX_CONNECTIONS} servers.`
			);
		return row;
	}
});

/** Internal write: the ciphertext is produced by the caller. Refuses duplicates and overflow. */
export const insert = internalMutation({
	args: {
		owner: v.string(),
		alias: v.string(),
		url: v.string(),
		auth: v.union(v.literal('bearer'), v.literal('x-api-key')),
		ciphertext: v.string(),
		tools: v.array(v.string()),
		label: v.optional(v.string())
	},
	returns: v.union(publicConnection, v.null()),
	handler: async (ctx, args): Promise<PublicConnection | null> => {
		const existing = await ctx.db
			.query('mcpConnections')
			.withIndex('by_owner_alias', (q) => q.eq('owner', args.owner).eq('alias', args.alias))
			.first();
		if (existing) return null;
		const rows = await ctx.db
			.query('mcpConnections')
			.withIndex('by_owner', (q) => q.eq('owner', args.owner))
			.take(MAX_CONNECTIONS);
		if (rows.length >= MAX_CONNECTIONS) return null;
		const tools = args.tools.slice(0, MAX_TOOLS);
		const updatedAt = Date.now();
		await ctx.db.insert('mcpConnections', {
			owner: args.owner,
			alias: args.alias,
			url: args.url,
			auth: args.auth,
			ciphertext: args.ciphertext,
			tools,
			label: args.label,
			enabled: true,
			updatedAt
		});
		return {
			alias: args.alias,
			url: args.url,
			auth: args.auth,
			tools,
			label: args.label,
			enabled: true,
			updatedAt
		};
	}
});

export const disconnect = mutation({
	args: { alias: v.string() },
	returns: v.object({ removed: v.boolean() }),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const alias = validAlias(args.alias);
		if (!alias) return { removed: false };
		const row = await ctx.db
			.query('mcpConnections')
			.withIndex('by_owner_alias', (q) => q.eq('owner', owner).eq('alias', alias))
			.first();
		if (!row) return { removed: false };
		await ctx.db.delete('mcpConnections', row._id);
		return { removed: true };
	}
});

/** The row switch. Separate from `connect` so toggling never needs the secret again. */
export const setEnabled = mutation({
	args: { alias: v.string(), enabled: v.boolean() },
	returns: v.object({ updated: v.boolean() }),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const alias = validAlias(args.alias);
		if (!alias) return { updated: false };
		const row = await ctx.db
			.query('mcpConnections')
			.withIndex('by_owner_alias', (q) => q.eq('owner', owner).eq('alias', alias))
			.first();
		if (!row) return { updated: false };
		await ctx.db.patch('mcpConnections', row._id, {
			enabled: args.enabled,
			updatedAt: Date.now()
		});
		return { updated: true };
	}
});

/** Internal read for the actions. Returns the ciphertext row, never the secret. */
export const getRow = internalQuery({
	args: { owner: v.string(), alias: v.string() },
	returns: v.union(
		v.object({
			url: v.string(),
			auth: v.string(),
			ciphertext: v.string(),
			tools: v.array(v.string()),
			enabled: v.boolean()
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query('mcpConnections')
			.withIndex('by_owner_alias', (q) => q.eq('owner', args.owner).eq('alias', args.alias))
			.first();
		return row
			? {
					url: row.url,
					auth: row.auth,
					ciphertext: row.ciphertext,
					tools: row.tools,
					enabled: row.enabled
				}
			: null;
	}
});

/**
 * Which of this server's allowlisted tools it actually advertises right now.
 * Names only: descriptions and schemas never leave the backend on this path.
 */
export const discover = action({
	args: { alias: v.string() },
	returns: v.object({
		reachable: v.boolean(),
		error: v.union(v.string(), v.null()),
		tools: v.array(v.string())
	}),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const { endpoint, secret, tools } = await resolveConnection(ctx, owner, args.alias);
		const result = await discoverToolNames(endpoint, secret);
		return {
			reachable: result.reachable,
			error: result.error,
			tools: result.names.filter((name) => tools.includes(name))
		};
	}
});

/**
 * Freeze one exact call for confirmation. The token has a 120-second lifetime, is returned
 * once, and is stored only as SHA-256. Nothing is executed here.
 */
export const prepare = action({
	args: {
		alias: v.string(),
		tool: v.string(),
		// Top-level object only; `snapshotArguments` additionally bounds the serialized size at
		// 16 000 characters, which no validator can express.
		arguments: v.record(v.string(), v.any())
	},
	returns: v.object({
		token: v.string(),
		alias: v.string(),
		tool: v.string(),
		arguments: v.string()
	}),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const { alias, endpoint, secret, tools } = await resolveConnection(ctx, owner, args.alias);
		if (!tools.includes(args.tool))
			fail('not_allowed', 'That tool is not in this server allowlist.');
		const snapshot = snapshotArguments(args.arguments);
		if (snapshot === null)
			fail('invalid_request', 'Pass a JSON object of at most 16 000 characters.');

		// Rediscovers so a tool the server stopped advertising is not confirmed as callable.
		const discovery = await discoverToolNames(endpoint, secret);
		if (!discovery.reachable)
			fail('provider_error', discovery.error ?? 'The MCP server could not be reached.');
		if (!discovery.names.includes(args.tool))
			fail('not_allowed', 'The server does not advertise that tool right now.');

		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		const token = hex(bytes);
		// Encrypt before the write: the row must never hold the plaintext snapshot. `prepare`
		// still returns the plaintext preview, because that is what the user confirms.
		const ciphertext = await encryptSecret(snapshot);
		await ctx.runMutation(internal.mcp.insertApproval, {
			owner,
			tokenHash: await hashToken(token),
			alias,
			tool: args.tool,
			arguments: ciphertext,
			expiresAt: Date.now() + APPROVAL_TTL_MS
		});
		return { token, alias, tool: args.tool, arguments: snapshot };
	}
});

/** Store one approval, dropping this owner's expired rows and refusing past the pending cap. */
export const insertApproval = internalMutation({
	args: {
		owner: v.string(),
		tokenHash: v.string(),
		alias: v.string(),
		tool: v.string(),
		/** AES-256-GCM blob: the field name is historical, the value is ciphertext. */
		arguments: v.string(),
		expiresAt: v.number()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const now = Date.now();
		// `by_owner` is creation-ordered, so its front page holds the oldest rows — exactly where
		// expired approvals sit. The cap below is what keeps this page sufficient: without it a
		// client looping `prepare` inside one 120-second window accumulated rows forever, since
		// nothing in that window is expired and the sweep only ever looked at 16.
		const page = await ctx.db
			.query('mcpApprovals')
			.withIndex('by_owner', (q) => q.eq('owner', args.owner))
			.take(APPROVALS_SCANNED);
		let pending = 0;
		for (const row of page) {
			if (row.expiresAt <= now) await ctx.db.delete('mcpApprovals', row._id);
			else pending++;
		}
		// A full page of live rows is the same answer as a full page plus one: this owner is at
		// the cap. The sweep above already removed whatever expired rows the page held.
		if (pending >= APPROVALS_SCANNED)
			fail(
				'rate_limited',
				'Too many tool calls are waiting for confirmation. Approve or discard one, or retry in two minutes.'
			);
		await ctx.db.insert('mcpApprovals', {
			owner: args.owner,
			tokenHash: args.tokenHash,
			alias: args.alias,
			tool: args.tool,
			arguments: args.arguments,
			expiresAt: args.expiresAt
		});
		return null;
	}
});

/** Read-and-delete in one transaction: a token can never be redeemed twice. */
export const takeApproval = internalMutation({
	args: { owner: v.string(), tokenHash: v.string() },
	returns: v.union(
		v.object({
			alias: v.string(),
			tool: v.string(),
			arguments: v.string(),
			expiresAt: v.number()
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query('mcpApprovals')
			.withIndex('by_owner_token', (q) => q.eq('owner', args.owner).eq('tokenHash', args.tokenHash))
			.first();
		if (!row) return null;
		await ctx.db.delete('mcpApprovals', row._id);
		return {
			alias: row.alias,
			tool: row.tool,
			arguments: row.arguments,
			expiresAt: row.expiresAt
		};
	}
});

/**
 * Redeem one approval. The row is consumed before the network call, so a failure cannot be
 * replayed; that is single-use, not exactly-once delivery.
 */
export const call = action({
	args: { token: v.string() },
	returns: v.object({ content: v.string(), isError: v.boolean() }),
	handler: async (ctx, args): Promise<{ content: string; isError: boolean }> => {
		const owner = await requireUser(ctx);
		if (!/^[0-9a-f]{64}$/.test(args.token))
			fail('invalid_request', 'That approval token is not valid.');
		const approval = await ctx.runMutation(internal.mcp.takeApproval, {
			owner,
			tokenHash: await hashToken(args.token)
		});
		if (!approval) fail('expired', 'This approval was already used. Review the call again.');
		if (approval.expiresAt <= Date.now())
			fail('expired', 'This approval expired after 120 seconds. Review the call again.');

		const { endpoint, secret, tools } = await resolveConnection(ctx, owner, approval.alias);
		if (!tools.includes(approval.tool))
			fail('not_allowed', 'That tool is no longer in this server allowlist.');

		// The snapshot is decrypted only after the row is consumed, so a replay cannot use it.
		// A rotated key makes the pending approval unusable, which is the same outcome as expiry.
		let snapshot: string;
		try {
			snapshot = await decryptSecret(approval.arguments);
		} catch {
			fail('expired', 'This approval can no longer be read. Review the call again.');
		}

		const discovery = await discoverToolNames(endpoint, secret);
		if (!discovery.reachable)
			fail('provider_error', discovery.error ?? 'The MCP server could not be reached.');
		if (!discovery.names.includes(approval.tool))
			fail('not_allowed', 'The server no longer advertises that tool.');

		try {
			return await callRemoteToolOnce(endpoint, secret, approval.tool, snapshot);
		} catch (error) {
			// The remote text and the credential never reach the client; only a short cause.
			const raw = error instanceof Error ? error.message : 'The remote tool call failed.';
			fail(
				'provider_error',
				`${redactSecrets(raw, [secret, endpoint.url]).slice(0, 300)} A submitted call may have completed remotely; inspect its state before retrying.`
			);
		}
	}
});

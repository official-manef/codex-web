import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireUser } from './_shared/auth';
import { normalizeEndpoint } from './_shared/endpoint';

/**
 * Device pairing, so a user's own machine (a local runtime, an NPU box, a laptop) can stream to
 * this workspace instead of the cloud.
 *
 * The pairing token is generated in the browser and only its SHA-256 hash is stored here. A row
 * is therefore useless if the database leaks: the hash cannot be replayed.
 *
 * The template does not run the device side. `src/lib/http.local.ts` documents the local
 * transport; a product that ships device streaming verifies the token at its own endpoint.
 */

const MAX_DEVICES = 20;
const KINDS = new Set(['terminal', 'browser', 'npu', 'runtime']);

const device = v.object({
	_id: v.id('devices'),
	name: v.string(),
	kind: v.string(),
	lastSeenAt: v.number(),
	revokedAt: v.optional(v.number()),
	/** Omitted when the stored value fails validation, so a bad row never reaches a client. */
	endpoint: v.optional(v.string())
});

export const list = query({
	args: {},
	returns: v.array(device),
	handler: async (ctx) => {
		const owner = await requireUser(ctx);
		const rows = await ctx.db
			.query('devices')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_DEVICES);
		return rows.map(({ _id, name, kind, lastSeenAt, revokedAt, endpoint }) => {
			const origin = normalizeEndpoint(endpoint);
			return {
				_id,
				name,
				kind,
				lastSeenAt,
				revokedAt,
				...(origin ? { endpoint: origin } : {})
			};
		});
	}
});

/**
 * The one ownership check for a device row. A revoked row is treated as gone, so a leaked
 * token cannot keep a retired device alive.
 */
async function ownedDevice(ctx: MutationCtx, owner: string, id: Id<'devices'>) {
	const row = await ctx.db.get('devices', id);
	if (!row || row.owner !== owner || row.revokedAt) return null;
	return row;
}

/**
 * Register a device. The caller sends the SHA-256 of a token it generated; the plaintext token
 * never reaches this function.
 */
export const register = mutation({
	args: {
		name: v.string(),
		kind: v.string(),
		tokenHash: v.string(),
		endpoint: v.optional(v.string())
	},
	returns: v.id('devices'),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		if (!/^[a-f0-9]{64}$/.test(args.tokenHash))
			throw new Error('The device token hash must be a SHA-256 hex digest.');
		const endpoint = args.endpoint === undefined ? null : normalizeEndpoint(args.endpoint);
		if (args.endpoint !== undefined && !endpoint)
			throw new Error('The endpoint must be an http or https origin, with no path or credentials.');
		const existing = await ctx.db
			.query('devices')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_DEVICES);
		if (existing.length >= MAX_DEVICES)
			throw new Error('This account already has the maximum devices.');
		// A pairing token names one machine. Two rows with the same hash would mean revoking one
		// device left a second row holding the same still-valid token alive.
		if (existing.some((row) => row.tokenHash === args.tokenHash))
			throw new Error('That pairing token is already registered. Generate a new one.');
		return await ctx.db.insert('devices', {
			owner,
			name: args.name.trim().slice(0, 80) || 'This device',
			kind: KINDS.has(args.kind) ? args.kind : 'runtime',
			tokenHash: args.tokenHash,
			...(endpoint ? { endpoint } : {}),
			lastSeenAt: Date.now()
		});
	}
});

/** A device heartbeat. Ownership is checked before the write. */
export const touch = mutation({
	args: { id: v.id('devices') },
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const row = await ownedDevice(ctx, owner, args.id);
		if (!row) return false;
		await ctx.db.patch('devices', args.id, { lastSeenAt: Date.now() });
		return true;
	}
});

/**
 * The same heartbeat, reporting when the device was last seen. `lastSeenAt` is `0` when the
 * row is missing, revoked or owned by someone else: the caller learns nothing about it.
 */
export const heartbeat = mutation({
	args: { id: v.id('devices') },
	returns: v.object({ ok: v.boolean(), lastSeenAt: v.number() }),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const row = await ownedDevice(ctx, owner, args.id);
		if (!row) return { ok: false, lastSeenAt: 0 };
		const lastSeenAt = Date.now();
		await ctx.db.patch('devices', args.id, { lastSeenAt });
		return { ok: true, lastSeenAt };
	}
});

export const revoke = mutation({
	args: { id: v.id('devices') },
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const row = await ctx.db.get('devices', args.id);
		if (!row || row.owner !== owner) return false;
		await ctx.db.patch('devices', args.id, { revokedAt: Date.now() });
		return true;
	}
});

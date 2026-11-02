import { v } from 'convex/values';
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { fail, requireUser } from './_shared/auth';
import { encryptSecret } from './crypto';

/**
 * BYOK credential store.
 *
 * Every public function derives the owner from the session; a client never sends one. The raw
 * key exists only inside this action's memory and the encrypted `ciphertext` column.
 *
 * Adapted from `models-rahmanef-com` (web/convex/credentials.ts) with three rr-mandated changes:
 *   1. object-form `returns` validators on every registered function (P0)
 *   2. bounded reads — `.take(N)`, never a bare `.collect()` (P1)
 *   3. identity comes from this app's session helper, not `@convex-dev/auth`
 */

const MAX_PROVIDERS = 32;
const MAX_KEY_BYTES = 16_384;

/** What a client is allowed to know about a credential. Never the key. */
const publicCred = v.object({
	provider: v.string(),
	kind: v.string(),
	label: v.optional(v.string()),
	endpoint: v.optional(v.string()),
	protocol: v.optional(v.string()),
	models: v.optional(v.array(v.string())),
	updatedAt: v.number()
});

function keyError(key: string | undefined): string | null {
	if (key === undefined) return null;
	if (!key) return 'The key is empty.';
	if (key.length > MAX_KEY_BYTES) return 'The key is too long for a provider credential.';
	// A real API key is printable ASCII with no spaces. Rejecting anything else keeps a pasted
	// multi-line blob or a stray control character from reaching the provider.
	if ([...key].some((char) => char.codePointAt(0)! < 0x21 || char.codePointAt(0)! > 0x7e))
		return 'The key must be printable ASCII with no spaces.';
	return null;
}

function providerError(provider: string): string | null {
	return /^[a-z0-9][a-z0-9-]{0,63}$/.test(provider)
		? null
		: 'Provider slugs are lowercase letters, digits and dashes.';
}

/** Which providers this user has connected. Slugs only — never ciphertext, never a key. */
export const listProviders = query({
	args: {},
	returns: v.array(publicCred),
	handler: async (ctx) => {
		const owner = await requireUser(ctx);
		const rows = await ctx.db
			.query('modelCreds')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_PROVIDERS);
		return rows.map(({ provider, kind, label, endpoint, protocol, models, updatedAt }) => ({
			provider,
			kind,
			label,
			endpoint,
			protocol,
			models,
			updatedAt
		}));
	}
});

/** Which provider slugs are connected — cheap shape for a picker badge. */
export const connectedSlugs = query({
	args: {},
	returns: v.array(v.string()),
	handler: async (ctx) => {
		const owner = await requireUser(ctx);
		const rows = await ctx.db
			.query('modelCreds')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_PROVIDERS);
		return rows.map((row) => row.provider);
	}
});

/**
 * Store or replace a provider key. Encryption happens in the action (mutations must stay
 * deterministic), so this is an `action` that delegates the write to an internal mutation.
 */
export const connect = action({
	args: {
		provider: v.string(),
		apiKey: v.string(),
		label: v.optional(v.string()),
		endpoint: v.optional(v.string()),
		protocol: v.optional(v.string()),
		models: v.optional(v.array(v.string()))
	},
	returns: v.object({ provider: v.string(), ok: v.literal(true) }),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const providerIssue = providerError(args.provider);
		if (providerIssue) fail('invalid_request', providerIssue);
		const keyIssue = keyError(args.apiKey);
		if (keyIssue) fail('invalid_request', keyIssue);

		// A custom endpoint is the only case where a caller-supplied baseURL is honoured; built-in
		// providers stay pinned to the registry host so a key can never be redirected elsewhere.
		const endpoint = args.endpoint?.trim() || undefined;
		if (endpoint) {
			let url: URL;
			try {
				url = new URL(endpoint);
			} catch {
				fail('invalid_request', 'The custom endpoint is not a valid URL.');
			}
			if (url.protocol !== 'https:') fail('invalid_request', 'A custom endpoint must use HTTPS.');
			if (url.username || url.password)
				fail('invalid_request', 'The endpoint must not embed credentials.');
		}

		const models = args.models
			? [...new Set(args.models.map((item) => item.trim()).filter(Boolean))].slice(0, 100)
			: undefined;
		const protocol = args.protocol === 'anthropic' ? 'anthropic' : undefined;
		const ciphertext = await encryptSecret(args.apiKey);

		await ctx.runMutation(internal.credentials.store, {
			owner,
			provider: args.provider,
			kind: 'api_key',
			ciphertext,
			label: args.label?.trim().slice(0, 80) || undefined,
			endpoint,
			protocol,
			models
		});
		return { provider: args.provider, ok: true as const };
	}
});

/** Upsert. Internal only: the ciphertext is already produced by the caller. */
export const store = internalMutation({
	args: {
		owner: v.string(),
		provider: v.string(),
		kind: v.string(),
		ciphertext: v.string(),
		label: v.optional(v.string()),
		endpoint: v.optional(v.string()),
		protocol: v.optional(v.string()),
		models: v.optional(v.array(v.string()))
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('modelCreds')
			.withIndex('by_owner_provider', (q) =>
				q.eq('owner', args.owner).eq('provider', args.provider)
			)
			.first();
		const patch = {
			kind: args.kind,
			ciphertext: args.ciphertext,
			label: args.label,
			endpoint: args.endpoint,
			protocol: args.protocol,
			models: args.models,
			updatedAt: Date.now()
		};
		if (existing) await ctx.db.patch('modelCreds', existing._id, patch);
		else {
			// A replacement is not an addition. Without this, `listProviders` read only the first
			// MAX_PROVIDERS rows while the table accepted every new slug.
			const rows = await ctx.db
				.query('modelCreds')
				.withIndex('by_owner', (q) => q.eq('owner', args.owner))
				.take(MAX_PROVIDERS);
			if (rows.length >= MAX_PROVIDERS)
				fail('quota_exceeded', `Maximum ${MAX_PROVIDERS} provider keys reached.`);
			await ctx.db.insert('modelCreds', { owner: args.owner, provider: args.provider, ...patch });
		}
		return null;
	}
});

/** Internal read used by the chat action. Returns the ciphertext row, never the key. */
export const getRow = internalQuery({
	args: { owner: v.string(), provider: v.string() },
	returns: v.union(
		v.object({
			ciphertext: v.string(),
			endpoint: v.optional(v.string()),
			protocol: v.optional(v.string())
		}),
		v.null()
	),
	handler: async (ctx, args) => {
		const row = await ctx.db
			.query('modelCreds')
			.withIndex('by_owner_provider', (q) =>
				q.eq('owner', args.owner).eq('provider', args.provider)
			)
			.first();
		return row
			? { ciphertext: row.ciphertext, endpoint: row.endpoint, protocol: row.protocol }
			: null;
	}
});

/** Revoke. The row is deleted, so the ciphertext is unrecoverable. */
export const disconnect = mutation({
	args: { provider: v.string() },
	returns: v.object({ removed: v.boolean() }),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const row = await ctx.db
			.query('modelCreds')
			.withIndex('by_owner_provider', (q) => q.eq('owner', owner).eq('provider', args.provider))
			.first();
		if (!row) return { removed: false };
		await ctx.db.delete('modelCreds', row._id);
		return { removed: true };
	}
});

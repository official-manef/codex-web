import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { requireUser } from './_shared/auth';

/**
 * Persistent memory notes for chat context (Convex store).
 *
 * Local mode uses localStorage (`src/lib/memories.ts`); signed-in cloud mode stores
 * memories here, indexed and scoped by owner.
 *
 * Note: `context` is NOT a Convex function. Building the prompt block stays client-side.
 */

const MAX_MEMORIES = 50;
const MAX_TEXT_CHARS = 400;

function fail(code: 'invalid_request' | 'limit' | 'not_found', message: string): never {
	throw new ConvexError({ code, message });
}

const memory = v.object({
	_id: v.id('memories'),
	text: v.string(),
	createdAt: v.number(),
	usedAt: v.optional(v.number())
});

export const list = query({
	args: {},
	returns: v.array(memory),
	handler: async (ctx) => {
		const owner = await requireUser(ctx);
		const rows = await ctx.db
			.query('memories')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.order('desc')
			.take(MAX_MEMORIES);
		return rows
			.sort((a, b) => b.createdAt - a.createdAt)
			.map(({ _id, text, createdAt, usedAt }) => ({
				_id,
				text,
				createdAt,
				...(usedAt !== undefined ? { usedAt } : {})
			}));
	}
});

export const add = mutation({
	args: { text: v.string() },
	returns: v.id('memories'),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const text = args.text.trim();
		if (!text) {
			fail('invalid_request', 'Memory text cannot be empty.');
		}
		if (text.length > MAX_TEXT_CHARS) {
			fail('invalid_request', `Memory text exceeds ${MAX_TEXT_CHARS} characters.`);
		}
		const existing = await ctx.db
			.query('memories')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_MEMORIES);
		if (existing.length >= MAX_MEMORIES) {
			fail('limit', `Maximum ${MAX_MEMORIES} memories reached.`);
		}
		return await ctx.db.insert('memories', {
			owner,
			text,
			createdAt: Date.now()
		});
	}
});

export const remove = mutation({
	args: { id: v.id('memories') },
	returns: v.null(),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const row = await ctx.db.get('memories', args.id);
		if (!row || row.owner !== owner) {
			fail('not_found', 'Memory not found.');
		}
		await ctx.db.delete('memories', args.id);
		return null;
	}
});

export const clear = mutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const owner = await requireUser(ctx);
		const rows = await ctx.db
			.query('memories')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_MEMORIES * 2);
		for (const row of rows) {
			await ctx.db.delete('memories', row._id);
		}
		return null;
	}
});

export const touch = internalMutation({
	args: { ids: v.array(v.id('memories')) },
	returns: v.null(),
	handler: async (ctx, args) => {
		const targetIds = args.ids.slice(0, MAX_MEMORIES);
		const now = Date.now();
		for (const id of targetIds) {
			const row = await ctx.db.get('memories', id);
			if (row) {
				await ctx.db.patch('memories', id, { usedAt: now });
			}
		}
		return null;
	}
});

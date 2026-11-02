import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { fail, requireUser } from './_shared/auth';

/**
 * Chat persistence and usage counters.
 *
 * Local mode never touches these. A signed-in user's cloud sessions land here, and a local
 * session may be pushed with `source: 'local'` so the record stays truthful about where the
 * text came from.
 */

const MAX_SESSIONS = 50;
const MAX_MESSAGES = 200;
/** Usage history is kept for a rolling window, then pruned by the writer itself. */
const USAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** How many stale usage rows one write is allowed to remove. */
const USAGE_PRUNE_BATCH = 50;
/** Bounded drain rounds when deleting a session's messages. */
const DELETE_ROUNDS = 20;

const session = v.object({
	_id: v.id('sessions'),
	title: v.string(),
	model: v.string(),
	engine: v.string(),
	at: v.number()
});

const message = v.object({
	_id: v.id('messages'),
	sessionId: v.id('sessions'),
	role: v.string(),
	content: v.string(),
	source: v.string(),
	at: v.number()
});

export const listSessions = query({
	args: {},
	returns: v.array(session),
	handler: async (ctx) => {
		const owner = await requireUser(ctx);
		const rows = await ctx.db
			.query('sessions')
			.withIndex('by_owner_at', (q) => q.eq('owner', owner))
			.order('desc')
			.take(MAX_SESSIONS);
		return rows.map(({ _id, title, model, engine, at }) => ({ _id, title, model, engine, at }));
	}
});

export const createSession = mutation({
	args: { title: v.string(), model: v.string(), engine: v.string() },
	returns: v.id('sessions'),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const title = args.title.trim().slice(0, 120) || 'New chat';
		// The read bound is not a write bound: without this check `listSessions` silently hid
		// every session past the 50th while the table kept growing.
		const existing = await ctx.db
			.query('sessions')
			.withIndex('by_owner_at', (q) => q.eq('owner', owner))
			.take(MAX_SESSIONS);
		if (existing.length >= MAX_SESSIONS)
			fail('quota_exceeded', `Maximum ${MAX_SESSIONS} saved chats reached. Delete one first.`);
		return await ctx.db.insert('sessions', {
			owner,
			title,
			model: args.model.slice(0, 200),
			engine: args.engine === 'local' ? 'local' : 'cloud',
			at: Date.now()
		});
	}
});

export const renameSession = mutation({
	args: { id: v.id('sessions'), title: v.string() },
	returns: v.null(),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const row = await ctx.db.get('sessions', args.id);
		// Ownership is checked here, not by the caller: a session id is not authority.
		if (!row || row.owner !== owner) return null;
		await ctx.db.patch('sessions', args.id, {
			title: args.title.trim().slice(0, 120) || 'New chat'
		});
		return null;
	}
});

export const deleteSession = mutation({
	args: { id: v.id('sessions') },
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const row = await ctx.db.get('sessions', args.id);
		if (!row || row.owner !== owner) return false;
		// Drain every page: a single `take(MAX_MESSAGES)` left messages past the 200th behind,
		// and they were then unreachable — the session row they were read through was gone.
		// ponytail: raise DELETE_ROUNDS if a session can hold more than 4 000 messages.
		for (let round = 0; round < DELETE_ROUNDS; round++) {
			const messages = await ctx.db
				.query('messages')
				.withIndex('by_session_at', (q) => q.eq('sessionId', args.id))
				.take(MAX_MESSAGES);
			if (!messages.length) break;
			for (const item of messages) await ctx.db.delete('messages', item._id);
		}
		await ctx.db.delete('sessions', args.id);
		return true;
	}
});

export const listMessages = query({
	args: { sessionId: v.id('sessions') },
	returns: v.array(message),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const parent = await ctx.db.get('sessions', args.sessionId);
		if (!parent || parent.owner !== owner) return [];
		const rows = await ctx.db
			.query('messages')
			.withIndex('by_session_at', (q) => q.eq('sessionId', args.sessionId))
			.order('asc')
			.take(MAX_MESSAGES);
		return rows.map(({ _id, sessionId, role, content, source, at }) => ({
			_id,
			sessionId,
			role,
			content,
			source,
			at
		}));
	}
});

/** Append one turn. `source` records whether a device or the cloud produced it. */
export const appendMessage = mutation({
	args: {
		sessionId: v.id('sessions'),
		role: v.string(),
		content: v.string(),
		source: v.string()
	},
	returns: v.id('messages'),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const parent = await ctx.db.get('sessions', args.sessionId);
		if (!parent || parent.owner !== owner) throw new Error('That chat is not available.');
		// An empty turn is a blank bubble that no reader can act on; reject it at the boundary
		// instead of storing it (it used to be stored as `''` after the slice).
		if (!args.content.trim()) fail('invalid_request', 'A message cannot be empty.');
		const content = args.content.slice(0, 32_000);
		const id = await ctx.db.insert('messages', {
			owner,
			sessionId: args.sessionId,
			role: args.role === 'assistant' ? 'assistant' : 'user',
			content,
			source: ['local', 'cloud', 'decision'].includes(args.source) ? args.source : 'cloud',
			at: Date.now()
		});
		await ctx.db.patch('sessions', args.sessionId, { at: Date.now() });
		return id;
	}
});

// ── usage ──────────────────────────────────────────────────────────────────────────────

export const log = internalMutation({
	args: {
		owner: v.string(),
		provider: v.string(),
		model: v.string(),
		promptTokens: v.number(),
		completionTokens: v.number(),
		status: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		// Append-only before this: the usage table grew without bound. Prune rows past the
		// retention window on each write, using the indexed order so the read stays bounded.
		// ponytail: time-based retention only; add a row cap if one owner logs more than
		// USAGE_PRUNE_BATCH rows a day.
		const now = Date.now();
		const stale = await ctx.db
			.query('usage')
			.withIndex('by_owner_at', (q) => q.eq('owner', args.owner).lt('at', now - USAGE_RETENTION_MS))
			.take(USAGE_PRUNE_BATCH);
		for (const row of stale) await ctx.db.delete('usage', row._id);
		await ctx.db.insert('usage', { ...args, at: now });
		return null;
	}
});

export const usageSummary = query({
	args: {},
	returns: v.object({
		requests: v.number(),
		promptTokens: v.number(),
		completionTokens: v.number(),
		errors: v.number()
	}),
	handler: async (ctx) => {
		const owner = await requireUser(ctx);
		// Bounded: the dashboard asks for a rolling window, not the whole history.
		const rows = await ctx.db
			.query('usage')
			.withIndex('by_owner_at', (q) => q.eq('owner', owner))
			.order('desc')
			.take(500);
		return {
			requests: rows.length,
			promptTokens: rows.reduce((sum, row) => sum + row.promptTokens, 0),
			completionTokens: rows.reduce((sum, row) => sum + row.completionTokens, 0),
			errors: rows.filter((row) => row.status !== 'ok').length
		};
	}
});

import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { fail, requireUser } from './_shared/auth';
import {
	INTERVALS,
	MAX_AUTOMATIONS,
	MAX_FAILURES,
	MAX_PROMPT_LENGTH,
	isValidInterval,
	nextRunAt,
	shouldDisable
} from '../lib/automations';

/**
 * Automations: scheduling intent and due times.
 *
 * This records intent and due times; the runner that actually calls a model is not
 * implemented, and scheduling a prompt before the failure path is proven is exactly
 * the mistake this phase is meant to avoid.
 */

const automationDoc = v.object({
	_id: v.id('automations'),
	_creationTime: v.number(),
	owner: v.string(),
	sessionId: v.optional(v.id('sessions')),
	prompt: v.string(),
	intervalMinutes: v.number(),
	nextRunAt: v.number(),
	enabled: v.boolean(),
	failureCount: v.number(),
	lastRunAt: v.optional(v.number())
});

export const list = query({
	args: {},
	returns: v.array(automationDoc),
	handler: async (ctx) => {
		const owner = await requireUser(ctx);
		return await ctx.db
			.query('automations')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_AUTOMATIONS);
	}
});

export const create = mutation({
	args: {
		prompt: v.string(),
		intervalMinutes: v.number(),
		sessionId: v.optional(v.id('sessions'))
	},
	returns: v.id('automations'),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const prompt = args.prompt.trim();
		if (!prompt || args.prompt.length > MAX_PROMPT_LENGTH) {
			fail('invalid_request', `Prompt must be between 1 and ${MAX_PROMPT_LENGTH} characters.`);
		}
		if (!isValidInterval(args.intervalMinutes)) {
			fail('invalid_request', `Interval must be one of: ${INTERVALS.join(', ')} minutes.`);
		}
		const existing = await ctx.db
			.query('automations')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_AUTOMATIONS);
		if (existing.length >= MAX_AUTOMATIONS) {
			fail('quota_exceeded', `Maximum of ${MAX_AUTOMATIONS} automations reached.`);
		}
		return await ctx.db.insert('automations', {
			owner,
			sessionId: args.sessionId,
			prompt: args.prompt,
			intervalMinutes: args.intervalMinutes,
			nextRunAt: nextRunAt(Date.now(), args.intervalMinutes),
			enabled: true,
			failureCount: 0
		});
	}
});

export const setEnabled = mutation({
	args: {
		id: v.id('automations'),
		enabled: v.boolean()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const row = await ctx.db.get('automations', args.id);
		if (!row || row.owner !== owner) {
			fail('not_found', 'Automation not found.');
		}
		await ctx.db.patch('automations', args.id, {
			enabled: args.enabled,
			...(args.enabled ? { failureCount: 0 } : {})
		});
		return null;
	}
});

export const remove = mutation({
	args: {
		id: v.id('automations')
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const row = await ctx.db.get('automations', args.id);
		if (!row || row.owner !== owner) {
			fail('not_found', 'Automation not found.');
		}
		await ctx.db.delete('automations', args.id);
		return null;
	}
});

export const due = internalQuery({
	args: {
		now: v.optional(v.number())
	},
	returns: v.array(automationDoc),
	handler: async (ctx, args) => {
		const now = args.now ?? Date.now();
		return await ctx.db
			.query('automations')
			.withIndex('by_due', (q) => q.eq('enabled', true).lte('nextRunAt', now))
			.take(MAX_AUTOMATIONS);
	}
});

export const recordRun = internalMutation({
	args: {
		id: v.id('automations'),
		success: v.boolean(),
		ranAt: v.optional(v.number())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const row = await ctx.db.get('automations', args.id);
		if (!row) {
			fail('not_found', 'Automation not found.');
		}
		const ranAt = args.ranAt ?? Date.now();
		const next = nextRunAt(ranAt, row.intervalMinutes);
		if (args.success) {
			await ctx.db.patch('automations', args.id, {
				lastRunAt: ranAt,
				nextRunAt: next,
				failureCount: 0
			});
		} else {
			const failureCount = row.failureCount + 1;
			const disabled = shouldDisable(failureCount);
			await ctx.db.patch('automations', args.id, {
				lastRunAt: ranAt,
				nextRunAt: next,
				failureCount,
				...(disabled ? { enabled: false } : {})
			});
		}
		return null;
	}
});

export const claimRun = internalMutation({
	args: {
		id: v.id('automations'),
		now: v.number()
	},
	returns: v.union(v.literal('claimed'), v.literal('not_due'), v.literal('disabled')),
	handler: async (ctx, args) => {
		const row = await ctx.db.get('automations', args.id);
		if (!row) {
			fail('not_found', 'Automation not found.');
		}
		if (!row.enabled || row.failureCount >= MAX_FAILURES) {
			return 'disabled';
		}
		if (row.nextRunAt > args.now) {
			return 'not_due';
		}
		// Moving nextRunAt forward inside the claim is what makes a second concurrent drain a no-op.
		await ctx.db.patch('automations', args.id, {
			lastRunAt: args.now,
			nextRunAt: nextRunAt(args.now, row.intervalMinutes)
		});
		return 'claimed';
	}
});

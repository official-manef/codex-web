import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireUser } from './_shared/auth';

/**
 * Projects and session membership (Convex store).
 *
 * Local mode keeps membership in localStorage (`src/lib/projects.ts`); signed-in
 * cloud mode stores projects and projectChats here, scoped by owner.
 */

const MAX_PROJECTS = 50;
const MAX_NAME_CHARS = 60;
const MAX_INSTRUCTIONS_CHARS = 2000;
const MAX_PROJECT_CHATS = 500;
/** Bounded drain rounds when deleting a project's memberships. */
const DELETE_ROUNDS = 20;

function fail(code: 'invalid_request' | 'limit' | 'not_found', message: string): never {
	throw new ConvexError({ code, message });
}

/** A name a person can read back: trimmed, collapsed whitespace, 1–60 chars. */
export function cleanName(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const name = value.trim().replace(/\s+/g, ' ');
	if (!name || name.length > MAX_NAME_CHARS) return null;
	return name;
}

const project = v.object({
	_id: v.id('projects'),
	name: v.string(),
	instructions: v.optional(v.string()),
	createdAt: v.number()
});

export const list = query({
	args: {},
	returns: v.array(project),
	handler: async (ctx) => {
		const owner = await requireUser(ctx);
		const rows = await ctx.db
			.query('projects')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.order('desc')
			.take(MAX_PROJECTS);
		return rows.map(({ _id, name, instructions, createdAt }) => ({
			_id,
			name,
			...(instructions !== undefined ? { instructions } : {}),
			createdAt
		}));
	}
});

export const create = mutation({
	args: {
		name: v.string(),
		instructions: v.optional(v.string())
	},
	returns: v.id('projects'),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const name = cleanName(args.name);
		if (!name) {
			fail('invalid_request', `Project name must be 1 to ${MAX_NAME_CHARS} characters.`);
		}
		if (args.instructions !== undefined && args.instructions.length > MAX_INSTRUCTIONS_CHARS) {
			fail('invalid_request', `Instructions cannot exceed ${MAX_INSTRUCTIONS_CHARS} characters.`);
		}
		const existing = await ctx.db
			.query('projects')
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_PROJECTS);
		if (existing.length >= MAX_PROJECTS) {
			fail('limit', `Maximum ${MAX_PROJECTS} projects reached.`);
		}
		return await ctx.db.insert('projects', {
			owner,
			name,
			...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
			createdAt: Date.now()
		});
	}
});

export const rename = mutation({
	args: {
		id: v.id('projects'),
		name: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const name = cleanName(args.name);
		if (!name) {
			fail('invalid_request', `Project name must be 1 to ${MAX_NAME_CHARS} characters.`);
		}
		const row = await ctx.db.get('projects', args.id);
		if (!row || row.owner !== owner) {
			fail('not_found', 'Project not found.');
		}
		await ctx.db.patch('projects', args.id, { name });
		return null;
	}
});

export const remove = mutation({
	args: { id: v.id('projects') },
	returns: v.null(),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const row = await ctx.db.get('projects', args.id);
		if (!row || row.owner !== owner) {
			fail('not_found', 'Project not found.');
		}
		// Drain, not one page: a single `take(MAX_PROJECT_CHATS)` used to leave every membership
		// past the 500th pointing at a project that no longer exists. Ceiling: DELETE_ROUNDS.
		// ponytail: raise DELETE_ROUNDS if a project can legitimately hold more than 10 000 chats.
		for (let round = 0; round < DELETE_ROUNDS; round++) {
			const chats = await ctx.db
				.query('projectChats')
				.withIndex('by_project', (q) => q.eq('projectId', args.id))
				.take(MAX_PROJECT_CHATS);
			if (!chats.length) break;
			for (const chat of chats) {
				await ctx.db.delete('projectChats', chat._id);
			}
		}
		await ctx.db.delete('projects', args.id);
		return null;
	}
});

export const assign = mutation({
	args: {
		projectId: v.union(v.id('projects'), v.null()),
		sessionId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		if (!args.sessionId.trim()) {
			fail('invalid_request', 'Session ID cannot be empty.');
		}
		if (args.projectId !== null) {
			const projectRow = await ctx.db.get('projects', args.projectId);
			if (!projectRow || projectRow.owner !== owner) {
				fail('not_found', 'Project not found.');
			}
		}
		const existing = await ctx.db
			.query('projectChats')
			.withIndex('by_owner_session', (q) => q.eq('owner', owner).eq('sessionId', args.sessionId))
			.take(MAX_PROJECT_CHATS);
		for (const row of existing) {
			await ctx.db.delete('projectChats', row._id);
		}
		if (args.projectId !== null) {
			await ctx.db.insert('projectChats', {
				owner,
				projectId: args.projectId,
				sessionId: args.sessionId
			});
		}
		return null;
	}
});

export const ofSession = query({
	args: { sessionId: v.string() },
	returns: v.union(project, v.null()),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const rows = await ctx.db
			.query('projectChats')
			.withIndex('by_owner_session', (q) => q.eq('owner', owner).eq('sessionId', args.sessionId))
			.first();
		if (!rows) return null;
		const projectRow = await ctx.db.get('projects', rows.projectId);
		if (!projectRow || projectRow.owner !== owner) return null;
		return {
			_id: projectRow._id,
			name: projectRow.name,
			...(projectRow.instructions !== undefined ? { instructions: projectRow.instructions } : {}),
			createdAt: projectRow.createdAt
		};
	}
});

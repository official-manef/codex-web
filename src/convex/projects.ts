import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
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
const MAX_PROJECT_FILES = 20;
const MAX_PROJECT_CHATS = 500;

type ProjectWithFiles = Doc<'projects'> & { files?: { path: string; bytes: number }[] };

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

/**
 * Validates a relative project file path label.
 * NOTE: This is a label, not a filesystem path: nothing is read from disk,
 * and a project is never a permission.
 */
function isValidProjectPath(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	if (value.length < 1 || value.length > 300) return false;
	if (value.startsWith('/')) return false;
	if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false;
	if (value.split('/').includes('..')) return false;
	return true;
}

const fileValidator = v.object({
	path: v.string(),
	bytes: v.number()
});

const project = v.object({
	_id: v.id('projects'),
	name: v.string(),
	instructions: v.optional(v.string()),
	files: v.optional(v.array(fileValidator)),
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
		return rows.map((row) => {
			const withFiles = row as unknown as ProjectWithFiles;
			return {
				_id: row._id,
				name: row.name,
				...(row.instructions !== undefined ? { instructions: row.instructions } : {}),
				...(withFiles.files !== undefined ? { files: withFiles.files } : {}),
				createdAt: row.createdAt
			};
		});
	}
});

export const create = mutation({
	args: {
		name: v.string(),
		instructions: v.optional(v.string()),
		files: v.optional(v.array(fileValidator))
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
		if (args.files !== undefined) {
			if (args.files.length > MAX_PROJECT_FILES) {
				fail('invalid_request', `Maximum ${MAX_PROJECT_FILES} files allowed.`);
			}
			for (const file of args.files) {
				if (!isValidProjectPath(file.path)) {
					fail('invalid_request', `Invalid file path: ${file.path}`);
				}
				if (
					typeof file.bytes !== 'number' ||
					!Number.isFinite(file.bytes) ||
					file.bytes < 0 ||
					!Number.isInteger(file.bytes)
				) {
					fail('invalid_request', `Invalid file size for path: ${file.path}`);
				}
			}
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
			...(args.files !== undefined ? { files: args.files } : {}),
			createdAt: Date.now()
		} as unknown as { owner: string; name: string; createdAt: number });
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
		const chats = await ctx.db
			.query('projectChats')
			.withIndex('by_project', (q) => q.eq('projectId', args.id))
			.take(MAX_PROJECT_CHATS);
		for (const chat of chats) {
			await ctx.db.delete('projectChats', chat._id);
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
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_PROJECT_CHATS);
		const matches = existing.filter((row) => row.sessionId === args.sessionId);
		for (const row of matches) {
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
			.withIndex('by_owner', (q) => q.eq('owner', owner))
			.take(MAX_PROJECT_CHATS);
		const assignment = rows.find((row) => row.sessionId === args.sessionId);
		if (!assignment) return null;
		const projectRow = (await ctx.db.get(
			'projects',
			assignment.projectId
		)) as unknown as ProjectWithFiles | null;
		if (!projectRow || projectRow.owner !== owner) return null;
		return {
			_id: projectRow._id,
			name: projectRow.name,
			...(projectRow.instructions !== undefined ? { instructions: projectRow.instructions } : {}),
			...(projectRow.files !== undefined ? { files: projectRow.files } : {}),
			createdAt: projectRow.createdAt
		};
	}
});

export const setDetail = mutation({
	args: {
		id: v.id('projects'),
		instructions: v.optional(v.string()),
		files: v.optional(v.array(fileValidator))
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const owner = await requireUser(ctx);
		const row = await ctx.db.get('projects', args.id);
		if (!row || row.owner !== owner) {
			fail('not_found', 'Project not found.');
		}
		if (args.instructions !== undefined && args.instructions.length > MAX_INSTRUCTIONS_CHARS) {
			fail('invalid_request', `Instructions cannot exceed ${MAX_INSTRUCTIONS_CHARS} characters.`);
		}
		if (args.files !== undefined) {
			if (args.files.length > MAX_PROJECT_FILES) {
				fail('invalid_request', `Maximum ${MAX_PROJECT_FILES} files allowed.`);
			}
			for (const file of args.files) {
				if (!isValidProjectPath(file.path)) {
					fail('invalid_request', `Invalid file path: ${file.path}`);
				}
				if (
					typeof file.bytes !== 'number' ||
					!Number.isFinite(file.bytes) ||
					file.bytes < 0 ||
					!Number.isInteger(file.bytes)
				) {
					fail('invalid_request', `Invalid file size for path: ${file.path}`);
				}
			}
		}
		const patch: Record<string, unknown> = {};
		if (args.instructions !== undefined) {
			patch.instructions = args.instructions;
		}
		if (args.files !== undefined) {
			patch.files = args.files;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch('projects', args.id, patch as unknown as Partial<Doc<'projects'>>);
		}
		return null;
	}
});

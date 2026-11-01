import { env } from '$env/dynamic/private';
import { error, isHttpError, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireCapabilityAccess } from '$lib/server/access';
import {
	gitCommit,
	gitDiff,
	gitLog,
	gitRoots,
	gitStage,
	gitStatus,
	gitWorktreeAdd,
	gitWorktreeList,
	gitWorktreeRemove
} from '$lib/server/git';
import { logEvent } from '$lib/server/log';
import {
	defaultPolicy,
	decisionFor,
	isAllowed,
	parsePolicy,
	type PolicyDecision,
	type PolicyVerb
} from '$lib/server/policy';
import type { RequestHandler } from './$types';

const diffSchema = z
	.object({
		action: z.literal('diff'),
		root: z.string().optional(),
		staged: z.boolean().optional(),
		path: z.string().min(1).optional()
	})
	.strict();

const stageSchema = z
	.object({
		action: z.literal('stage'),
		root: z.string().optional(),
		paths: z.array(z.string().min(1)).min(1).max(50)
	})
	.strict();

const commitSchema = z
	.object({
		action: z.literal('commit'),
		root: z.string().optional(),
		message: z
			.string()
			.min(1)
			.max(2000)
			.refine((val) => val.trim().length > 0, {
				message: 'Commit message must not be blank'
			})
	})
	.strict();

const worktreeListSchema = z
	.object({
		action: z.literal('worktree-list'),
		root: z.string().optional()
	})
	.strict();

const worktreeAddSchema = z
	.object({
		action: z.literal('worktree-add'),
		root: z.string().optional(),
		path: z.string().min(1),
		branch: z.string().min(1)
	})
	.strict();

const worktreeRemoveSchema = z
	.object({
		action: z.literal('worktree-remove'),
		root: z.string().optional(),
		path: z.string().min(1)
	})
	.strict();

const actionSchema = z.discriminatedUnion('action', [
	diffSchema,
	stageSchema,
	commitSchema,
	worktreeListSchema,
	worktreeAddSchema,
	worktreeRemoveSchema
]);

type GitActionPayload = z.infer<typeof actionSchema>;

const ACTION_VERBS: Record<GitActionPayload['action'], PolicyVerb> = {
	diff: 'git_diff',
	stage: 'git_stage',
	commit: 'git_commit',
	'worktree-list': 'git_worktree',
	'worktree-add': 'git_worktree',
	'worktree-remove': 'git_worktree'
};

export const GET: RequestHandler = async (event) => {
	if (env.GIT_SURFACE_ENABLED !== 'true') error(404, 'Git surface is disabled.');
	await requireCapabilityAccess(event);
	const roots = gitRoots(env as { GIT_SURFACE_ROOTS?: string });
	if (roots.length === 0) error(503, 'No repository root is configured.');

	const rootParam = event.url.searchParams.get('root');
	let root = roots[0];
	if (rootParam !== null) {
		const matched = roots.find((r) => r.name === rootParam);
		if (!matched) error(400, 'Unknown repository.');
		root = matched;
	}

	try {
		const [status, commits] = await Promise.all([gitStatus(root), gitLog(root)]);
		await logEvent('info', 'git', {
			root: root.name,
			files: status.files.length,
			commits: commits.length,
			outcome: 'ok'
		});
		return json(
			{
				root: { name: root.name },
				status,
				commits
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch {
		await logEvent('warn', 'git', { root: root.name, outcome: 'error' });
		error(502, 'Repository could not be read.');
	}
};

export const POST: RequestHandler = async (event) => {
	if (env.GIT_SURFACE_ENABLED !== 'true') error(404, 'Git surface is disabled.');
	await requireCapabilityAccess(event);
	const roots = gitRoots(env as { GIT_SURFACE_ROOTS?: string });
	if (roots.length === 0) error(503, 'No repository root is configured.');

	let rawBody: unknown;
	try {
		rawBody = await event.request.json();
	} catch {
		error(400, 'Invalid request body.');
	}

	const parseResult = actionSchema.safeParse(rawBody);
	if (!parseResult.success) {
		error(400, 'Invalid request payload.');
	}
	const payload = parseResult.data;

	const rootParam = payload.root ?? event.url.searchParams.get('root');
	let root = roots[0];
	if (rootParam !== null && rootParam !== undefined) {
		const matched = roots.find((r) => r.name === rootParam);
		if (!matched) error(400, 'Unknown repository.');
		root = matched;
	}

	const verb = ACTION_VERBS[payload.action];
	let policy: Record<PolicyVerb, PolicyDecision>;
	try {
		policy = parsePolicy(JSON.parse(env.GIT_POLICY_JSON ?? '{}'));
	} catch {
		policy = defaultPolicy();
	}

	const decision = decisionFor(policy, verb);
	if (!isAllowed(policy, verb)) {
		await logEvent('warn', 'git', {
			action: payload.action,
			root: root.name,
			verb,
			decision,
			outcome: 'denied'
		});
		error(403, `Action '${verb}' is denied by policy. Writes are denied by default.`);
	}

	let responseData: Record<string, unknown>;
	const isRead = payload.action === 'diff' || payload.action === 'worktree-list';

	try {
		switch (payload.action) {
			case 'diff': {
				const diff = await gitDiff(root, {
					staged: payload.staged,
					path: payload.path
				});
				responseData = { root: { name: root.name }, diff };
				break;
			}
			case 'stage': {
				await gitStage(root, payload.paths);
				responseData = { root: { name: root.name }, staged: payload.paths.length };
				break;
			}
			case 'commit': {
				const { hash } = await gitCommit(root, payload.message);
				responseData = { root: { name: root.name }, hash };
				break;
			}
			case 'worktree-list': {
				const worktrees = await gitWorktreeList(root);
				responseData = { root: { name: root.name }, worktrees };
				break;
			}
			case 'worktree-add': {
				await gitWorktreeAdd(root, payload.path, payload.branch);
				responseData = { root: { name: root.name }, ok: true };
				break;
			}
			case 'worktree-remove': {
				await gitWorktreeRemove(root, payload.path);
				responseData = { root: { name: root.name }, ok: true };
				break;
			}
		}

		await logEvent('info', 'git', {
			action: payload.action,
			root: root.name,
			verb,
			decision,
			outcome: 'ok'
		});
		return json(responseData, { headers: { 'Cache-Control': 'no-store' } });
	} catch (err) {
		if (isHttpError(err)) throw err;
		await logEvent('warn', 'git', {
			action: payload.action,
			root: root.name,
			verb,
			decision,
			outcome: 'error'
		});
		error(502, isRead ? 'Repository could not be read.' : 'Repository could not be written.');
	}
};

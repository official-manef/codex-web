import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { requireCapabilityAccess } from '$lib/server/access';
import { gitLog, gitRoots, gitStatus } from '$lib/server/git';
import { logEvent } from '$lib/server/log';
import type { RequestHandler } from './$types';

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

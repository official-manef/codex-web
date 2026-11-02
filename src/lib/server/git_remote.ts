// Read-only remote inspection. No forge credential exists in this app, and
// therefore no PR review — webUrl is the honest ceiling: opens, never acts.

import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import type { GitRoot, Runner } from './git';

export type RemoteInfo =
	| { provider: 'github'; owner: string; repo: string; url: string }
	| { provider: 'unknown'; reason: string };

const IDENT_RE = /^[A-Za-z0-9._-]{1,100}$/;

function assertValidRoot(root: GitRoot): void {
	if (
		!root ||
		typeof root !== 'object' ||
		typeof root.name !== 'string' ||
		typeof root.path !== 'string' ||
		!isAbsolute(root.path) ||
		root.path.split(/[/\\]/).includes('..')
	) {
		throw new Error('Invalid git root');
	}
}

function defaultRunner(root: GitRoot): Runner {
	return (args: string[]) =>
		new Promise<{ code: number; stdout: string }>((resolve) => {
			const gitArgs = args.includes('--no-optional-locks')
				? ['--no-optional-locks', ...args.filter((a) => a !== '--no-optional-locks')]
				: args;
			execFile(
				'git',
				gitArgs,
				{
					cwd: root.path,
					timeout: 5000,
					maxBuffer: 1_000_000,
					env: {
						PATH: process.env.PATH ?? '/usr/bin:/bin',
						LC_ALL: 'C'
					}
				},
				(err, stdout) => {
					if (err) {
						const code = typeof err.code === 'number' ? err.code : 1;
						resolve({ code, stdout: stdout ?? '' });
					} else {
						resolve({ code: 0, stdout: stdout ?? '' });
					}
				}
			);
		});
}

export function parseRemote(url: string): RemoteInfo {
	if (typeof url !== 'string' || !url.trim()) {
		return { provider: 'unknown', reason: 'Malformed path' };
	}
	const trimmed = url.trim();

	if (
		/https?:\/\/[^/]*@/i.test(trimmed) ||
		/\/\/[^/@]+:[^/@]+@/.test(trimmed) ||
		/^[^/:]+:[^/@]+@/.test(trimmed) ||
		(trimmed.includes('@') && !trimmed.startsWith('git@') && !trimmed.includes('://'))
	) {
		return { provider: 'unknown', reason: 'URL contains credentials' };
	}

	let host: string;
	let rawPath: string;

	if (trimmed.startsWith('git@')) {
		const match = trimmed.match(/^git@([^:]+):(.*)$/);
		if (!match) {
			return { provider: 'unknown', reason: 'Malformed path' };
		}
		host = match[1];
		rawPath = match[2];
	} else if (trimmed.includes('://')) {
		let parsed: URL;
		try {
			parsed = new URL(trimmed);
		} catch {
			return { provider: 'unknown', reason: 'Malformed path' };
		}

		if (parsed.search || parsed.hash) {
			return { provider: 'unknown', reason: 'Malformed path' };
		}

		if (parsed.protocol === 'https:') {
			if (parsed.username || parsed.password) {
				return { provider: 'unknown', reason: 'URL contains credentials' };
			}
			host = parsed.hostname;
			rawPath = parsed.pathname;
		} else if (parsed.protocol === 'ssh:') {
			if (parsed.password || (parsed.username && parsed.username !== 'git')) {
				return { provider: 'unknown', reason: 'URL contains credentials' };
			}
			if (parsed.username !== 'git') {
				return { provider: 'unknown', reason: 'Malformed path' };
			}
			host = parsed.hostname;
			rawPath = parsed.pathname;
		} else {
			if (parsed.hostname.toLowerCase() !== 'github.com') {
				return { provider: 'unknown', reason: 'Non-GitHub host' };
			}
			return { provider: 'unknown', reason: 'Malformed path' };
		}
	} else {
		return { provider: 'unknown', reason: 'Malformed path' };
	}

	if (host.toLowerCase() !== 'github.com') {
		return { provider: 'unknown', reason: 'Non-GitHub host' };
	}

	let cleanPath = rawPath.replace(/^\/+/, '').replace(/\/+$/, '');
	if (cleanPath.endsWith('.git')) {
		cleanPath = cleanPath.slice(0, -4).replace(/\/+$/, '');
	}

	const parts = cleanPath.split('/');
	if (parts.length !== 2) {
		return { provider: 'unknown', reason: 'Malformed path' };
	}

	const [owner, repo] = parts;
	if (
		!IDENT_RE.test(owner) ||
		!IDENT_RE.test(repo) ||
		owner === '.' ||
		owner === '..' ||
		repo === '.' ||
		repo === '..'
	) {
		return { provider: 'unknown', reason: 'Malformed path' };
	}

	return {
		provider: 'github',
		owner,
		repo,
		url: trimmed
	};
}

export function cloneUrl(remote: RemoteInfo): string | null {
	if (remote.provider !== 'github') return null;
	return `git@github.com:${remote.owner}/${remote.repo}.git`;
}

export function webUrl(remote: RemoteInfo): string | null {
	if (remote.provider !== 'github') return null;
	return `https://github.com/${remote.owner}/${remote.repo}`;
}

export async function gitRemote(root: GitRoot, run?: Runner): Promise<RemoteInfo> {
	assertValidRoot(root);
	const runner = run ?? defaultRunner(root);
	let res: { code: number; stdout: string };
	try {
		res = await runner(['remote', 'get-url', 'origin']);
	} catch {
		return { provider: 'unknown', reason: 'This repository has no origin remote.' };
	}
	if (res.code !== 0) {
		return { provider: 'unknown', reason: 'This repository has no origin remote.' };
	}
	const output = res.stdout.trim();
	if (!output) {
		return { provider: 'unknown', reason: 'This repository has no origin remote.' };
	}
	return parseRemote(output);
}

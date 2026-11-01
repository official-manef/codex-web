/**
 * Bounded read-only git inspection for allowlisted roots.
 *
 * Exposes repository status and recent commit history without giving the browser
 * shell access or arbitrary command execution. Only specific read-only subcommands
 * and arguments are permitted, and roots are strictly restricted to absolute allowlisted paths.
 */

import { execFile } from 'node:child_process';
import { basename, isAbsolute } from 'node:path';

export type GitRoot = { name: string; path: string };
export type GitStatus = {
	branch: string;
	files: { path: string; code: string }[];
	truncated: boolean;
};
export type GitCommit = { hash: string; date: string; subject: string };
export type Runner = (args: string[]) => Promise<{ code: number; stdout: string }>;

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

export function gitRoots(env: { GIT_SURFACE_ROOTS?: string }): GitRoot[] {
	const raw = env.GIT_SURFACE_ROOTS;
	if (!raw || typeof raw !== 'string') return [];
	const parts = raw
		.split(':')
		.map((p) => p.trim())
		.filter(Boolean);
	const seen = new Set<string>();
	const roots: GitRoot[] = [];
	for (const p of parts) {
		const normalized = p.length > 1 ? p.replace(/[/\\]+$/, '') : p;
		if (!isAbsolute(normalized)) continue;
		const segments = normalized.split(/[/\\]/);
		if (segments.includes('..')) continue;
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		roots.push({ name: basename(normalized) || normalized, path: normalized });
		if (roots.length === 8) break;
	}
	return roots;
}

function parseBranch(header: string): string {
	if (!header.startsWith('##')) return '';
	const content = header.slice(2).trim();
	if (content.startsWith('HEAD (no branch)') || content === '(no branch)' || content === 'HEAD') {
		return 'HEAD';
	}
	const noCommitsPrefix = 'No commits yet on ';
	const initialCommitPrefix = 'Initial commit on ';
	let raw = content;
	if (raw.startsWith(noCommitsPrefix)) {
		raw = raw.slice(noCommitsPrefix.length).trim();
	} else if (raw.startsWith(initialCommitPrefix)) {
		raw = raw.slice(initialCommitPrefix.length).trim();
	}
	raw = raw.replace(/\s*\[.*\]$/, '');
	const upstreamIndex = raw.indexOf('...');
	if (upstreamIndex !== -1) {
		raw = raw.slice(0, upstreamIndex);
	}
	return raw.trim();
}

export async function gitStatus(root: GitRoot, run?: Runner): Promise<GitStatus> {
	assertValidRoot(root);
	const runner = run ?? defaultRunner(root);
	const args = ['status', '--porcelain=v1', '-b', '--no-optional-locks'];
	let res: { code: number; stdout: string };
	try {
		res = await runner(args);
	} catch {
		throw new Error('git status failed');
	}
	if (res.code !== 0) {
		throw new Error('git status failed');
	}

	const lines = res.stdout.split('\n');
	let branch = '';
	const fileLines: string[] = [];

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line) continue;
		if (line.startsWith('##')) {
			branch = parseBranch(line);
		} else {
			fileLines.push(line);
		}
	}

	const truncated = fileLines.length > 500;
	const selectedLines = truncated ? fileLines.slice(0, 500) : fileLines;
	const files = selectedLines.map((line) => {
		const code = line.slice(0, 2).trim();
		const path = line.length > 3 ? line.slice(3).trim() : '';
		return { code, path };
	});

	return { branch, files, truncated };
}

export async function gitLog(root: GitRoot, run?: Runner): Promise<GitCommit[]> {
	assertValidRoot(root);
	const runner = run ?? defaultRunner(root);
	const args = ['log', '-n', '20', '--date=short', '--pretty=format:%h%x09%ad%x09%s'];
	let res: { code: number; stdout: string };
	try {
		res = await runner(args);
	} catch {
		throw new Error('git log failed');
	}
	if (res.code !== 0) {
		throw new Error('git log failed');
	}

	const lines = res.stdout.split('\n');
	const commits: GitCommit[] = [];
	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line) continue;
		const parts = line.split('\t');
		if (parts.length >= 3) {
			const [hash, date, ...rest] = parts;
			commits.push({
				hash: hash.trim(),
				date: date.trim(),
				subject: rest.join('\t')
			});
		} else if (parts.length === 2) {
			commits.push({
				hash: parts[0].trim(),
				date: parts[1].trim(),
				subject: ''
			});
		}
		if (commits.length === 20) break;
	}
	return commits;
}

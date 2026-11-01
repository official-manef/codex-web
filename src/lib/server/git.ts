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

function safePath(value: unknown, allowAbsolute = false): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 500 ||
		value.includes('\0') ||
		value.startsWith('-') ||
		value.split(/[/\\]/).includes('..')
	) {
		throw new Error('Invalid path');
	}
	if (allowAbsolute) {
		if (!isAbsolute(value)) {
			throw new Error('Invalid path');
		}
	} else if (isAbsolute(value)) {
		throw new Error('Invalid path');
	}
	return value;
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

export async function gitDiff(
	root: GitRoot,
	opts: { staged?: boolean; path?: string } = {},
	run?: Runner
): Promise<string> {
	assertValidRoot(root);
	if (!opts || typeof opts !== 'object') {
		throw new Error('Invalid options');
	}
	if (opts.path !== undefined) {
		safePath(opts.path);
	}
	const runner = run ?? defaultRunner(root);
	const args = [
		'diff',
		'--no-color',
		'--no-ext-diff',
		...(opts.staged ? ['--staged'] : []),
		...(opts.path ? ['--', opts.path] : [])
	];
	let res: { code: number; stdout: string };
	try {
		res = await runner(args);
	} catch {
		throw new Error('git diff failed');
	}
	if (res.code !== 0) {
		throw new Error('git diff failed');
	}

	if (res.stdout.length > 40_000) {
		return res.stdout.slice(0, 40_000) + '\n[diff truncated]\n';
	}
	return res.stdout;
}

export async function gitStage(root: GitRoot, paths: string[], run?: Runner): Promise<void> {
	assertValidRoot(root);
	if (!Array.isArray(paths) || paths.length < 1 || paths.length > 50) {
		throw new Error('Invalid paths');
	}
	for (const p of paths) {
		safePath(p);
		if (p.startsWith(':')) {
			throw new Error('Invalid path');
		}
	}
	const runner = run ?? defaultRunner(root);
	const args = ['add', '--', ...paths];
	let res: { code: number; stdout: string };
	try {
		res = await runner(args);
	} catch {
		throw new Error('git stage failed');
	}
	if (res.code !== 0) {
		throw new Error('git stage failed');
	}
}

export async function gitCommit(
	root: GitRoot,
	message: string,
	run?: Runner
): Promise<{ hash: string }> {
	assertValidRoot(root);
	if (typeof message !== 'string') {
		throw new Error('Invalid commit message');
	}
	const trimmed = message.trim();
	if (trimmed.length === 0 || trimmed.length > 2000) {
		throw new Error('Invalid commit message');
	}
	if (message.startsWith('-') || trimmed.startsWith('-')) {
		throw new Error('Invalid commit message');
	}

	const runner = run ?? defaultRunner(root);
	let commitRes: { code: number; stdout: string };
	try {
		commitRes = await runner(['commit', '-m', message]);
	} catch {
		throw new Error('git commit failed');
	}
	if (commitRes.code !== 0) {
		throw new Error('git commit failed');
	}

	let revRes: { code: number; stdout: string };
	try {
		revRes = await runner(['rev-parse', '--short', 'HEAD']);
	} catch {
		throw new Error('git commit failed');
	}
	if (revRes.code !== 0) {
		throw new Error('git commit failed');
	}

	const hash = revRes.stdout.trim();
	if (!hash) {
		throw new Error('git commit failed');
	}
	return { hash };
}

export async function gitWorktreeList(
	root: GitRoot,
	run?: Runner
): Promise<{ path: string; branch: string }[]> {
	assertValidRoot(root);
	const runner = run ?? defaultRunner(root);
	let res: { code: number; stdout: string };
	try {
		res = await runner(['worktree', 'list', '--porcelain']);
	} catch {
		throw new Error('git worktree list failed');
	}
	if (res.code !== 0) {
		throw new Error('git worktree list failed');
	}

	const lines = res.stdout.split('\n');
	const worktrees: { path: string; branch: string }[] = [];
	let currentPath = '';
	let currentBranch = '';

	const flush = () => {
		if (currentPath) {
			worktrees.push({
				path: currentPath,
				branch: currentBranch || '(detached)'
			});
			currentPath = '';
			currentBranch = '';
		}
	};

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			flush();
			continue;
		}
		if (line.startsWith('worktree ')) {
			flush();
			currentPath = line.slice('worktree '.length).trim();
		} else if (line.startsWith('branch ')) {
			const ref = line.slice('branch '.length).trim();
			currentBranch = ref.replace(/^refs\/heads\//, '');
		} else if (line === 'detached') {
			currentBranch = '(detached)';
		}
	}
	flush();

	return worktrees;
}

export async function gitWorktreeAdd(
	root: GitRoot,
	path: string,
	branch: string,
	run?: Runner
): Promise<void> {
	assertValidRoot(root);
	safePath(path, true);
	if (path === root.path) {
		throw new Error('Invalid worktree path');
	}
	if (
		typeof branch !== 'string' ||
		!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) ||
		branch.includes('..') ||
		branch.startsWith('-')
	) {
		throw new Error('Invalid branch');
	}

	const runner = run ?? defaultRunner(root);
	let res: { code: number; stdout: string };
	try {
		res = await runner(['worktree', 'add', path, branch]);
	} catch {
		throw new Error('git worktree add failed');
	}
	if (res.code !== 0) {
		throw new Error('git worktree add failed');
	}
}

export async function gitWorktreeRemove(root: GitRoot, path: string, run?: Runner): Promise<void> {
	assertValidRoot(root);
	if (
		typeof path !== 'string' ||
		path.length === 0 ||
		path.length > 500 ||
		path.includes('\0') ||
		path.startsWith('-') ||
		path.split(/[/\\]/).includes('..') ||
		path === root.path
	) {
		throw new Error('Invalid worktree path');
	}

	const runner = run ?? defaultRunner(root);
	let res: { code: number; stdout: string };
	try {
		res = await runner(['worktree', 'remove', path]);
	} catch {
		throw new Error('git worktree remove failed');
	}
	if (res.code !== 0) {
		throw new Error('git worktree remove failed');
	}
}

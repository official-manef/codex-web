import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { gitLog, gitRoots, gitStatus, type GitRoot, type Runner } from './git';

describe('gitRoots', () => {
	test('parses valid colon-separated absolute paths', () => {
		const env = { GIT_SURFACE_ROOTS: '/home/rahman/repo1:/var/repos/project-2' };
		const roots = gitRoots(env);
		expect(roots).toEqual([
			{ name: 'repo1', path: '/home/rahman/repo1' },
			{ name: 'project-2', path: '/var/repos/project-2' }
		]);
	});

	test('rejects relative paths', () => {
		const env = { GIT_SURFACE_ROOTS: 'relative/path:/var/repo:another/relative' };
		const roots = gitRoots(env);
		expect(roots).toEqual([{ name: 'repo', path: '/var/repo' }]);
	});

	test('rejects paths containing .. segments', () => {
		const env = { GIT_SURFACE_ROOTS: '/home/../secret:/var/repos/../evil:/safe/repo' };
		const roots = gitRoots(env);
		expect(roots).toEqual([{ name: 'repo', path: '/safe/repo' }]);
	});

	test('returns empty array on empty or unset env', () => {
		expect(gitRoots({})).toEqual([]);
		expect(gitRoots({ GIT_SURFACE_ROOTS: '' })).toEqual([]);
		expect(gitRoots({ GIT_SURFACE_ROOTS: '   ' })).toEqual([]);
		expect(gitRoots({ GIT_SURFACE_ROOTS: ':::' })).toEqual([]);
	});

	test('caps parsed roots at 8', () => {
		const paths = Array.from({ length: 12 }, (_, i) => `/var/repo-${i}`);
		const roots = gitRoots({ GIT_SURFACE_ROOTS: paths.join(':') });
		expect(roots).toHaveLength(8);
		expect(roots[7]).toEqual({ name: 'repo-7', path: '/var/repo-7' });
	});

	test('deduplicates identical paths', () => {
		const env = { GIT_SURFACE_ROOTS: '/repo1:/repo2:/repo1:/repo2:/repo3' };
		const roots = gitRoots(env);
		expect(roots).toEqual([
			{ name: 'repo1', path: '/repo1' },
			{ name: 'repo2', path: '/repo2' },
			{ name: 'repo3', path: '/repo3' }
		]);
	});
});

describe('gitStatus', () => {
	const validRoot: GitRoot = { name: 'my-repo', path: '/home/user/my-repo' };

	test('passes exact arguments to runner', async () => {
		let receivedArgs: string[] = [];
		const runner: Runner = async (args) => {
			receivedArgs = args;
			return { code: 0, stdout: '## main\n' };
		};
		await gitStatus(validRoot, runner);
		expect(receivedArgs).toEqual(['status', '--porcelain=v1', '-b', '--no-optional-locks']);
	});

	test('parses tracking branch with ahead suffix', async () => {
		const runner: Runner = async () => ({
			code: 0,
			stdout: '## main...origin/main [ahead 2]\n'
		});
		const status = await gitStatus(validRoot, runner);
		expect(status.branch).toBe('main');
		expect(status.files).toEqual([]);
		expect(status.truncated).toBe(false);
	});

	test('parses detached HEAD', async () => {
		const runner: Runner = async () => ({
			code: 0,
			stdout: '## HEAD (no branch)\n'
		});
		const status = await gitStatus(validRoot, runner);
		expect(status.branch).toBe('HEAD');
	});

	test('parses repository with no commits yet', async () => {
		const runner: Runner = async () => ({
			code: 0,
			stdout: '## No commits yet on main\n'
		});
		const status = await gitStatus(validRoot, runner);
		expect(status.branch).toBe('main');
	});

	test('parses modified, added, untracked, deleted, and renamed porcelain codes', async () => {
		const stdout = [
			'## feature-1...origin/feature-1 [ahead 1, behind 2]',
			' M modified_worktree.ts',
			'M  modified_index.ts',
			'A  added.ts',
			'?? untracked.ts',
			' D deleted_worktree.ts',
			'D  deleted_index.ts',
			'R  old.ts -> new.ts',
			'R  old -> new'
		].join('\n');

		const runner: Runner = async () => ({ code: 0, stdout });
		const status = await gitStatus(validRoot, runner);

		expect(status.branch).toBe('feature-1');
		expect(status.truncated).toBe(false);
		expect(status.files).toEqual([
			{ code: 'M', path: 'modified_worktree.ts' },
			{ code: 'M', path: 'modified_index.ts' },
			{ code: 'A', path: 'added.ts' },
			{ code: '??', path: 'untracked.ts' },
			{ code: 'D', path: 'deleted_worktree.ts' },
			{ code: 'D', path: 'deleted_index.ts' },
			{ code: 'R', path: 'old.ts -> new.ts' },
			{ code: 'R', path: 'old -> new' }
		]);
	});

	test('handles empty stdout without error', async () => {
		const runner: Runner = async () => ({ code: 0, stdout: '' });
		const status = await gitStatus(validRoot, runner);
		expect(status).toEqual({ branch: '', files: [], truncated: false });
	});

	test('caps files at 500 and sets truncated flag', async () => {
		const lines = ['## main'];
		for (let i = 0; i < 505; i++) {
			lines.push(` M file_${i}.ts`);
		}
		const runner: Runner = async () => ({ code: 0, stdout: lines.join('\n') });
		const status = await gitStatus(validRoot, runner);

		expect(status.truncated).toBe(true);
		expect(status.files).toHaveLength(500);
		expect(status.files[0]).toEqual({ code: 'M', path: 'file_0.ts' });
		expect(status.files[499]).toEqual({ code: 'M', path: 'file_499.ts' });
	});

	test('throws on non-zero exit without leaking command line or paths', async () => {
		const runner: Runner = async () => ({ code: 128, stdout: 'fatal: not a git repo' });
		await expect(gitStatus(validRoot, runner)).rejects.toThrow('git status failed');
	});

	test('throws on rejected runner without leaking errors', async () => {
		const runner: Runner = async () => {
			throw new Error('execFile: /bin/git status failed in /secret/path');
		};
		await expect(gitStatus(validRoot, runner)).rejects.toThrow('git status failed');
	});

	test('throws on non-absolute root path', async () => {
		const invalidRoot: GitRoot = { name: 'relative', path: 'relative/path' };
		await expect(gitStatus(invalidRoot)).rejects.toThrow('Invalid git root');
	});

	test('throws on root path containing .. segment', async () => {
		const invalidRoot: GitRoot = { name: 'escape', path: '/home/user/../../etc' };
		await expect(gitStatus(invalidRoot)).rejects.toThrow('Invalid git root');
	});
});

describe('gitLog', () => {
	const validRoot: GitRoot = { name: 'my-repo', path: '/home/user/my-repo' };

	test('passes exact arguments to runner', async () => {
		let receivedArgs: string[] = [];
		const runner: Runner = async (args) => {
			receivedArgs = args;
			return { code: 0, stdout: '7f1c007\t2026-10-31\tinitial commit\n' };
		};
		await gitLog(validRoot, runner);
		expect(receivedArgs).toEqual([
			'log',
			'-n',
			'20',
			'--date=short',
			'--pretty=format:%h%x09%ad%x09%s'
		]);
	});

	test('parses log entries into hash, date, and subject including subjects with spaces', async () => {
		const stdout = [
			'7f1c007\t2026-10-31\tfeat: bounded read-only git surface',
			'ae28043\t2026-10-30\tdocs: update progress.md with evidence',
			'cc33ef0\t2026-10-29\tfix: handle tabs\tsafely in commit subject'
		].join('\n');

		const runner: Runner = async () => ({ code: 0, stdout });
		const commits = await gitLog(validRoot, runner);

		expect(commits).toEqual([
			{
				hash: '7f1c007',
				date: '2026-10-31',
				subject: 'feat: bounded read-only git surface'
			},
			{
				hash: 'ae28043',
				date: '2026-10-30',
				subject: 'docs: update progress.md with evidence'
			},
			{
				hash: 'cc33ef0',
				date: '2026-10-29',
				subject: 'fix: handle tabs\tsafely in commit subject'
			}
		]);
	});

	test('caps log commits at 20', async () => {
		const lines = Array.from(
			{ length: 25 },
			(_, i) => `hash${i}\t2026-10-${String(i + 1).padStart(2, '0')}\tcommit ${i}`
		);
		const runner: Runner = async () => ({ code: 0, stdout: lines.join('\n') });
		const commits = await gitLog(validRoot, runner);

		expect(commits).toHaveLength(20);
		expect(commits[0].hash).toBe('hash0');
		expect(commits[19].hash).toBe('hash19');
	});

	test('handles empty stdout without error', async () => {
		const runner: Runner = async () => ({ code: 0, stdout: '' });
		const commits = await gitLog(validRoot, runner);
		expect(commits).toEqual([]);
	});

	test('throws on non-zero exit without leaking command line or paths', async () => {
		const runner: Runner = async () => ({ code: 1, stdout: 'error' });
		await expect(gitLog(validRoot, runner)).rejects.toThrow('git log failed');
	});

	test('throws on rejected runner without leaking error details', async () => {
		const runner: Runner = async () => {
			throw new Error('/usr/bin/git log --porcelain failed in /var/repos');
		};
		await expect(gitLog(validRoot, runner)).rejects.toThrow('git log failed');
	});

	test('throws on non-absolute root path', async () => {
		const invalidRoot: GitRoot = { name: 'rel', path: 'relative/dir' };
		await expect(gitLog(invalidRoot)).rejects.toThrow('Invalid git root');
	});

	test('throws on root path containing .. segment', async () => {
		const invalidRoot: GitRoot = { name: 'dotdot', path: '/home/../secret' };
		await expect(gitLog(invalidRoot)).rejects.toThrow('Invalid git root');
	});
});

describe('real git smoke test', () => {
	const hasGit = existsSync('/usr/bin/git');

	test.skipIf(!hasGit)('runs default runner against real repository', async () => {
		const root: GitRoot = { name: 'codex', path: process.cwd() };
		const status = await gitStatus(root);
		expect(typeof status.branch).toBe('string');
		expect(Array.isArray(status.files)).toBe(true);

		const commits = await gitLog(root);
		expect(Array.isArray(commits)).toBe(true);
		expect(commits.length).toBeGreaterThan(0);
		expect(commits[0]).toHaveProperty('hash');
		expect(commits[0]).toHaveProperty('date');
		expect(commits[0]).toHaveProperty('subject');
	});
});

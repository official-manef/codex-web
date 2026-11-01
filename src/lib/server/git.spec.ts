import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
	gitCommit,
	gitDiff,
	gitLog,
	gitRoots,
	gitStage,
	gitStatus,
	gitWorktreeAdd,
	gitWorktreeList,
	gitWorktreeRemove,
	type GitRoot,
	type Runner
} from './git';

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

describe('gitDiff', () => {
	const validRoot: GitRoot = { name: 'my-repo', path: '/home/user/my-repo' };

	test('passes unstaged arguments when staged is omitted or false', async () => {
		let receivedArgs: string[] = [];
		const runner: Runner = async (args) => {
			receivedArgs = args;
			return { code: 0, stdout: 'diff --git a/file b/file\n' };
		};
		const out = await gitDiff(validRoot, {}, runner);
		expect(receivedArgs).toEqual(['diff', '--no-color', '--no-ext-diff']);
		expect(out).toBe('diff --git a/file b/file\n');
	});

	test('passes staged argument when staged is true', async () => {
		let receivedArgs: string[] = [];
		const runner: Runner = async (args) => {
			receivedArgs = args;
			return { code: 0, stdout: '' };
		};
		await gitDiff(validRoot, { staged: true }, runner);
		expect(receivedArgs).toEqual(['diff', '--no-color', '--no-ext-diff', '--staged']);
	});

	test('passes path argument with separator', async () => {
		let receivedArgs: string[] = [];
		const runner: Runner = async (args) => {
			receivedArgs = args;
			return { code: 0, stdout: '' };
		};
		await gitDiff(validRoot, { staged: true, path: 'src/lib/server/git.ts' }, runner);
		expect(receivedArgs).toEqual([
			'diff',
			'--no-color',
			'--no-ext-diff',
			'--staged',
			'--',
			'src/lib/server/git.ts'
		]);
	});

	test('refuses path traversal with .. segment', async () => {
		await expect(gitDiff(validRoot, { path: '../secret.ts' })).rejects.toThrow('Invalid path');
		await expect(gitDiff(validRoot, { path: 'foo/../../bar' })).rejects.toThrow('Invalid path');
	});

	test('refuses absolute path', async () => {
		await expect(gitDiff(validRoot, { path: '/etc/passwd' })).rejects.toThrow('Invalid path');
	});

	test('refuses path starting with - or containing NUL', async () => {
		await expect(gitDiff(validRoot, { path: '--staged' })).rejects.toThrow('Invalid path');
		await expect(gitDiff(validRoot, { path: 'file\0.ts' })).rejects.toThrow('Invalid path');
	});

	test('truncates output at 40 000 chars and appends marker', async () => {
		const longDiff = 'a'.repeat(40050);
		const runner: Runner = async () => ({ code: 0, stdout: longDiff });
		const out = await gitDiff(validRoot, {}, runner);
		expect(out).toHaveLength(40_000 + '\n[diff truncated]\n'.length);
		expect(out.endsWith('\n[diff truncated]\n')).toBe(true);
		expect(out.slice(0, 40_000)).toBe('a'.repeat(40_000));
	});

	test('leaves diff output <= 40 000 chars untruncated', async () => {
		const exactDiff = 'b'.repeat(40_000);
		const runner: Runner = async () => ({ code: 0, stdout: exactDiff });
		const out = await gitDiff(validRoot, {}, runner);
		expect(out).toBe(exactDiff);
	});

	test('throws on non-zero exit without leaking command line or paths', async () => {
		const runner: Runner = async () => ({
			code: 1,
			stdout: 'fatal: ambiguous argument in /home/user/my-repo'
		});
		await expect(gitDiff(validRoot, {}, runner)).rejects.toThrow('git diff failed');
	});

	test('throws on rejected runner without leaking errors', async () => {
		const runner: Runner = async () => {
			throw new Error('/usr/bin/git diff failed in /secret/path');
		};
		await expect(gitDiff(validRoot, {}, runner)).rejects.toThrow('git diff failed');
	});

	test('throws on invalid git root', async () => {
		const invalidRoot: GitRoot = { name: 'bad', path: 'relative/dir' };
		await expect(gitDiff(invalidRoot, {})).rejects.toThrow('Invalid git root');
	});
});

describe('gitStage', () => {
	const validRoot: GitRoot = { name: 'my-repo', path: '/home/user/my-repo' };

	test('sends ONE call for 3 paths', async () => {
		let callCount = 0;
		let receivedArgs: string[] = [];
		const runner: Runner = async (args) => {
			callCount++;
			receivedArgs = args;
			return { code: 0, stdout: '' };
		};
		await gitStage(validRoot, ['file1.ts', 'src/file2.ts', 'dir/file3.ts'], runner);
		expect(callCount).toBe(1);
		expect(receivedArgs).toEqual(['add', '--', 'file1.ts', 'src/file2.ts', 'dir/file3.ts']);
	});

	test('rejects a :pathspec prefix', async () => {
		await expect(gitStage(validRoot, [':(top)file.ts'])).rejects.toThrow('Invalid path');
		await expect(gitStage(validRoot, [':/file.ts'])).rejects.toThrow('Invalid path');
	});

	test('rejects more than 50 paths', async () => {
		const paths = Array.from({ length: 51 }, (_, i) => `file_${i}.ts`);
		await expect(gitStage(validRoot, paths)).rejects.toThrow('Invalid paths');
	});

	test('rejects empty paths array', async () => {
		await expect(gitStage(validRoot, [])).rejects.toThrow('Invalid paths');
	});

	test('rejects an absolute path', async () => {
		await expect(gitStage(validRoot, ['/home/user/my-repo/file.ts'])).rejects.toThrow(
			'Invalid path'
		);
	});

	test('rejects path traversal', async () => {
		await expect(gitStage(validRoot, ['../outside.ts'])).rejects.toThrow('Invalid path');
	});

	test('rejects path with NUL byte or leading -', async () => {
		await expect(gitStage(validRoot, ['safe.ts', 'bad\0.ts'])).rejects.toThrow('Invalid path');
		await expect(gitStage(validRoot, ['-p'])).rejects.toThrow('Invalid path');
	});

	test('throws on non-zero exit without leaking command line or paths', async () => {
		const runner: Runner = async () => ({ code: 1, stdout: 'fatal: pathspec did not match' });
		await expect(gitStage(validRoot, ['file.ts'], runner)).rejects.toThrow('git stage failed');
	});

	test('throws on rejected runner without leaking error details', async () => {
		const runner: Runner = async () => {
			throw new Error('/usr/bin/git add failed in /secret/path');
		};
		await expect(gitStage(validRoot, ['file.ts'], runner)).rejects.toThrow('git stage failed');
	});
});

describe('gitCommit', () => {
	const validRoot: GitRoot = { name: 'my-repo', path: '/home/user/my-repo' };

	test('passes exact argv containing no --amend, -S, or -a and returns short hash', async () => {
		const receivedCalls: string[][] = [];
		const runner: Runner = async (args) => {
			receivedCalls.push(args);
			if (args[0] === 'commit') {
				return { code: 0, stdout: '[main 5f6e0ac] feat: commit message\n' };
			}
			if (args[0] === 'rev-parse') {
				return { code: 0, stdout: '5f6e0ac\n' };
			}
			return { code: 0, stdout: '' };
		};

		const res = await gitCommit(validRoot, 'feat: commit message', runner);
		expect(res).toEqual({ hash: '5f6e0ac' });
		expect(receivedCalls).toHaveLength(2);
		expect(receivedCalls[0]).toEqual(['commit', '-m', 'feat: commit message']);
		expect(receivedCalls[1]).toEqual(['rev-parse', '--short', 'HEAD']);

		const commitArgv = receivedCalls[0];
		expect(commitArgv).not.toContain('--amend');
		expect(commitArgv).not.toContain('-S');
		expect(commitArgv).not.toContain('-a');
		expect(commitArgv).not.toContain('--no-verify');
	});

	test('rejects a leading - in commit message', async () => {
		await expect(gitCommit(validRoot, '--amend')).rejects.toThrow('Invalid commit message');
		await expect(gitCommit(validRoot, '-m evil')).rejects.toThrow('Invalid commit message');
		await expect(gitCommit(validRoot, '  -S sign')).rejects.toThrow('Invalid commit message');
	});

	test('rejects a 2001-char message', async () => {
		const longMessage = 'a'.repeat(2001);
		await expect(gitCommit(validRoot, longMessage)).rejects.toThrow('Invalid commit message');
	});

	test('accepts a 2000-char message', async () => {
		const maxMessage = 'a'.repeat(2000);
		const runner: Runner = async (args) => {
			if (args[0] === 'rev-parse') return { code: 0, stdout: 'abcdef1\n' };
			return { code: 0, stdout: '' };
		};
		const res = await gitCommit(validRoot, maxMessage, runner);
		expect(res).toEqual({ hash: 'abcdef1' });
	});

	test('rejects empty or whitespace-only commit message', async () => {
		await expect(gitCommit(validRoot, '')).rejects.toThrow('Invalid commit message');
		await expect(gitCommit(validRoot, '   \n\t  ')).rejects.toThrow('Invalid commit message');
	});

	test('throws on commit failure without leaking details', async () => {
		const runner: Runner = async (args) => {
			if (args[0] === 'commit') {
				return { code: 1, stdout: 'error: nothing to commit' };
			}
			return { code: 0, stdout: '5f6e0ac\n' };
		};
		await expect(gitCommit(validRoot, 'feat: something', runner)).rejects.toThrow(
			'git commit failed'
		);
	});

	test('throws on rev-parse failure without leaking details', async () => {
		const runner: Runner = async (args) => {
			if (args[0] === 'rev-parse') {
				return { code: 1, stdout: 'fatal: ambiguous argument' };
			}
			return { code: 0, stdout: '' };
		};
		await expect(gitCommit(validRoot, 'feat: something', runner)).rejects.toThrow(
			'git commit failed'
		);
	});

	test('throws on rejected runner without leaking details', async () => {
		const runner: Runner = async () => {
			throw new Error('/usr/bin/git commit failed in /secret/path');
		};
		await expect(gitCommit(validRoot, 'feat: something', runner)).rejects.toThrow(
			'git commit failed'
		);
	});
});

describe('gitWorktreeList', () => {
	const validRoot: GitRoot = { name: 'my-repo', path: '/home/user/my-repo' };

	test('passes exact arguments to runner', async () => {
		let receivedArgs: string[] = [];
		const runner: Runner = async (args) => {
			receivedArgs = args;
			return { code: 0, stdout: '' };
		};
		await gitWorktreeList(validRoot, runner);
		expect(receivedArgs).toEqual(['worktree', 'list', '--porcelain']);
	});

	test('parses porcelain form including detached head and stripped refs/heads/', async () => {
		const stdout = [
			'worktree /home/user/my-repo',
			'HEAD 5f6e0ac9c9da1c3387096c7fc1539cac6b2abd0b',
			'branch refs/heads/main',
			'',
			'worktree /home/user/wt/feature-x',
			'HEAD 731a470f25eb0a6139edd3474eb6601eb94e5cd8',
			'branch refs/heads/feat/ac-e2e',
			'',
			'worktree /home/user/wt/detached-wt',
			'HEAD dff55b3edd590e89aa1597654c6580dcc9293d1f',
			'detached',
			''
		].join('\n');

		const runner: Runner = async () => ({ code: 0, stdout });
		const worktrees = await gitWorktreeList(validRoot, runner);

		expect(worktrees).toEqual([
			{ path: '/home/user/my-repo', branch: 'main' },
			{ path: '/home/user/wt/feature-x', branch: 'feat/ac-e2e' },
			{ path: '/home/user/wt/detached-wt', branch: '(detached)' }
		]);
	});

	test('falls back to (detached) when branch line is missing', async () => {
		const stdout = ['worktree /home/user/wt/bare', 'HEAD 1234567'].join('\n');
		const runner: Runner = async () => ({ code: 0, stdout });
		const worktrees = await gitWorktreeList(validRoot, runner);
		expect(worktrees).toEqual([{ path: '/home/user/wt/bare', branch: '(detached)' }]);
	});

	test('handles empty stdout without error', async () => {
		const runner: Runner = async () => ({ code: 0, stdout: '' });
		const worktrees = await gitWorktreeList(validRoot, runner);
		expect(worktrees).toEqual([]);
	});

	test('throws on non-zero exit without leaking details', async () => {
		const runner: Runner = async () => ({ code: 1, stdout: 'fatal: not a git repository' });
		await expect(gitWorktreeList(validRoot, runner)).rejects.toThrow('git worktree list failed');
	});

	test('throws on rejected runner without leaking details', async () => {
		const runner: Runner = async () => {
			throw new Error('git worktree failed in /secret/path');
		};
		await expect(gitWorktreeList(validRoot, runner)).rejects.toThrow('git worktree list failed');
	});
});

describe('gitWorktreeAdd', () => {
	const validRoot: GitRoot = { name: 'my-repo', path: '/home/user/my-repo' };

	test('passes exact arguments without -b', async () => {
		let receivedArgs: string[] = [];
		const runner: Runner = async (args) => {
			receivedArgs = args;
			return { code: 0, stdout: '' };
		};
		await gitWorktreeAdd(validRoot, '/home/user/my-repo/wt-1', 'feature-branch', runner);
		expect(receivedArgs).toEqual(['worktree', 'add', '/home/user/my-repo/wt-1', 'feature-branch']);
		expect(receivedArgs).not.toContain('-b');
	});

	test('rejects a .. branch', async () => {
		await expect(gitWorktreeAdd(validRoot, '/home/user/wt-1', 'feat/../bad')).rejects.toThrow(
			'Invalid branch'
		);
		await expect(gitWorktreeAdd(validRoot, '/home/user/wt-1', '..')).rejects.toThrow(
			'Invalid branch'
		);
	});

	test('rejects branch with illegal characters or leading -', async () => {
		await expect(gitWorktreeAdd(validRoot, '/home/user/wt-1', '-b')).rejects.toThrow(
			'Invalid branch'
		);
		await expect(gitWorktreeAdd(validRoot, '/home/user/wt-1', 'feature branch')).rejects.toThrow(
			'Invalid branch'
		);
		await expect(gitWorktreeAdd(validRoot, '/home/user/wt-1', 'a'.repeat(101))).rejects.toThrow(
			'Invalid branch'
		);
	});

	test('rejects path equal to the root', async () => {
		await expect(gitWorktreeAdd(validRoot, validRoot.path, 'feature-branch')).rejects.toThrow(
			'Invalid worktree path'
		);
	});

	test('rejects non-absolute path', async () => {
		await expect(gitWorktreeAdd(validRoot, 'relative/wt', 'feature-branch')).rejects.toThrow(
			'Invalid path'
		);
	});

	test('rejects path containing .. segment', async () => {
		await expect(
			gitWorktreeAdd(validRoot, '/home/user/../secret', 'feature-branch')
		).rejects.toThrow('Invalid path');
	});

	test('rejects path starting with -', async () => {
		await expect(gitWorktreeAdd(validRoot, '-wt', 'feature-branch')).rejects.toThrow(
			'Invalid path'
		);
	});

	test('throws on non-zero exit without leaking details', async () => {
		const runner: Runner = async () => ({
			code: 1,
			stdout: 'fatal: already exists at /secret/path'
		});
		await expect(gitWorktreeAdd(validRoot, '/home/user/wt-1', 'main', runner)).rejects.toThrow(
			'git worktree add failed'
		);
	});

	test('throws on rejected runner without leaking details', async () => {
		const runner: Runner = async () => {
			throw new Error('failed in /secret/path');
		};
		await expect(gitWorktreeAdd(validRoot, '/home/user/wt-1', 'main', runner)).rejects.toThrow(
			'git worktree add failed'
		);
	});
});

describe('gitWorktreeRemove', () => {
	const validRoot: GitRoot = { name: 'my-repo', path: '/home/user/my-repo' };

	test('passes exact arguments containing no --force', async () => {
		let receivedArgs: string[] = [];
		const runner: Runner = async (args) => {
			receivedArgs = args;
			return { code: 0, stdout: '' };
		};
		await gitWorktreeRemove(validRoot, '/home/user/my-repo/wt-1', runner);
		expect(receivedArgs).toEqual(['worktree', 'remove', '/home/user/my-repo/wt-1']);
		expect(receivedArgs).not.toContain('--force');
		expect(receivedArgs).not.toContain('-f');
	});

	test('rejects path starting with - such as --force or -f', async () => {
		await expect(gitWorktreeRemove(validRoot, '--force')).rejects.toThrow('Invalid worktree path');
		await expect(gitWorktreeRemove(validRoot, '-f')).rejects.toThrow('Invalid worktree path');
	});

	test('rejects path equal to root.path', async () => {
		await expect(gitWorktreeRemove(validRoot, validRoot.path)).rejects.toThrow(
			'Invalid worktree path'
		);
	});

	test('rejects path containing .. segment or NUL byte', async () => {
		await expect(gitWorktreeRemove(validRoot, '/home/user/../secret')).rejects.toThrow(
			'Invalid worktree path'
		);
		await expect(gitWorktreeRemove(validRoot, '/home/user/wt\0')).rejects.toThrow(
			'Invalid worktree path'
		);
	});

	test('throws on non-zero exit without leaking details', async () => {
		const runner: Runner = async () => ({
			code: 1,
			stdout: 'fatal: contains modified or untracked files in /secret/path'
		});
		await expect(gitWorktreeRemove(validRoot, '/home/user/wt-1', runner)).rejects.toThrow(
			'git worktree remove failed'
		);
	});

	test('throws on rejected runner without leaking details', async () => {
		const runner: Runner = async () => {
			throw new Error('failed in /secret/path');
		};
		await expect(gitWorktreeRemove(validRoot, '/home/user/wt-1', runner)).rejects.toThrow(
			'git worktree remove failed'
		);
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

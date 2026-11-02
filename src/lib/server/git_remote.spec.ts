import { describe, expect, test } from 'vitest';
import type { GitRoot, Runner } from './git';
import { cloneUrl, gitRemote, parseRemote, type RemoteInfo, webUrl } from './git_remote';

describe('parseRemote', () => {
	test('the three accepted forms each parse to the same {provider: "github", owner, repo}', () => {
		const expected = {
			provider: 'github',
			owner: 'owner',
			repo: 'repo'
		};

		const scp = parseRemote('git@github.com:owner/repo.git');
		const https = parseRemote('https://github.com/owner/repo.git');
		const ssh = parseRemote('ssh://git@github.com/owner/repo.git');

		expect(scp).toMatchObject(expected);
		expect(https).toMatchObject(expected);
		expect(ssh).toMatchObject(expected);

		if (scp.provider === 'github') {
			expect(scp.owner).toBe('owner');
			expect(scp.repo).toBe('repo');
		}
		if (https.provider === 'github') {
			expect(https.owner).toBe('owner');
			expect(https.repo).toBe('repo');
		}
		if (ssh.provider === 'github') {
			expect(ssh.owner).toBe('owner');
			expect(ssh.repo).toBe('repo');
		}
	});

	test('trailing .git and trailing slash stripped', () => {
		const expected = {
			provider: 'github',
			owner: 'facebook',
			repo: 'react'
		};

		const variations = [
			'https://github.com/facebook/react',
			'https://github.com/facebook/react/',
			'https://github.com/facebook/react.git',
			'https://github.com/facebook/react.git/',
			'git@github.com:facebook/react',
			'git@github.com:facebook/react/',
			'git@github.com:facebook/react.git',
			'git@github.com:facebook/react.git/',
			'ssh://git@github.com/facebook/react',
			'ssh://git@github.com/facebook/react/',
			'ssh://git@github.com/facebook/react.git',
			'ssh://git@github.com/facebook/react.git/'
		];

		for (const url of variations) {
			expect(parseRemote(url)).toMatchObject(expected);
		}
	});

	test('https://user:tok@github.com/o/r refused', () => {
		const res = parseRemote('https://user:tok@github.com/o/r');
		expect(res.provider).toBe('unknown');
		if (res.provider === 'unknown') {
			expect(res.reason).toBe('URL contains credentials');
		}
	});

	test('additional credential variations are refused', () => {
		const credentialUrls = [
			'https://token@github.com/owner/repo.git',
			'ssh://git:secret@github.com/owner/repo.git',
			'ssh://user:tok@github.com/owner/repo.git',
			'ssh://token@github.com/owner/repo.git',
			'git:pass@github.com:owner/repo.git',
			'token@github.com:owner/repo.git'
		];
		for (const url of credentialUrls) {
			const res = parseRemote(url);
			expect(res.provider).toBe('unknown');
			if (res.provider === 'unknown') {
				expect(res.reason).toBe('URL contains credentials');
			}
		}
	});

	test('https://gitlab.com/o/r refused with a host reason', () => {
		const res = parseRemote('https://gitlab.com/o/r');
		expect(res.provider).toBe('unknown');
		if (res.provider === 'unknown') {
			expect(res.reason.toLowerCase()).toContain('host');
		}

		const gitlabSsh = parseRemote('git@gitlab.com:o/r.git');
		expect(gitlabSsh.provider).toBe('unknown');
		if (gitlabSsh.provider === 'unknown') {
			expect(gitlabSsh.reason.toLowerCase()).toContain('host');
		}

		const gitlabSshUrl = parseRemote('ssh://git@gitlab.com/o/r.git');
		expect(gitlabSshUrl.provider).toBe('unknown');
		if (gitlabSshUrl.provider === 'unknown') {
			expect(gitlabSshUrl.reason.toLowerCase()).toContain('host');
		}
	});

	test('git@github.com:own refused', () => {
		const res = parseRemote('git@github.com:own');
		expect(res.provider).toBe('unknown');
		if (res.provider === 'unknown') {
			expect(res.reason.toLowerCase()).toMatch(/path|malformed/);
		}
	});

	test('malformed paths and invalid URLs are refused', () => {
		const malformedUrls = [
			'',
			'   ',
			'git@github.com:',
			'https://github.com/',
			'https://github.com/owner/repo/extra',
			'https://github.com/../repo',
			'https://github.com/owner/..',
			'not-a-url'
		];
		for (const url of malformedUrls) {
			const res = parseRemote(url);
			expect(res.provider).toBe('unknown');
			if (res.provider === 'unknown') {
				expect(res.reason.toLowerCase()).toMatch(/path|malformed/);
			}
		}
	});
});

describe('webUrl and cloneUrl', () => {
	test('webUrl/cloneUrl for github and null for unknown', () => {
		const githubRemote: RemoteInfo = {
			provider: 'github',
			owner: 'sveltejs',
			repo: 'kit',
			url: 'git@github.com:sveltejs/kit.git'
		};
		expect(cloneUrl(githubRemote)).toBe('git@github.com:sveltejs/kit.git');
		expect(webUrl(githubRemote)).toBe('https://github.com/sveltejs/kit');

		const unknownRemote: RemoteInfo = {
			provider: 'unknown',
			reason: 'This repository has no origin remote.'
		};
		expect(cloneUrl(unknownRemote)).toBeNull();
		expect(webUrl(unknownRemote)).toBeNull();
	});
});

describe('gitRemote', () => {
	const validRoot: GitRoot = { name: 'my-project', path: '/home/rahman/repos/my-project' };

	test('gitRemote via a fake Runner returning the ssh form', async () => {
		let receivedArgs: string[] = [];
		const runner: Runner = async (args) => {
			receivedArgs = args;
			return { code: 0, stdout: 'git@github.com:owner/repo.git\n' };
		};

		const res = await gitRemote(validRoot, runner);
		expect(receivedArgs).toEqual(['remote', 'get-url', 'origin']);
		expect(res).toEqual({
			provider: 'github',
			owner: 'owner',
			repo: 'repo',
			url: 'git@github.com:owner/repo.git'
		});
	});

	test('gitRemote when the runner returns code 1 → unknown with the no-origin reason', async () => {
		const runner: Runner = async () => ({
			code: 1,
			stdout: 'error: No such remote origin'
		});

		const res = await gitRemote(validRoot, runner);
		expect(res).toEqual({
			provider: 'unknown',
			reason: 'This repository has no origin remote.'
		});
	});

	test('gitRemote when the runner rejects → same', async () => {
		const runner: Runner = async () => {
			throw new Error('git spawn ENOENT');
		};

		const res = await gitRemote(validRoot, runner);
		expect(res).toEqual({
			provider: 'unknown',
			reason: 'This repository has no origin remote.'
		});
	});

	test('an invalid root throws (assertValidRoot behaviour preserved)', async () => {
		const invalidRoots: GitRoot[] = [
			{ name: 'relative', path: 'relative/path' },
			{ name: 'traversal', path: '/home/user/../evil' },
			null as unknown as GitRoot,
			undefined as unknown as GitRoot
		];

		for (const invalid of invalidRoots) {
			await expect(gitRemote(invalid)).rejects.toThrow('Invalid git root');
		}
	});
});

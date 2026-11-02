import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { GET, POST } from './+server';

const { privateEnv, publicEnv, gitMock, logMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' },
	gitMock: {
		gitStatus: vi.fn(),
		gitLog: vi.fn(),
		gitDiff: vi.fn(),
		gitStage: vi.fn(),
		gitCommit: vi.fn(),
		gitWorktreeList: vi.fn(),
		gitWorktreeAdd: vi.fn(),
		gitWorktreeRemove: vi.fn()
	},
	logMock: {
		logEvent: vi.fn()
	}
}));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/server/git', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/git')>();
	return {
		...actual,
		gitStatus: gitMock.gitStatus,
		gitLog: gitMock.gitLog,
		gitDiff: gitMock.gitDiff,
		gitStage: gitMock.gitStage,
		gitCommit: gitMock.gitCommit,
		gitWorktreeList: gitMock.gitWorktreeList,
		gitWorktreeAdd: gitMock.gitWorktreeAdd,
		gitWorktreeRemove: gitMock.gitWorktreeRemove
	};
});
vi.mock('$lib/server/log', () => ({
	logEvent: logMock.logEvent
}));

let tokenSeq = 1;

function makeEvent(search = '', token?: string): RequestEvent<Record<string, never>, '/api/git'> {
	const url = new URL(`https://app.example.com/api/git${search}`);
	const headers = new Headers();
	if (token) {
		headers.set('authorization', `Bearer ${token}`);
	}
	return {
		url,
		request: new Request(url, { method: 'GET', headers }),
		cookies: {
			get: () => undefined
		}
	} as unknown as RequestEvent<Record<string, never>, '/api/git'>;
}

function makePostEvent(
	body: unknown,
	search = '',
	token?: string,
	origin = 'https://app.example.com'
): RequestEvent<Record<string, never>, '/api/git'> {
	const url = new URL(`https://app.example.com/api/git${search}`);
	const headers = new Headers();
	if (origin) {
		headers.set('origin', origin);
	}
	headers.set('content-type', 'application/json');
	if (token) {
		headers.set('authorization', `Bearer ${token}`);
	}
	const requestInit: RequestInit = {
		method: 'POST',
		headers,
		body: typeof body === 'string' ? body : JSON.stringify(body)
	};
	return {
		url,
		request: new Request(url, requestInit),
		cookies: {
			get: () => undefined
		}
	} as unknown as RequestEvent<Record<string, never>, '/api/git'>;
}

describe('/api/git GET', () => {
	let validToken: string;

	beforeEach(() => {
		tokenSeq++;
		validToken = `test-token-${tokenSeq}`.padEnd(32, '0');
		Object.assign(privateEnv, {
			GIT_SURFACE_ENABLED: 'true',
			GIT_SURFACE_ROOTS: '/repos/alpha:/repos/beta',
			CAPABILITY_ACCESS_TOKEN: validToken
		});
		gitMock.gitStatus.mockReset().mockResolvedValue({
			branch: 'main',
			files: [{ code: 'M', path: 'file.txt' }],
			truncated: false
		});
		gitMock.gitLog
			.mockReset()
			.mockResolvedValue([{ hash: '1234567', date: '2026-11-02', subject: 'feat: add git route' }]);
		logMock.logEvent.mockReset().mockResolvedValue(undefined);
	});

	test('returns 404 when GIT_SURFACE_ENABLED is not true', async () => {
		privateEnv.GIT_SURFACE_ENABLED = 'false';
		await expect(GET(makeEvent('', validToken))).rejects.toMatchObject({
			status: 404
		});
	});

	test('returns 401 when unauthenticated', async () => {
		await expect(GET(makeEvent('', 'wrong-token'.padEnd(32, '0')))).rejects.toMatchObject({
			status: 401
		});
	});

	test('stays closed without sign-in: git is not part of the anonymous BYOK surface', async () => {
		// A no-auth deployment with no operator token used to open every capability route. The
		// repository path, branch and commit subjects are machine state, not BYOK settings.
		delete privateEnv.CAPABILITY_ACCESS_TOKEN;
		privateEnv.AUTH_ENABLED = 'false';
		await expect(GET(makeEvent(''))).rejects.toMatchObject({ status: 401 });
		await expect(POST(makePostEvent({ action: 'diff' }, '', undefined))).rejects.toMatchObject({
			status: 401
		});
		expect(gitMock.gitStatus).not.toHaveBeenCalled();
		expect(gitMock.gitDiff).not.toHaveBeenCalled();
		delete privateEnv.AUTH_ENABLED;
	});

	test('returns 503 when no git roots configured', async () => {
		privateEnv.GIT_SURFACE_ROOTS = '';
		await expect(GET(makeEvent('', validToken))).rejects.toMatchObject({
			status: 503
		});
	});

	test('returns 400 when requested root is unknown', async () => {
		await expect(GET(makeEvent('?root=unknown', validToken))).rejects.toMatchObject({
			status: 400
		});
	});

	test('returns first root by default with no-store cache control', async () => {
		const res = await GET(makeEvent('', validToken));
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = await res.json();
		expect(body).toEqual({
			root: { name: 'alpha' },
			status: {
				branch: 'main',
				files: [{ code: 'M', path: 'file.txt' }],
				truncated: false
			},
			commits: [{ hash: '1234567', date: '2026-11-02', subject: 'feat: add git route' }]
		});
		expect(gitMock.gitStatus).toHaveBeenCalledWith({ name: 'alpha', path: '/repos/alpha' });
		expect(gitMock.gitLog).toHaveBeenCalledWith({ name: 'alpha', path: '/repos/alpha' });
		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'git', {
			root: 'alpha',
			files: 1,
			commits: 1,
			outcome: 'ok'
		});
	});

	test('targets requested root when valid', async () => {
		const res = await GET(makeEvent('?root=beta', validToken));
		const body = await res.json();
		expect(body.root).toEqual({ name: 'beta' });
		expect(gitMock.gitStatus).toHaveBeenCalledWith({ name: 'beta', path: '/repos/beta' });
		expect(gitMock.gitLog).toHaveBeenCalledWith({ name: 'beta', path: '/repos/beta' });
	});

	test('returns 502 without leaking internal error when git fails', async () => {
		gitMock.gitStatus.mockRejectedValue(new Error('fatal: not a git repo /secret/path'));
		await expect(GET(makeEvent('', validToken))).rejects.toMatchObject({
			status: 502
		});
		expect(logMock.logEvent).toHaveBeenCalledWith('warn', 'git', {
			root: 'alpha',
			outcome: 'error'
		});
	});
});

describe('/api/git POST', () => {
	let validToken: string;

	beforeEach(() => {
		tokenSeq++;
		validToken = `test-token-${tokenSeq}`.padEnd(32, '0');
		Object.assign(privateEnv, {
			GIT_SURFACE_ENABLED: 'true',
			GIT_SURFACE_ROOTS: '/repos/alpha:/repos/beta',
			CAPABILITY_ACCESS_TOKEN: validToken,
			GIT_POLICY_JSON: undefined
		});
		gitMock.gitStatus.mockReset();
		gitMock.gitLog.mockReset();
		gitMock.gitDiff.mockReset().mockResolvedValue('diff --git a/file b/file\n+changes');
		gitMock.gitStage.mockReset().mockResolvedValue(undefined);
		gitMock.gitCommit.mockReset().mockResolvedValue({ hash: 'a1b2c3d' });
		gitMock.gitWorktreeList
			.mockReset()
			.mockResolvedValue([{ path: '/repos/alpha', branch: 'main' }]);
		gitMock.gitWorktreeAdd.mockReset().mockResolvedValue(undefined);
		gitMock.gitWorktreeRemove.mockReset().mockResolvedValue(undefined);
		logMock.logEvent.mockReset().mockResolvedValue(undefined);
	});

	test('returns 404 when GIT_SURFACE_ENABLED is not true', async () => {
		privateEnv.GIT_SURFACE_ENABLED = 'false';
		await expect(POST(makePostEvent({ action: 'diff' }, '', validToken))).rejects.toMatchObject({
			status: 404
		});
	});

	test('returns 401 when unauthenticated', async () => {
		await expect(
			POST(makePostEvent({ action: 'diff' }, '', 'wrong-token'.padEnd(32, '0')))
		).rejects.toMatchObject({
			status: 401
		});
	});

	test('returns 503 when no git roots configured', async () => {
		privateEnv.GIT_SURFACE_ROOTS = '';
		await expect(POST(makePostEvent({ action: 'diff' }, '', validToken))).rejects.toMatchObject({
			status: 503
		});
	});

	test('returns 400 when body is not valid JSON', async () => {
		await expect(POST(makePostEvent('{not-json', '', validToken))).rejects.toMatchObject({
			status: 400
		});
	});

	test('refuses a non-JSON media type and an oversized body instead of reading them', async () => {
		const url = new URL('https://app.example.com/api/git');
		const headers = new Headers({
			origin: 'https://app.example.com',
			'content-type': 'text/plain',
			authorization: `Bearer ${validToken}`
		});
		await expect(
			POST({
				url,
				request: new Request(url, { method: 'POST', headers, body: '{"action":"diff"}' }),
				cookies: { get: () => undefined }
			} as unknown as RequestEvent<Record<string, never>, '/api/git'>)
		).rejects.toMatchObject({ status: 415 });
		await expect(
			POST(makePostEvent({ action: 'commit', message: 'a'.repeat(70_000) }, '', validToken))
		).rejects.toMatchObject({ status: 413 });
		expect(gitMock.gitCommit).not.toHaveBeenCalled();
	});

	test('returns 400 when action is unknown', async () => {
		await expect(POST(makePostEvent({ action: 'rebase' }, '', validToken))).rejects.toMatchObject({
			status: 400
		});
	});

	test('returns 400 when required fields are missing', async () => {
		await expect(POST(makePostEvent({ action: 'stage' }, '', validToken))).rejects.toMatchObject({
			status: 400
		});
		await expect(POST(makePostEvent({ action: 'commit' }, '', validToken))).rejects.toMatchObject({
			status: 400
		});
		await expect(
			POST(makePostEvent({ action: 'worktree-add', path: '/tmp/wt' }, '', validToken))
		).rejects.toMatchObject({
			status: 400
		});
		await expect(
			POST(makePostEvent({ action: 'worktree-remove' }, '', validToken))
		).rejects.toMatchObject({
			status: 400
		});
	});

	test('returns 400 when field types are wrong', async () => {
		await expect(
			POST(makePostEvent({ action: 'stage', paths: 'not-array' }, '', validToken))
		).rejects.toMatchObject({
			status: 400
		});
		await expect(
			POST(makePostEvent({ action: 'commit', message: 123 }, '', validToken))
		).rejects.toMatchObject({
			status: 400
		});
		await expect(
			POST(makePostEvent({ action: 'diff', staged: 'yes' }, '', validToken))
		).rejects.toMatchObject({
			status: 400
		});
	});

	test('returns 400 when paths is empty or oversized (> 50)', async () => {
		await expect(
			POST(makePostEvent({ action: 'stage', paths: [] }, '', validToken))
		).rejects.toMatchObject({
			status: 400
		});
		const tooMany = Array.from({ length: 51 }, (_, i) => `file${i}.txt`);
		await expect(
			POST(makePostEvent({ action: 'stage', paths: tooMany }, '', validToken))
		).rejects.toMatchObject({
			status: 400
		});
	});

	test('returns 400 when commit message is blank or oversized (> 2000)', async () => {
		await expect(
			POST(makePostEvent({ action: 'commit', message: '' }, '', validToken))
		).rejects.toMatchObject({
			status: 400
		});
		await expect(
			POST(makePostEvent({ action: 'commit', message: '   ' }, '', validToken))
		).rejects.toMatchObject({
			status: 400
		});
		const tooLong = 'a'.repeat(2001);
		await expect(
			POST(makePostEvent({ action: 'commit', message: tooLong }, '', validToken))
		).rejects.toMatchObject({
			status: 400
		});
	});

	test('returns 400 when requested root is unknown', async () => {
		await expect(
			POST(makePostEvent({ action: 'diff', root: 'unknown' }, '', validToken))
		).rejects.toMatchObject({
			status: 400
		});
	});

	test('returns 403 when policy denies by default (no GIT_POLICY_JSON)', async () => {
		delete privateEnv.GIT_POLICY_JSON;
		await expect(
			POST(makePostEvent({ action: 'stage', paths: ['file.txt'] }, '', validToken))
		).rejects.toMatchObject({
			status: 403,
			body: {
				message: expect.stringMatching(/git_stage.*denied by default/i)
			}
		});
	});

	test('returns 403 when policy explicitly denies that verb', async () => {
		privateEnv.GIT_POLICY_JSON = JSON.stringify({ git_stage: 'deny' });
		await expect(
			POST(makePostEvent({ action: 'stage', paths: ['file.txt'] }, '', validToken))
		).rejects.toMatchObject({
			status: 403,
			body: {
				message: expect.stringMatching(/git_stage.*denied by default/i)
			}
		});
	});

	test('malformed GIT_POLICY_JSON falls back to deny rather than 500', async () => {
		privateEnv.GIT_POLICY_JSON = '{broken json:';
		await expect(POST(makePostEvent({ action: 'diff' }, '', validToken))).rejects.toMatchObject({
			status: 403,
			body: {
				message: expect.stringMatching(/git_diff.*denied by default/i)
			}
		});
	});

	test('returns 200 when GIT_POLICY_JSON allows the verb', async () => {
		privateEnv.GIT_POLICY_JSON = JSON.stringify({ git_diff: 'allow' });
		const res = await POST(makePostEvent({ action: 'diff' }, '', validToken));
		expect(res.status).toBe(200);
	});

	describe('happy paths for each action', () => {
		beforeEach(() => {
			privateEnv.GIT_POLICY_JSON = JSON.stringify({
				git_diff: 'allow',
				git_stage: 'allow',
				git_commit: 'allow',
				git_worktree: 'allow'
			});
		});

		test('diff returns diff output with Cache-Control no-store', async () => {
			const res = await POST(
				makePostEvent({ action: 'diff', staged: true, path: 'src/lib.ts' }, '', validToken)
			);
			expect(res.headers.get('cache-control')).toBe('no-store');
			const body = await res.json();
			expect(body).toEqual({
				root: { name: 'alpha' },
				diff: 'diff --git a/file b/file\n+changes'
			});
			expect(gitMock.gitDiff).toHaveBeenCalledWith(
				{ name: 'alpha', path: '/repos/alpha' },
				{ staged: true, path: 'src/lib.ts' }
			);
		});

		test('stage returns staged count with Cache-Control no-store', async () => {
			const res = await POST(
				makePostEvent({ action: 'stage', paths: ['file1.txt', 'file2.txt'] }, '', validToken)
			);
			expect(res.headers.get('cache-control')).toBe('no-store');
			const body = await res.json();
			expect(body).toEqual({
				root: { name: 'alpha' },
				staged: 2
			});
			expect(gitMock.gitStage).toHaveBeenCalledWith({ name: 'alpha', path: '/repos/alpha' }, [
				'file1.txt',
				'file2.txt'
			]);
		});

		test('commit returns hash with Cache-Control no-store', async () => {
			const res = await POST(
				makePostEvent({ action: 'commit', message: 'feat: add route' }, '', validToken)
			);
			expect(res.headers.get('cache-control')).toBe('no-store');
			const body = await res.json();
			expect(body).toEqual({
				root: { name: 'alpha' },
				hash: 'a1b2c3d'
			});
			expect(gitMock.gitCommit).toHaveBeenCalledWith(
				{ name: 'alpha', path: '/repos/alpha' },
				'feat: add route'
			);
		});

		test('worktree-list returns worktrees array', async () => {
			const res = await POST(makePostEvent({ action: 'worktree-list' }, '', validToken));
			expect(res.headers.get('cache-control')).toBe('no-store');
			const body = await res.json();
			expect(body).toEqual({
				root: { name: 'alpha' },
				worktrees: [{ path: '/repos/alpha', branch: 'main' }]
			});
			expect(gitMock.gitWorktreeList).toHaveBeenCalledWith({
				name: 'alpha',
				path: '/repos/alpha'
			});
		});

		test('worktree-add returns ok true', async () => {
			const res = await POST(
				makePostEvent(
					{ action: 'worktree-add', path: '/repos/wt-1', branch: 'feat/test' },
					'',
					validToken
				)
			);
			expect(res.headers.get('cache-control')).toBe('no-store');
			const body = await res.json();
			expect(body).toEqual({
				root: { name: 'alpha' },
				ok: true
			});
			expect(gitMock.gitWorktreeAdd).toHaveBeenCalledWith(
				{ name: 'alpha', path: '/repos/alpha' },
				'/repos/wt-1',
				'feat/test'
			);
		});

		test('worktree-remove returns ok true', async () => {
			const res = await POST(
				makePostEvent({ action: 'worktree-remove', path: '/repos/wt-1' }, '', validToken)
			);
			expect(res.headers.get('cache-control')).toBe('no-store');
			const body = await res.json();
			expect(body).toEqual({
				root: { name: 'alpha' },
				ok: true
			});
			expect(gitMock.gitWorktreeRemove).toHaveBeenCalledWith(
				{ name: 'alpha', path: '/repos/alpha' },
				'/repos/wt-1'
			);
		});

		test('targets requested root when valid in payload', async () => {
			const res = await POST(makePostEvent({ action: 'diff', root: 'beta' }, '', validToken));
			const body = await res.json();
			expect(body.root).toEqual({ name: 'beta' });
			expect(gitMock.gitDiff).toHaveBeenCalledWith(
				{ name: 'beta', path: '/repos/beta' },
				{ staged: undefined, path: undefined }
			);
		});
	});

	describe('git errors and logging', () => {
		beforeEach(() => {
			privateEnv.GIT_POLICY_JSON = JSON.stringify({
				git_diff: 'allow',
				git_stage: 'allow',
				git_commit: 'allow',
				git_worktree: 'allow'
			});
		});

		test('thrown git error on read action becomes 502 without leaking message', async () => {
			gitMock.gitDiff.mockRejectedValue(new Error('fatal: /private/secret/info leaked'));
			await expect(POST(makePostEvent({ action: 'diff' }, '', validToken))).rejects.toMatchObject({
				status: 502,
				body: {
					message: 'Repository could not be read.'
				}
			});
		});

		test('thrown git error on write action becomes 502 without leaking message', async () => {
			gitMock.gitCommit.mockRejectedValue(new Error('fatal: /private/secret/info leaked'));
			await expect(
				POST(makePostEvent({ action: 'commit', message: 'feat: add' }, '', validToken))
			).rejects.toMatchObject({
				status: 502,
				body: {
					message: 'Repository could not be written.'
				}
			});
		});

		test('logging carries no path, message, diff, or branch', async () => {
			await POST(
				makePostEvent({ action: 'stage', paths: ['secret/path/file.ts'] }, '', validToken)
			);
			expect(logMock.logEvent).toHaveBeenCalledWith('info', 'git', {
				action: 'stage',
				root: 'alpha',
				verb: 'git_stage',
				decision: 'allow',
				outcome: 'ok'
			});
			const lastLogCall = logMock.logEvent.mock.calls.at(-1);
			expect(lastLogCall).toBeDefined();
			const loggedPayload = lastLogCall![2] as Record<string, unknown>;
			expect(loggedPayload).not.toHaveProperty('paths');
			expect(loggedPayload).not.toHaveProperty('path');
			expect(loggedPayload).not.toHaveProperty('message');
			expect(loggedPayload).not.toHaveProperty('diff');
			expect(loggedPayload).not.toHaveProperty('branch');
		});

		test('logging on error carries no path, message, diff, or branch', async () => {
			gitMock.gitCommit.mockRejectedValue(new Error('commit failure'));
			await expect(
				POST(makePostEvent({ action: 'commit', message: 'secret commit message' }, '', validToken))
			).rejects.toMatchObject({
				status: 502
			});
			expect(logMock.logEvent).toHaveBeenCalledWith('warn', 'git', {
				action: 'commit',
				root: 'alpha',
				verb: 'git_commit',
				decision: 'allow',
				outcome: 'error'
			});
			const lastLogCall = logMock.logEvent.mock.calls.at(-1);
			expect(lastLogCall).toBeDefined();
			const loggedPayload = lastLogCall![2] as Record<string, unknown>;
			expect(loggedPayload).not.toHaveProperty('paths');
			expect(loggedPayload).not.toHaveProperty('path');
			expect(loggedPayload).not.toHaveProperty('message');
			expect(loggedPayload).not.toHaveProperty('diff');
			expect(loggedPayload).not.toHaveProperty('branch');
		});
	});
});

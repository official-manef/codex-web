import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { GET } from './+server';

const { privateEnv, publicEnv, gitMock, logMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' },
	gitMock: {
		gitStatus: vi.fn(),
		gitLog: vi.fn()
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
		gitLog: gitMock.gitLog
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

import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { MAX_RUNS_PER_DRAIN } from '$lib/automations_runner';
import { POST } from './+server';

const { privateEnv, publicEnv, mockQuery, mockMutation, accessMock, logMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: {
		PUBLIC_SITE_URL: 'https://app.example.com',
		PUBLIC_CONVEX_URL: 'https://convex.example.com'
	},
	mockQuery: vi.fn(),
	mockMutation: vi.fn(),
	accessMock: {
		requireCapabilityAccess: vi.fn()
	},
	logMock: {
		logEvent: vi.fn()
	}
}));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/server/access', () => ({
	requireCapabilityAccess: accessMock.requireCapabilityAccess
}));
vi.mock('$lib/server/log', () => ({
	logEvent: logMock.logEvent
}));
vi.mock('convex/browser', () => {
	class FakeConvexHttpClient {
		query = mockQuery;
		mutation = mockMutation;
	}
	return {
		ConvexHttpClient: FakeConvexHttpClient
	};
});

function makePostEvent(
	origin = 'https://app.example.com'
): RequestEvent<Record<string, never>, '/api/automations/run'> {
	const url = new URL('https://app.example.com/api/automations/run');
	const headers = new Headers();
	if (origin) {
		headers.set('origin', origin);
	}
	headers.set('content-type', 'application/json');
	return {
		url,
		request: new Request(url, { method: 'POST', headers }),
		cookies: {
			get: () => undefined
		}
	} as unknown as RequestEvent<Record<string, never>, '/api/automations/run'>;
}

describe('/api/automations/run POST', () => {
	beforeEach(() => {
		Object.assign(privateEnv, {
			AUTOMATIONS_ENABLED: 'true'
		});
		accessMock.requireCapabilityAccess.mockReset().mockResolvedValue(undefined);
		logMock.logEvent.mockReset().mockResolvedValue(undefined);
		mockQuery.mockReset().mockResolvedValue([]);
		mockMutation.mockReset().mockResolvedValue(null);
	});

	test('returns 404 when AUTOMATIONS_ENABLED is not true', async () => {
		privateEnv.AUTOMATIONS_ENABLED = 'false';
		await expect(POST(makePostEvent())).rejects.toMatchObject({
			status: 404
		});
	});

	test('returns 404 when AUTOMATIONS_ENABLED is unset', async () => {
		delete privateEnv.AUTOMATIONS_ENABLED;
		await expect(POST(makePostEvent())).rejects.toMatchObject({
			status: 404
		});
	});

	test('enforces requireCapabilityAccess gate', async () => {
		const accessError = { status: 401, message: 'Unauthorized' };
		accessMock.requireCapabilityAccess.mockRejectedValueOnce(accessError);
		await expect(POST(makePostEvent())).rejects.toMatchObject(accessError);
	});

	test('enabled + empty due set → wouldRun: 0, executor: none, note present', async () => {
		mockQuery.mockResolvedValueOnce([]);

		const res = await POST(makePostEvent());
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');

		const body = await res.json();
		expect(body).toEqual({
			decisions: [],
			considered: 0,
			wouldRun: 0,
			plan: {
				toRun: [],
				skipped: [],
				capped: false
			},
			executor: 'none',
			note: 'Dry run. No prompt is executed and no failure counter changes. The plan is what a runner would claim, one row at a time, via claimRun.'
		});
		expect(mockMutation).not.toHaveBeenCalled();
	});

	test('a due row with failureCount: 3 → run: false, reason: over_cap', async () => {
		mockQuery.mockResolvedValueOnce([
			{
				_id: 'auto-capped',
				prompt: 'Summarise PRs',
				intervalMinutes: 60,
				nextRunAt: Date.now() - 5000,
				enabled: true,
				failureCount: 3
			}
		]);

		const res = await POST(makePostEvent());
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.considered).toBe(1);
		expect(body.wouldRun).toBe(0);
		expect(body.decisions).toEqual([
			{
				id: 'auto-capped',
				run: false,
				reason: 'over_cap'
			}
		]);
		expect(body.plan.toRun).toEqual([]);
		expect(body.plan.skipped).toEqual([
			{
				id: 'auto-capped',
				reason: 'over_cap'
			}
		]);
		expect(body.plan.capped).toBe(false);
		expect(mockMutation).not.toHaveBeenCalled();
	});

	test('a disabled row → reason: disabled', async () => {
		mockQuery.mockResolvedValueOnce([
			{
				_id: 'auto-disabled',
				prompt: 'Run weekly audit',
				intervalMinutes: 1440,
				nextRunAt: Date.now() - 5000,
				enabled: false,
				failureCount: 0
			}
		]);

		const res = await POST(makePostEvent());
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.considered).toBe(1);
		expect(body.wouldRun).toBe(0);
		expect(body.decisions).toEqual([
			{
				id: 'auto-disabled',
				run: false,
				reason: 'disabled'
			}
		]);
		expect(mockMutation).not.toHaveBeenCalled();
	});

	test('a due row ready to run → run: true, reason: due', async () => {
		mockQuery.mockResolvedValueOnce([
			{
				_id: 'auto-due',
				prompt: 'Run daily health check',
				intervalMinutes: 1440,
				nextRunAt: Date.now() - 1000,
				enabled: true,
				failureCount: 0
			}
		]);

		const res = await POST(makePostEvent());
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.considered).toBe(1);
		expect(body.wouldRun).toBe(1);
		expect(body.decisions).toEqual([
			{
				id: 'auto-due',
				run: true,
				reason: 'due'
			}
		]);
		expect(body.plan.toRun).toEqual(['auto-due']);
		expect(body.plan.skipped).toEqual([]);
		expect(body.plan.capped).toBe(false);
		expect(mockMutation).not.toHaveBeenCalled();
	});

	test('the response never contains a prompt string', async () => {
		const sensitivePrompt = 'TOP_SECRET_PROMPT_DO_NOT_REVEAL_98765';
		mockQuery.mockResolvedValueOnce([
			{
				_id: 'auto-secret',
				prompt: sensitivePrompt,
				intervalMinutes: 30,
				nextRunAt: Date.now() - 500,
				enabled: true,
				failureCount: 0
			}
		]);

		const res = await POST(makePostEvent());
		const text = await res.text();
		expect(text).not.toContain(sensitivePrompt);

		const parsed = JSON.parse(text);
		expect(parsed.decisions).toEqual([
			{
				id: 'auto-secret',
				run: true,
				reason: 'due'
			}
		]);
		expect(parsed.plan.toRun).toEqual(['auto-secret']);
		expect(JSON.stringify(parsed.plan)).not.toContain(sensitivePrompt);
		expect(mockMutation).not.toHaveBeenCalled();
	});

	test('response contains plan.toRun and plan.skipped; over_cap row appears in skipped; plan never contains prompt; no mutation invoked', async () => {
		const sensitivePrompt = 'HIGHLY_CONFIDENTIAL_PROMPT_XYZ';
		mockQuery.mockResolvedValueOnce([
			{
				_id: 'auto-ok',
				prompt: sensitivePrompt,
				intervalMinutes: 15,
				nextRunAt: Date.now() - 2000,
				enabled: true,
				failureCount: 0
			},
			{
				_id: 'auto-failed',
				prompt: sensitivePrompt,
				intervalMinutes: 30,
				nextRunAt: Date.now() - 1000,
				enabled: true,
				failureCount: 3
			}
		]);

		const res = await POST(makePostEvent());
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.plan.toRun).toEqual(['auto-ok']);
		expect(body.plan.skipped).toEqual([
			{
				id: 'auto-failed',
				reason: 'over_cap'
			}
		]);
		expect(body.plan.capped).toBe(false);
		expect(JSON.stringify(body.plan)).not.toContain(sensitivePrompt);
		expect(mockMutation).not.toHaveBeenCalled();
	});

	test('the log call receives no prompt string and records flat primitives only', async () => {
		const sensitivePrompt = 'ANOTHER_CONFIDENTIAL_PROMPT_STRING';
		mockQuery.mockResolvedValueOnce([
			{
				_id: 'auto-log-test',
				prompt: sensitivePrompt,
				intervalMinutes: 60,
				nextRunAt: Date.now() - 500,
				enabled: true,
				failureCount: 0
			}
		]);

		await POST(makePostEvent());

		expect(logMock.logEvent).toHaveBeenCalledTimes(1);
		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'automations.run', {
			considered: 1,
			wouldRun: 1,
			outcome: 'ok'
		});

		for (const call of logMock.logEvent.mock.calls) {
			const serialized = JSON.stringify(call);
			expect(serialized).not.toContain(sensitivePrompt);
		}
	});

	test('bounds processing to MAX_RUNS_PER_DRAIN rows', async () => {
		const rows = Array.from({ length: 30 }, (_, i) => ({
			_id: `auto-${i}`,
			prompt: `Prompt ${i}`,
			intervalMinutes: 60,
			nextRunAt: Date.now() - 1000,
			enabled: true,
			failureCount: 0
		}));
		mockQuery.mockResolvedValueOnce(rows);

		const res = await POST(makePostEvent());
		const body = await res.json();
		expect(body.considered).toBe(MAX_RUNS_PER_DRAIN);
		expect(body.decisions).toHaveLength(MAX_RUNS_PER_DRAIN);
		expect(mockMutation).not.toHaveBeenCalled();
	});

	test('gracefully falls back to empty decisions if Convex query fails', async () => {
		mockQuery.mockRejectedValueOnce(new Error('Convex connection failed'));

		const res = await POST(makePostEvent());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.considered).toBe(0);
		expect(body.wouldRun).toBe(0);
		expect(body.decisions).toEqual([]);
		expect(mockMutation).not.toHaveBeenCalled();
	});
});

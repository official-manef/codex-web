import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET } from './+server';

const { privateEnv, publicEnv, logMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' },
	logMock: { logEvent: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/server/log', () => ({ logEvent: logMock.logEvent }));

const token = 'y'.repeat(32);

// GET returns `MaybePromise<Response>`; awaiting it keeps the rejection type visible here.
async function failureOf(result: ReturnType<typeof GET>) {
	return Promise.resolve(result).catch((error: unknown) => error);
}

type Ev = Parameters<typeof GET>[0];

function makeEvent(authorization?: string, origin = 'https://app.example.com'): Ev {
	const url = new URL('https://app.example.com/api/ai/config');
	const headers = new Headers();
	if (authorization) headers.set('authorization', `Bearer ${authorization}`);
	if (origin) headers.set('origin', origin);
	return {
		url,
		request: new Request(url, { method: 'GET', headers }),
		cookies: { get: () => undefined }
	} as unknown as Ev;
}

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	Object.assign(privateEnv, {
		AI_ENABLED: 'true',
		AI_MODELS_JSON: '{"openai":["gpt-a","gpt-a"],"nine-router":["r1"]}',
		MCP_CLIENT_ENABLED: 'true',
		MCP_SERVERS_JSON: JSON.stringify([
			{ alias: 'hub', url: 'https://mcp.example.com/mcp', auth: 'bearer', tools: ['echo'] }
		]),
		CAPABILITY_ACCESS_TOKEN: token
	});
	logMock.logEvent.mockReset().mockResolvedValue(undefined);
});

describe('/api/ai/config GET', () => {
	test('unauthenticated request is rejected before any config is read', async () => {
		await expect(GET(makeEvent())).rejects.toMatchObject({ status: 401 });
	});

	test('requires same-origin only for the operator token path, not for GET', async () => {
		// GET is allowed cross-origin by design; the token alone decides access.
		const res = await GET(makeEvent(token, 'https://elsewhere.example'));
		expect(res.status).toBe(200);
	});

	test('returns providers with duplicate models collapsed and no-store caching', async () => {
		const res = await GET(makeEvent(token));
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = await res.json();
		expect(body.ai.enabled).toBe(true);
		expect(body.ai.providers).toEqual([
			{
				id: 'openai',
				label: 'OpenAI',
				models: ['gpt-a'],
				efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
			},
			{ id: 'nine-router', label: '9router', models: ['r1'], efforts: [] }
		]);
	});

	test('exposes accepted reasoning efforts per provider', async () => {
		const res = await GET(makeEvent(token));
		const body = await res.json();
		const openai = body.ai.providers.find((p: { id: string }) => p.id === 'openai');
		const nineRouter = body.ai.providers.find((p: { id: string }) => p.id === 'nine-router');
		expect(openai.efforts).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
		expect(nineRouter.efforts).toEqual([]);
	});

	test('exposes MCP alias names only, never urls, auth style or tool lists', async () => {
		const body = await (await GET(makeEvent(token))).json();
		expect(body.mcp).toEqual({ enabled: true, servers: [{ alias: 'hub' }] });
		expect(JSON.stringify(body)).not.toContain('mcp.example.com');
		expect(JSON.stringify(body)).not.toContain('echo');
	});

	test('reports MCP disabled and no servers when the client flag is off', async () => {
		privateEnv.MCP_CLIENT_ENABLED = 'false';
		const body = await (await GET(makeEvent(token))).json();
		expect(body.mcp).toEqual({ enabled: false, servers: [] });
		expect(body.ai.enabled).toBe(true);
	});

	test('is guarded even when both AI and MCP are disabled', async () => {
		privateEnv.AI_ENABLED = 'false';
		privateEnv.MCP_CLIENT_ENABLED = 'false';
		// A configured operator token is enforced regardless of the feature flags: the disabled
		// answer is still a catalog, not a public one.
		await expect(GET(makeEvent())).rejects.toMatchObject({ status: 401 });
		const body = await (await GET(makeEvent(token))).json();
		expect(body).toEqual({
			ai: { enabled: false, providers: [] },
			mcp: { enabled: false, servers: [] }
		});
	});

	test('malformed model config becomes 503 with no configuration detail', async () => {
		privateEnv.AI_MODELS_JSON = '{not json';
		const failure = await failureOf(GET(makeEvent(token)));
		expect(failure).toMatchObject({ status: 503 });
		expect(String((failure as { body?: { message?: string } }).body?.message)).not.toContain(
			'not json'
		);
		expect(logMock.logEvent).toHaveBeenCalledWith('warn', 'ai.config', {
			outcome: 'invalid-configuration'
		});
	});

	test('an unapproved MCP url becomes 503 rather than leaking the endpoint', async () => {
		privateEnv.MCP_SERVERS_JSON = JSON.stringify([
			{ alias: 'hub', url: 'http://127.0.0.1:9000/mcp', auth: 'bearer', tools: ['echo'] }
		]);
		const failure = await failureOf(GET(makeEvent(token)));
		expect(failure).toMatchObject({ status: 503 });
		expect(JSON.stringify(failure)).not.toContain('127.0.0.1');
	});

	test('logging records counts only, never model names or endpoints', async () => {
		await GET(makeEvent(token));
		const [, , fields] = logMock.logEvent.mock.calls[0];
		expect(fields).toEqual({ providers: 2, models: 2, mcpEnabled: true, mcpServers: 1 });
		expect(JSON.stringify(logMock.logEvent.mock.calls)).not.toContain('gpt-a');
	});
});

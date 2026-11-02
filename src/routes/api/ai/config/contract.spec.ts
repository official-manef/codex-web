import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import * as route from './+server';

const { privateEnv, publicEnv, logMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' },
	logMock: { logEvent: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/server/log', () => ({ logEvent: logMock.logEvent }));

const ORIGIN = 'https://app.example.com';
let tokenSeq = 0;

function operatorToken() {
	tokenSeq++;
	return `contract-token-${tokenSeq}`.padEnd(40, '0');
}

function event(headers: Record<string, string> = {}, path = '/api/ai/config') {
	const url = new URL(path, ORIGIN);
	const init = { method: 'GET', headers: new Headers(headers) };
	return {
		url,
		request: new Request(url, init),
		cookies: { get: () => undefined, set: () => undefined, delete: () => undefined },
		setHeaders: vi.fn()
	} as unknown as RequestEvent<Record<string, never>, never>;
}

// Every failure body is JSON `{ message }`; nothing else may ride along.
async function failure(promise: Promise<Response> | Response) {
	try {
		const response = await promise;
		return { status: response.status, body: await response.text() };
	} catch (thrown) {
		const error = thrown as { status?: number; body?: unknown };
		return { status: error.status, body: JSON.stringify(error.body) };
	}
}

function expectNoInternals(text: string, secrets: string[] = []) {
	expect(text).not.toMatch(/\n\s+at .+:\d+:\d+/);
	expect(text).not.toContain('/home/');
	for (const secret of secrets) expect(text).not.toContain(secret);
}

function enabledEnv(token: string, overrides: Record<string, string | undefined> = {}) {
	Object.assign(privateEnv, {
		AI_ENABLED: 'true',
		AI_MODELS_JSON: JSON.stringify({ openai: ['gpt-test'], anthropic: ['claude-test'] }),
		CAPABILITY_ACCESS_TOKEN: token,
		...overrides
	});
}

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	publicEnv.PUBLIC_SITE_URL = ORIGIN;
	logMock.logEvent.mockReset().mockResolvedValue(undefined);
});

describe('method discipline', () => {
	test('only GET is exported, so every other verb is a framework 405', () => {
		expect(Object.keys(route).sort()).toEqual(['GET']);
	});
});

describe('feature disabled', () => {
	test('answers 401 without a credential even when both features are off', async () => {
		const token = operatorToken();
		Object.assign(privateEnv, {
			AI_ENABLED: 'false',
			MCP_CLIENT_ENABLED: 'false',
			CAPABILITY_ACCESS_TOKEN: token
		});
		expect((await failure(route.GET(event()))).status).toBe(401);
		const response = await route.GET(event({ authorization: `Bearer ${token}` }));
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			ai: { enabled: false, providers: [] },
			mcp: { enabled: false, servers: [] }
		});
	});
});

describe('auth boundary', () => {
	test('enabled with no credential is 401 and names no internals', async () => {
		const token = operatorToken();
		enabledEnv(token);
		const result = await failure(route.GET(event()));
		expect(result.status).toBe(401);
		expect(JSON.parse(result.body)).toEqual({
			message: 'Sign in or provide the application access token.'
		});
		expectNoInternals(result.body, [token]);
	});

	test('enabled with a wrong credential is 401, including a prefix and a longer value', async () => {
		const token = operatorToken();
		enabledEnv(token);
		for (const value of [`${token}x`, token.slice(0, -1), 'x'.repeat(token.length)]) {
			const result = await failure(route.GET(event({ authorization: `Bearer ${value}` })));
			expect(result.status, value).toBe(401);
			expectNoInternals(result.body, [token]);
		}
	});

	test('a configured token shorter than 32 characters can never authenticate', async () => {
		const token = 'too-short';
		enabledEnv(token);
		const result = await failure(route.GET(event({ authorization: `Bearer ${token}` })));
		expect(result.status).toBe(401);
	});

	test('MCP enabled alone also requires a credential', async () => {
		const token = operatorToken();
		Object.assign(privateEnv, {
			AI_ENABLED: 'false',
			MCP_CLIENT_ENABLED: 'true',
			MCP_SERVERS_JSON: JSON.stringify([
				{ alias: 'ok', url: 'https://mcp.example.com/mcp', auth: 'bearer', tools: ['echo'] }
			]),
			CAPABILITY_ACCESS_TOKEN: token
		});
		const result = await failure(route.GET(event()));
		expect(result.status).toBe(401);
	});

	test('the burst limit answers 429 with a clean body once the principal is spent', async () => {
		const token = operatorToken();
		enabledEnv(token);
		const headers = { authorization: `Bearer ${token}` };
		for (let attempt = 0; attempt < 20; attempt++)
			expect((await route.GET(event(headers))).status).toBe(200);
		const limited = await failure(route.GET(event(headers)));
		expect(limited.status).toBe(429);
		expect(JSON.parse(limited.body)).toEqual({
			message: 'Too many requests. Try again in a minute.'
		});
		expectNoInternals(limited.body, [token]);
	});
});

describe('input validation is not reachable without a body but bad config is', () => {
	test('malformed AI_MODELS_JSON is 503 and does not echo the environment value', async () => {
		const token = operatorToken();
		enabledEnv(token, { AI_MODELS_JSON: '{"openai": [' });
		const result = await failure(route.GET(event({ authorization: `Bearer ${token}` })));
		expect(result.status).toBe(503);
		expect(JSON.parse(result.body)).toEqual({
			message: 'Assistant setup is incomplete. Check the private server configuration.'
		});
		expectNoInternals(result.body, ['OpenAI', 'MODELS_JSON']);
	});

	test('a model list with no approved model is 503 rather than an empty 200', async () => {
		const token = operatorToken();
		enabledEnv(token, { AI_MODELS_JSON: JSON.stringify({ openai: [], anthropic: [] }) });
		const result = await failure(route.GET(event({ authorization: `Bearer ${token}` })));
		expect(result.status).toBe(503);
	});

	test('an unparseable platform flag is 503, never a 500', async () => {
		const token = operatorToken();
		enabledEnv(token, { AI_ENABLED: 'yes' });
		const result = await failure(route.GET(event({ authorization: `Bearer ${token}` })));
		expect(result.status).toBe(503);
	});

	test('an invalid MCP server list fails closed with 503, not a partial catalog', async () => {
		const token = operatorToken();
		enabledEnv(token, {
			MCP_CLIENT_ENABLED: 'true',
			MCP_SERVERS_JSON: JSON.stringify([
				{ alias: 'ok', url: 'http://mcp.example.com/mcp', auth: 'bearer', tools: ['echo'] }
			])
		});
		const result = await failure(route.GET(event({ authorization: `Bearer ${token}` })));
		expect(result.status).toBe(503);
		expect(JSON.parse(result.body)).not.toHaveProperty('ai');
	});
});

describe('response shape', () => {
	test('happy path carries the documented keys and nothing operational', async () => {
		const token = operatorToken();
		enabledEnv(token, {
			MCP_CLIENT_ENABLED: 'true',
			MCP_SERVERS_JSON: JSON.stringify([
				{
					alias: 'ok',
					url: 'https://mcp.example.com/private-path',
					auth: 'bearer',
					tools: ['echo']
				}
			])
		});
		const response = await route.GET(event({ authorization: `Bearer ${token}` }));
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const text = await response.text();
		const body = JSON.parse(text) as {
			ai: {
				enabled: boolean;
				providers: { id: string; label: string; models: string[]; efforts?: string[] }[];
			};
			mcp: { enabled: boolean; servers: { alias: string }[] };
		};
		expect(Object.keys(body).sort()).toEqual(['ai', 'mcp']);
		expect(body.ai.enabled).toBe(true);
		expect(body.ai.providers).toEqual([
			{
				id: 'openai',
				label: 'OpenAI',
				models: ['gpt-test'],
				efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
			},
			{ id: 'anthropic', label: 'Anthropic', models: ['claude-test'], efforts: [] }
		]);
		expect(body.mcp).toEqual({ enabled: true, servers: [{ alias: 'ok' }] });
		// Consumers rely on aliases only: the endpoint and any key must never travel.
		expect(text).not.toContain('mcp.example.com');
		expect(text).not.toContain(token);
	});

	test('duplicate models are collapsed so a consumer sees one entry per model', async () => {
		const token = operatorToken();
		enabledEnv(token, {
			AI_MODELS_JSON: JSON.stringify({ openai: ['gpt-test', 'gpt-test'] })
		});
		const body = (await (await route.GET(event({ authorization: `Bearer ${token}` }))).json()) as {
			ai: { providers: { models: string[] }[] };
		};
		expect(body.ai.providers[0].models).toEqual(['gpt-test']);
	});
});

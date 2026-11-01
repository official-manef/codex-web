import { beforeEach, expect, test, vi } from 'vitest';

/**
 * The app allowlist route: it must be off by default, and a malformed entry must be dropped
 * rather than hidden or repaired. `parseAppList` is the same function the route uses, so a
 * green test here is a green test for the real gate.
 */
const env: {
	MCP_APPS_ENABLED: string;
	MCP_APPS_JSON: string;
	MCP_APPS_ALLOW?: string;
	MCP_APPS_POLICY_JSON?: string;
} = {
	MCP_APPS_ENABLED: 'false',
	MCP_APPS_JSON: '',
	MCP_APPS_ALLOW: 'weather',
	MCP_APPS_POLICY_JSON: JSON.stringify({ mcp_app: 'allow' })
};

vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$lib/server/access', () => ({
	requireCapabilityAccess: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/log', () => ({ logEvent: vi.fn(async () => undefined) }));

const { GET } = await import('./+server');
const { logEvent } = await import('$lib/server/log');

function call() {
	const event = new URL('http://127.0.0.1/api/mcp/apps');
	return (GET as unknown as (e: unknown) => Promise<Response>)({
		request: new Request(event, { method: 'GET' }),
		url: event
	});
}

const good = {
	id: 'weather',
	name: 'Weather',
	origin: 'https://apps.example',
	entry: '/weather/index.html',
	surfaces: ['panel']
};

beforeEach(() => {
	env.MCP_APPS_ENABLED = 'false';
	env.MCP_APPS_JSON = '';
	env.MCP_APPS_ALLOW = 'weather';
	env.MCP_APPS_POLICY_JSON = JSON.stringify({ mcp_app: 'allow' });
	vi.mocked(logEvent).mockClear();
});

test('disabled by default answers 404 and never lists anything', async () => {
	env.MCP_APPS_JSON = JSON.stringify([good]);
	await expect(call()).rejects.toMatchObject({ status: 404 });
});

test('enabled with no configuration answers an empty allowlist', async () => {
	env.MCP_APPS_ENABLED = 'true';
	const response = await call();
	expect(response.status).toBe(200);
	await expect(response.json()).resolves.toEqual({ apps: [], blocked: 0 });
});

test('a valid entry is returned and a malformed one is dropped, not repaired', async () => {
	env.MCP_APPS_ENABLED = 'true';
	env.MCP_APPS_JSON = JSON.stringify([
		good,
		{ id: 'Bad Id', name: 'x', origin: 'http://insecure.example', entry: '/a', surfaces: ['panel'] }
	]);
	const response = await call();
	const body = (await response.json()) as { apps: { id: string }[]; blocked: number };
	expect(body.apps.map((app) => app.id)).toEqual(['weather']);
	expect(body.blocked).toBe(0);
});

test('invalid JSON is a 503, not an empty list', async () => {
	env.MCP_APPS_ENABLED = 'true';
	env.MCP_APPS_JSON = '{not json';
	await expect(call()).rejects.toMatchObject({ status: 503 });
});

test('the log records counts only, never an app id or origin', async () => {
	env.MCP_APPS_ENABLED = 'true';
	env.MCP_APPS_JSON = JSON.stringify([good]);
	await call();
	const recorded = vi.mocked(logEvent).mock.calls.map((entry) => JSON.stringify(entry));
	expect(recorded.join('\n')).not.toContain('apps.example');
	expect(recorded.join('\n')).not.toContain('weather');
	expect(recorded.join('\n')).toContain('accepted');
	expect(recorded.join('\n')).toContain('blocked');
});

test('an app listed in MCP_APPS_JSON but absent from MCP_APPS_ALLOW is not returned and is counted in blocked', async () => {
	env.MCP_APPS_ENABLED = 'true';
	env.MCP_APPS_JSON = JSON.stringify([good]);
	env.MCP_APPS_ALLOW = 'other-app';
	const response = await call();
	expect(response.status).toBe(200);
	const body = (await response.json()) as { apps: unknown[]; blocked: number };
	expect(body.apps).toEqual([]);
	expect(body.blocked).toBe(1);
});

test('with MCP_APPS_POLICY_JSON denying mcp_app every app is blocked', async () => {
	env.MCP_APPS_ENABLED = 'true';
	env.MCP_APPS_JSON = JSON.stringify([good]);
	env.MCP_APPS_ALLOW = 'weather';
	env.MCP_APPS_POLICY_JSON = JSON.stringify({ mcp_app: 'deny' });
	const response = await call();
	expect(response.status).toBe(200);
	const body = (await response.json()) as { apps: unknown[]; blocked: number };
	expect(body.apps).toEqual([]);
	expect(body.blocked).toBe(1);
});

test('malformed MCP_APPS_POLICY_JSON denies', async () => {
	env.MCP_APPS_ENABLED = 'true';
	env.MCP_APPS_JSON = JSON.stringify([good]);
	env.MCP_APPS_ALLOW = 'weather';
	env.MCP_APPS_POLICY_JSON = '{ not valid json :';
	const response = await call();
	expect(response.status).toBe(200);
	const body = (await response.json()) as { apps: unknown[]; blocked: number };
	expect(body.apps).toEqual([]);
	expect(body.blocked).toBe(1);
});

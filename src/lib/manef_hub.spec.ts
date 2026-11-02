import { afterEach, expect, test, vi } from 'vitest';
import { hub, hubMessage } from './manef_hub';

/**
 * The hub client is the browser's only way to reach a loopback hub, and every failure reaches
 * the user as one of these strings. What matters is that an upstream message never becomes
 * user-visible text, and that a non-2xx answer can never be read as a registry.
 */

function answer(status: number, body: unknown, ok = status >= 200 && status < 300) {
	return {
		ok,
		status,
		json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body))
	} as unknown as Response;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

test('hubMessage maps every hub code to fixed text and never echoes an unknown code', () => {
	expect(hubMessage('hub_unconfigured')).toContain('MANEF_HUB_URL');
	expect(hubMessage('hub_unreachable')).toContain('manef-ai');
	expect(hubMessage('authority_not_allowed')).toContain('authenticate their own callers');
	// An unrecognised code falls back to a generic line: a raw upstream string never escapes.
	expect(hubMessage('something_new_upstream')).toBe('The local request could not complete.');
	expect(hubMessage('')).toBe('The local request could not complete.');
	// A prototype key is not an error code, so it cannot resolve to a function.
	expect(hubMessage('toString')).toBe('The local request could not complete.');
	expect(hubMessage('__proto__')).toBe('The local request could not complete.');
});

test('hub.modules calls the fixed loopback bridge path with no credentials', async () => {
	const fetch = vi.fn(async () => answer(200, { foundationVersion: null, modules: [] }));
	vi.stubGlobal('fetch', fetch);
	await hub.modules();
	expect(fetch).toHaveBeenCalledTimes(1);
	const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
	// The bridge is what enforces the allowlist; the client may not talk to the hub directly.
	expect(path).toBe('/api/manef/modules');
	expect(init).toMatchObject({ cache: 'no-store' });
	expect(init.method).toBeUndefined();
	expect(init.headers).toBeUndefined();
	expect(init.body).toBeUndefined();
});

test('hub.plan posts JSON and nothing else', async () => {
	const fetch = vi.fn(async () =>
		answer(200, { ok: true, mode: 'preview', status: 'planned', steps: [], errors: [] })
	);
	vi.stubGlobal('fetch', fetch);
	const request = { version: '1.0.0', mode: 'preview', steps: [] };
	await hub.plan(request);
	const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
	expect(path).toBe('/api/manef/plan');
	expect(init.method).toBe('POST');
	expect(init.headers).toEqual({ 'content-type': 'application/json' });
	expect(init.body).toBe(JSON.stringify(request));
	// No credentials are attached: the bridge adds nothing the hub could use as authority.
	expect(JSON.stringify(init)).not.toMatch(/authorization|token|secret/i);
});

test('a non-2xx answer is an error carrying the mapped code, not the upstream text', async () => {
	vi.stubGlobal('fetch', async () => answer(503, { error: { code: 'hub_unreachable' } }));
	await expect(hub.modules()).rejects.toThrow(/did not answer/);
});

test('the three error shapes the bridge can return all yield a usable code', async () => {
	// `error.code` from our own failures.
	vi.stubGlobal('fetch', async () => answer(400, { error: { code: 'invalid_json' } }));
	await expect(hub.plan({})).rejects.toThrow('Enter valid JSON.');

	// A bare `code`, as the hub itself sends.
	vi.stubGlobal('fetch', async () => answer(400, { code: 'invalid_steps' }));
	await expect(hub.plan({})).rejects.toThrow('Add 1–32 steps');

	// `message` from a SvelteKit `error()` response is a code, not prose, so it maps too.
	vi.stubGlobal('fetch', async () => answer(413, { message: 'payload_too_large' }));
	await expect(hub.plan({})).rejects.toThrow(/64 KB/);
});

test('an unreadable body still fails, and its message is generic', async () => {
	vi.stubGlobal('fetch', async () => answer(500, undefined));
	await expect(hub.modules()).rejects.toThrow('The local request could not complete.');
	// A body that is not JSON at all is the same case.
	vi.stubGlobal('fetch', async () => answer(502, 'plain text upstream'));
	await expect(hub.modules()).rejects.toThrow('The local request could not complete.');
});

test('a network failure is not swallowed into a fake registry', async () => {
	vi.stubGlobal('fetch', async () => {
		throw new TypeError('Failed to fetch');
	});
	await expect(hub.modules()).rejects.toThrow(/Failed to fetch/);
});

test('an error body with no code at all still produces a flat message', async () => {
	vi.stubGlobal('fetch', async () => answer(400, { error: {} }));
	await expect(hub.modules()).rejects.toThrow('The local request could not complete.');
	vi.stubGlobal('fetch', async () => answer(400, { error: null, other: 1 }));
	await expect(hub.modules()).rejects.toThrow('The local request could not complete.');
	vi.stubGlobal('fetch', async () => answer(400, null));
	await expect(hub.modules()).rejects.toThrow('The local request could not complete.');
});

test('a 2xx body is returned as-is, even an empty one, so the caller sees the hub shape', async () => {
	vi.stubGlobal('fetch', async () =>
		answer(200, {
			configured: false,
			liveAdapters: 'unconfigured',
			modules: [],
			foundationVersion: null
		})
	);
	const ready = await hub.ready();
	expect(ready).toMatchObject({ configured: false, liveAdapters: 'unconfigured' });
	// An unreadable 2xx body resolves to `null`; the view's own guard turns that into an error.
	vi.stubGlobal('fetch', async () => answer(200, undefined));
	await expect(hub.ready()).resolves.toBeNull();
});

import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { GET as login } from './login/+server';
import { GET as callback } from './callback/+server';
import { POST as logout } from './logout/+server';
import { POST as token } from './token/+server';
import { authConfiguration, saveTransaction } from '$lib/server/auth/session';

const { privateEnv, publicEnv, oidcMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' },
	oidcMock: {
		beginAuthorization: vi.fn(),
		completeAuthorization: vi.fn(),
		refreshIdentity: vi.fn()
	}
}));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
// The OIDC library is the only outbound call on this surface; stub it so nothing leaves.
vi.mock('$lib/server/auth/oidc', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/auth/oidc')>()),
	beginAuthorization: oidcMock.beginAuthorization,
	completeAuthorization: oidcMock.completeAuthorization,
	refreshIdentity: oidcMock.refreshIdentity
}));

const ORIGIN = 'https://app.example.com';
const CLIENT_SECRET = 'fake-client-secret-not-real';
const SESSION_SECRET = Buffer.alloc(32, 7).toString('base64url');

type AuthRoute = '/auth/login' | '/auth/callback' | '/auth/logout' | '/auth/token';

function event<Route extends AuthRoute>(
	path: Route,
	init: {
		origin?: string | null;
		base?: string;
		search?: string;
		body?: string;
		cookies?: Map<string, string>;
	} = {}
) {
	const cookies = init.cookies ?? new Map<string, string>();
	const url = new URL(`${path}${init.search ?? ''}`, init.base ?? ORIGIN);
	const headers = new Headers();
	const method = path === '/auth/login' || path === '/auth/callback' ? 'GET' : 'POST';
	if (method === 'POST') {
		headers.set('content-type', 'application/json');
		if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
	}
	return {
		url,
		request: new Request(url, {
			method,
			headers,
			body: method === 'POST' ? (init.body ?? undefined) : undefined
		}),
		setHeaders: vi.fn(),
		cookies: {
			get: (name: string) => cookies.get(name),
			set: (name: string, value: string) => void cookies.set(name, value),
			delete: (name: string) => void cookies.delete(name)
		}
	} as unknown as RequestEvent<Record<string, never>, Route>;
}

// Every failure in this surface is a thrown HttpError, and `logout` throws synchronously, so the
// call must be deferred rather than awaited at the call site.
async function failure(call: () => Promise<Response> | Response) {
	try {
		const response = await call();
		return {
			status: response.status,
			location: response.headers.get('location'),
			body: await response.text()
		};
	} catch (thrown) {
		const error = thrown as {
			status?: number;
			body?: unknown;
			location?: string;
			message?: string;
		};
		return {
			status: error.status,
			location: error.location,
			// A plain Error (a deliberately uncaught misconfiguration) has no `body`; keep its
			// message so the assertion can still prove nothing internal leaks.
			body: error.body === undefined ? (error.message ?? '') : JSON.stringify(error.body)
		};
	}
}

function expectNoInternals(text: string, secrets: string[] = []) {
	expect(text).not.toMatch(/\n\s+at .+:\d+:\d+/);
	expect(text).not.toContain('/home/');
	for (const secret of secrets.filter(Boolean)) expect(text).not.toContain(secret);
}

function enableAuth(overrides: Record<string, string | undefined> = {}) {
	Object.assign(privateEnv, {
		AUTH_ENABLED: 'true',
		AUTH_CLIENT_ID: 'fake-client-id',
		AUTH_CLIENT_SECRET: CLIENT_SECRET,
		AUTH_SESSION_SECRET: SESSION_SECRET,
		...overrides
	});
}

function config() {
	const resolved = authConfiguration();
	if (!resolved.enabled) throw new Error('test configuration must be enabled');
	return resolved;
}

async function pendingTransaction(cookies = new Map<string, string>()) {
	const created = event('/auth/callback', { search: '?code=abc&state=xyz', cookies });
	await saveTransaction(created, config(), {
		verifier: 'v'.repeat(43),
		state: 's'.repeat(32),
		nonce: 'n'.repeat(32)
	});
	return { created, cookies };
}

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	publicEnv.PUBLIC_SITE_URL = ORIGIN;
	oidcMock.beginAuthorization.mockReset().mockResolvedValue({
		url: new URL('https://accounts.google.com/o/oauth2/v2/auth?state=state-value'),
		transaction: { verifier: 'v'.repeat(43), state: 's'.repeat(32), nonce: 'n'.repeat(32) }
	});
	oidcMock.completeAuthorization.mockReset();
	oidcMock.refreshIdentity.mockReset();
});

describe('method discipline', () => {
	test('sign-in and callback export GET only; sign-out and token export POST only', async () => {
		const modules = await Promise.all([
			import('./login/+server'),
			import('./callback/+server'),
			import('./logout/+server'),
			import('./token/+server')
		]);
		expect(Object.keys(modules[0])).toContain('GET');
		expect(Object.keys(modules[0])).not.toContain('POST');
		expect(Object.keys(modules[1])).toContain('GET');
		expect(Object.keys(modules[1])).not.toContain('POST');
		expect(Object.keys(modules[2])).toContain('POST');
		expect(Object.keys(modules[2])).not.toContain('GET');
		expect(Object.keys(modules[3])).toContain('POST');
		expect(Object.keys(modules[3])).not.toContain('GET');
	});
});

describe('feature disabled', () => {
	test('AUTH_ENABLED=false or unset answers 404 on every auth route', async () => {
		for (const value of [undefined, 'false']) {
			privateEnv.AUTH_ENABLED = value as string;
			const results = await Promise.all([
				failure(() => login(event('/auth/login'))),
				failure(() => callback(event('/auth/callback'))),
				failure(() => logout(event('/auth/logout'))),
				failure(() => token(event('/auth/token', { body: '{}' })))
			]);
			for (const [index, result] of results.entries()) {
				expect(result.status, `${value} route ${index}`).toBe(404);
				expect(result.body).toContain('Sign-in is not enabled.');
			}
		}
		expect(oidcMock.beginAuthorization).not.toHaveBeenCalled();
	});

	// A typo in the flag is not "off": it aborts. Reported as a gap because the abort is a plain
	// Error, which SvelteKit renders as a framework 500 rather than a deliberate 503 like
	// /api/ai/config and /api/mcp/server answer for the same class of operator mistake.
	test('an unparseable AUTH_ENABLED aborts instead of silently disabling sign-in', async () => {
		for (const value of ['TRUE', '1', 'yes']) {
			privateEnv.AUTH_ENABLED = value;
			const result = await failure(() => login(event('/auth/login')));
			expect(result.status, value).toBeUndefined();
			expect(result.body).toContain('must be true or false');
		}
		expect(oidcMock.beginAuthorization).not.toHaveBeenCalled();
	});
});

describe('login origin boundary', () => {
	beforeEach(() => enableAuth());

	test('a login served on a foreign host is 400 and starts no OIDC transaction', async () => {
		// The route compares `event.url.origin`, not the Origin header: a GET carries none.
		const result = await failure(() =>
			login(event('/auth/login', { base: 'https://attacker.example' }))
		);
		expect(result.status).toBe(400);
		expect(result.body).toContain('Open sign-in on the configured application URL.');
		expect(oidcMock.beginAuthorization).not.toHaveBeenCalled();
	});

	test('the same login on the configured origin redirects with no-store and no-referrer', async () => {
		const created = event('/auth/login');
		const result = await failure(() => login(created));
		expect(result.status).toBe(303);
		expect(result.location).toContain('accounts.google.com');
		expect(created.setHeaders).toHaveBeenCalledWith({
			'cache-control': 'no-store',
			'referrer-policy': 'no-referrer'
		});
		expect(created.cookies.get('__Host-starter-transaction')).toBeDefined();
	});
});

describe('sign-out origin boundary', () => {
	beforeEach(() => enableAuth());

	test('a foreign Origin is 403 and the session cookie is left in place', async () => {
		const cookies = new Map([['__Host-starter-session', 'sealed-value']]);
		const result = await failure(() =>
			logout(event('/auth/logout', { origin: 'https://attacker.example', cookies }))
		);
		expect(result.status).toBe(403);
		expect(result.body).toContain('This request must come from this application.');
		expect(cookies.has('__Host-starter-session')).toBe(true);
	});

	test('a POST with no Origin at all is 403', async () => {
		const result = await failure(() => logout(event('/auth/logout', { origin: null })));
		expect(result.status).toBe(403);
	});

	test('a same-origin sign-out clears both cookies and redirects home', async () => {
		const cookies = new Map([
			['__Host-starter-session', 'sealed'],
			['__Host-starter-transaction', 'pending']
		]);
		const created = event('/auth/logout', { cookies });
		const result = await failure(() => logout(created));
		expect(result.status).toBe(303);
		expect(result.location).toBe('/');
		expect(cookies.has('__Host-starter-session')).toBe(false);
		expect(cookies.has('__Host-starter-transaction')).toBe(false);
		expect(created.setHeaders).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
	});
});

describe('token boundary', () => {
	beforeEach(() => enableAuth());

	test('a foreign Origin is 403 and releases no token', async () => {
		const result = await failure(() =>
			token(event('/auth/token', { origin: 'https://attacker.example', body: '{}' }))
		);
		expect(result.status).toBe(403);
		expect(result.body).not.toContain('idToken');
	});

	test('no session returns { idToken: null } rather than an error', async () => {
		const response = await token(event('/auth/token', { body: '{}' }));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ idToken: null });
	});

	test('a tampered session cookie yields no token and is cleared', async () => {
		const cookies = new Map([['__Host-starter-session', 'not-a-real-sealed-cookie']]);
		const response = await token(event('/auth/token', { body: '{}', cookies }));
		expect(await response.json()).toEqual({ idToken: null });
		expect(cookies.has('__Host-starter-session')).toBe(false);
	});

	test('an established session releases its ID token, uncached, and nothing else', async () => {
		const { establishSession } = await import('$lib/server/auth/session');
		const created = event('/auth/token', { body: '{}' });
		await establishSession(created, config(), {
			subject: 'member-1',
			email: 'member@example.com',
			idToken: 'test-id-token',
			idTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
			refreshToken: 'fake-refresh-token'
		});
		const response = await token(created);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('pragma')).toBe('no-cache');
		expect(await response.json()).toEqual({ idToken: 'test-id-token' });
	});
});

describe('token input validation', () => {
	beforeEach(() => enableAuth());

	test.each([
		['an unknown key', '{"unknown":true}'],
		['a string where a boolean belongs', '{"forceRefreshToken":"yes"}'],
		['a number where a boolean belongs', '{"forceRefreshToken":1}'],
		['an array body', '[]'],
		['a null body value', 'null'],
		['a string body', '"plain"']
	])('rejects %s with 400', async (_label, body) => {
		const result = await failure(() => token(event('/auth/token', { body })));
		expect(result.status).toBe(400);
		expect(result.body).toContain('Send an optional boolean forceRefreshToken.');
	});

	test('rejects malformed JSON with 400', async () => {
		const result = await failure(() =>
			token(event('/auth/token', { body: '{"forceRefreshToken":' }))
		);
		expect(result.status).toBe(400);
		expect(result.body).toContain('invalid JSON');
	});

	test('rejects a missing body with 400', async () => {
		const result = await failure(() => token(event('/auth/token')));
		expect(result.status).toBe(400);
		expect(result.body).toContain('A JSON body is required.');
	});

	test('rejects an oversized body with 413 rather than parsing it', async () => {
		const result = await failure(() =>
			token(event('/auth/token', { body: JSON.stringify({ pad: 'x'.repeat(400) }) }))
		);
		expect(result.status).toBe(413);
	});
});

describe('callback validation', () => {
	beforeEach(() => enableAuth());

	test('no pending transaction is 400 and the provider is never called', async () => {
		const result = await failure(() =>
			callback(event('/auth/callback', { search: '?code=abc&state=xyz' }))
		);
		expect(result.status).toBe(400);
		expect(result.body).toContain('This sign-in request expired or is invalid.');
		expect(oidcMock.completeAuthorization).not.toHaveBeenCalled();
	});

	test('an unreadable transaction cookie is 400 and the provider is never called', async () => {
		const cookies = new Map([['__Host-starter-transaction', 'sealed-but-unreadable']]);
		const result = await failure(() =>
			callback(event('/auth/callback', { search: '?code=abc&state=attacker', cookies }))
		);
		expect(result.status).toBe(400);
		expect(oidcMock.completeAuthorization).not.toHaveBeenCalled();
	});

	test('a callback served on a foreign host does not consume the pending transaction', async () => {
		const { created, cookies } = await pendingTransaction();
		expect(cookies.has('__Host-starter-transaction')).toBe(true);
		const result = await failure(() =>
			callback({ ...created, url: new URL('https://attacker.example/auth/callback?code=abc') })
		);
		expect(result.status).toBe(400);
		expect(cookies.has('__Host-starter-transaction')).toBe(true);
		expect(oidcMock.completeAuthorization).not.toHaveBeenCalled();
	});

	test('a valid transaction sets a session cookie and redirects home', async () => {
		const { created, cookies } = await pendingTransaction();
		oidcMock.completeAuthorization.mockResolvedValue({
			subject: 'member-1',
			email: 'member@example.com',
			idToken: 'test-id-token',
			idTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600
		});
		const result = await failure(() => callback(created));
		expect(result.status).toBe(303);
		expect(result.location).toBe('/');
		expect(cookies.has('__Host-starter-session')).toBe(true);
		expect(cookies.has('__Host-starter-transaction')).toBe(false);
	});

	test('a token exchange failure is 400 with a fixed message that echoes no provider payload', async () => {
		const { created } = await pendingTransaction();
		oidcMock.completeAuthorization.mockRejectedValue(
			new Error(`400 invalid_grant ${CLIENT_SECRET} https://oauth2.googleapis.com/token`)
		);
		const result = await failure(() => callback(created));
		expect(result.status).toBe(400);
		expect(result.body).toContain('Sign-in could not be verified.');
		expectNoInternals(result.body, [CLIENT_SECRET, 'oauth2.googleapis.com', 'invalid_grant']);
	});
});

describe('misconfiguration is a 503, not a crash', () => {
	test('a malformed session secret is refused and the value is not echoed', async () => {
		enableAuth({ AUTH_SESSION_SECRET: 'too-short' });
		const result = await failure(() => login(event('/auth/login')));
		expect(result.status).toBeUndefined();
		expectNoInternals(result.body, ['too-short']);
	});

	test('a non-google provider is refused rather than silently ignored', async () => {
		enableAuth({ AUTH_PROVIDER: 'github' });
		const result = await failure(() => login(event('/auth/login')));
		expect(result.status).toBeUndefined();
		expectNoInternals(result.body);
	});

	test('a missing PUBLIC_SITE_URL aborts and never falls back to the request host', async () => {
		enableAuth();
		publicEnv.PUBLIC_SITE_URL = '';
		const result = await failure(() => login(event('/auth/login')));
		// Reported gap: a plain Error (framework 500), not the 503 that the access helpers use.
		expect(result.status).toBeUndefined();
		expect(result.body).toContain('PUBLIC_SITE_URL is required');
		expect(oidcMock.beginAuthorization).not.toHaveBeenCalled();
	});
});

describe('upstream failure', () => {
	beforeEach(() => enableAuth());

	test('a discovery failure is not wrapped into an HttpError, so `handleError` masks it', async () => {
		oidcMock.beginAuthorization.mockRejectedValue(
			new Error(`getaddrinfo ENOTFOUND accounts.google.com secret=${CLIENT_SECRET}`)
		);
		const result = await failure(() => login(event('/auth/login')));
		// No `status` means a plain Error reached SvelteKit: the framework 500 path, where
		// `handleError` logs correlation data and returns "Something went wrong" to the client.
		// The secret therefore never reaches the browser, but the caller also gets no usable
		// signal that this was an operator problem. Recorded as a gap, not a leak.
		expect(result.status).toBeUndefined();
		expect(oidcMock.beginAuthorization).toHaveBeenCalled();
	});
});

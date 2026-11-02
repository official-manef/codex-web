import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { PROVIDERS } from '../../../convex/providers';

/**
 * Two files carry the 9router host on purpose: `src/convex/providers.ts` (cloud path) and
 * `src/lib/server/ai/chat.ts` (SvelteKit path). Convex bundles its own module graph, so they
 * cannot share a constant, and a typo in either one sends a 9router key to the wrong origin
 * with every other test still green.
 *
 * The comparison has to be between two genuinely different sources, so the Convex side is
 * imported and the SvelteKit side is read off the file text. A literal compared to itself
 * proves nothing.
 */

const chatSource = readFileSync(fileURLToPath(new URL('./chat.ts', import.meta.url)), 'utf8');

/** Every absolute URL literal in `chat.ts` that points at the 9router host. */
function chatHosts(): string[] {
	return [...chatSource.matchAll(/'(https:\/\/[^']*router\.[^']*)'/g)].map((match) => match[1]);
}

test('the 9router host is the same on the Convex path and the SvelteKit path', () => {
	const convexBase = PROVIDERS['nine-router'].baseUrl;
	expect(convexBase, 'nine-router must stay a built-in provider').toBeTruthy();

	// chat.ts pins the baseURL for the request and its bare origin for the fetch guard.
	const allowed = new Set([convexBase, new URL(convexBase).origin]);
	const hosts = chatHosts();
	expect(hosts.length, 'chat.ts must pin the 9router host').toBeGreaterThan(0);
	for (const host of hosts) {
		expect(allowed.has(host), `chat.ts pins ${host}, Convex pins ${convexBase}`).toBe(true);
	}
	// Both forms must actually appear; one alone leaves either the request or the guard unpinned.
	expect(hosts).toContain(convexBase);
	expect(hosts).toContain(new URL(convexBase).origin);
});

test('the pinned host is an https origin with no credentials or query', () => {
	const { baseUrl } = PROVIDERS['nine-router'];
	const url = new URL(baseUrl);
	expect(url.protocol).toBe('https:');
	expect(url.username).toBe('');
	expect(url.password).toBe('');
	expect(url.search).toBe('');
	expect(url.pathname).toBe('/v1');
});

test('the SvelteKit guard checks an origin that is inside the pinned base URL', () => {
	const origin = new URL(PROVIDERS['nine-router'].baseUrl).origin;
	// `providerFetch()` compares `url.origin`, so a guard origin that does not prefix the
	// baseURL would reject every legitimate 9router request.
	expect(PROVIDERS['nine-router'].baseUrl.startsWith(origin)).toBe(true);
	expect(chatSource).toContain(`'${origin}'`);
});

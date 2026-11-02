import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { clearProviderKey, hasProviderKey, readProviderKey, saveProviderKey } from './byok_key';

/**
 * One module owns the tab's provider key: `saveProviderKey` writes it, `readProviderKey` reads it,
 * and nothing else stores it.
 *
 * The two failure modes these cases exist for:
 *   1. A key outliving its tab or being read from `localStorage`. Before the fix the chat screen
 *      did `readDraft('byok-key') || localStorage.getItem('byok-key')`, so a key persisted by an
 *      earlier build — or by any other script on this origin — was silently sent. Nothing wrote it
 *      back, so the only way a key got there was the leak itself.
 *   2. Two modules: the chat saved through one and read through another, so the key a user pasted
 *      was never the key that got sent and every server turn failed with "holds no key for this
 *      tab". `save` -> `read` is now the same module and the same store.
 */

const tab = vi.hoisted(() => ({
	session: new Map<string, string>(),
	local: new Map<string, string>()
}));

function storage(map: Map<string, string>) {
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		removeItem: (key: string) => void map.delete(key),
		get length() {
			return map.size;
		},
		key: (index: number) => [...map.keys()][index] ?? null,
		keys: () => [...map.keys()]
	};
}

vi.stubGlobal('window', { sessionStorage: storage(tab.session) });
vi.stubGlobal('sessionStorage', storage(tab.session));
vi.stubGlobal('localStorage', storage(tab.local));

beforeEach(() => {
	tab.session.clear();
	tab.local.clear();
});
afterEach(() => {
	tab.session.clear();
	tab.local.clear();
});

test('save then read is the same value, through the one module', () => {
	const input = 'sk-roundtrip-abcdef123456';
	expect(saveProviderKey(input)).toBe(true);
	expect(readProviderKey()).toBe(input);
	expect(hasProviderKey()).toBe(true);
	expect(readProviderKey(), 'second read must not consume or blank the key').toBe(input);
});

test('the key reaches the tab store the chat reads on reload', () => {
	saveProviderKey('sk-survives-reload-1234');
	expect(tab.session.get('laya-draft-v1:byok-key')).toBe(
		JSON.stringify({ version: 1, value: 'sk-survives-reload-1234' })
	);
});

test('a key in localStorage is never read', () => {
	tab.local.set('byok-key', 'test-token-not-a-secret');
	expect(readProviderKey()).toBe('');
	expect(hasProviderKey()).toBe(false);
});

test('surrounding whitespace is trimmed, not stored', () => {
	expect(saveProviderKey('  sk-test-0123456789\n')).toBe(true);
	expect(readProviderKey()).toBe('sk-test-0123456789');
});

test('a value the server would reject is refused and does not replace the stored key', () => {
	saveProviderKey('sk-test-0123456789');
	for (const bad of ['', '   ', 'short', 'has space in it', 'x'.repeat(4097), 42, null, undefined])
		expect(saveProviderKey(bad), String(bad)).toBe(false);
	expect(readProviderKey()).toBe('sk-test-0123456789');
});

test('clearing leaves no key and reads as absent', () => {
	saveProviderKey('sk-test-0123456789');
	clearProviderKey();
	expect(readProviderKey()).toBe('');
	expect(hasProviderKey()).toBe(false);
});

test('the empty state is a quiet empty string, never undefined', () => {
	expect(readProviderKey()).toBe('');
	expect(typeof readProviderKey()).toBe('string');
});

test('a non-string or malformed stored value is not sent as a key', () => {
	tab.session.set('laya-draft-v1:byok-key', JSON.stringify({ version: 1, value: 42 }));
	expect(readProviderKey()).toBe('');
	tab.session.set(
		'laya-draft-v1:byok-key',
		JSON.stringify({ version: 1, value: 'has spaces here' })
	);
	expect(readProviderKey()).toBe('');
});

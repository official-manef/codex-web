import { afterEach, expect, test, vi } from 'vitest';
import { readProviderKey, PROVIDER_KEY_DRAFT } from './byok_input';

/**
 * The chat screen must never read a provider key out of `localStorage`.
 *
 * Before the fix it did `readDraft('byok-key') || localStorage.getItem('byok-key')`: the second
 * half made a key persisted by any earlier build, or by any other script on this origin,
 * silently usable. Nothing in the UI wrote it back, so the only way a key got there was the
 * leak itself — which is exactly why reading it is worse than useless.
 */

const tab = vi.hoisted(() => ({
	session: new Map<string, string>(),
	local: new Map<string, string>()
}));

function storage(map: Map<string, string>) {
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		removeItem: (key: string) => void map.delete(key)
	};
}

vi.stubGlobal('window', { sessionStorage: storage(tab.session) });
vi.stubGlobal('sessionStorage', storage(tab.session));
vi.stubGlobal('localStorage', storage(tab.local));

afterEach(() => {
	tab.session.clear();
	tab.local.clear();
});

test('a key in localStorage is not read', () => {
	tab.local.set('byok-key', 'test-token-not-a-secret');
	expect(readProviderKey()).toBe('');
});

test('the old expression is what leaked: it returns the persisted key', () => {
	// Same shape the chat screen used:
	//   readDraft('byok-key', '') || localStorage.getItem('byok-key')
	// Kept as a live demonstration so this guard cannot be mistaken for cosmetics.
	tab.local.set('byok-key', 'test-token-not-a-secret');
	const draft: string = '';
	const old = draft || (tab.local.get('byok-key') ?? '');
	expect(old).toBe('test-token-not-a-secret');
	expect(readProviderKey()).not.toBe(old);
});

test('a key in this tab is read', () => {
	tab.session.set(
		`laya-draft-v1:${PROVIDER_KEY_DRAFT}`,
		JSON.stringify({ version: 1, value: 'test-token-not-a-secret' })
	);
	expect(readProviderKey()).toBe('test-token-not-a-secret');
});

test('a non-string draft value is not sent as a key', () => {
	tab.session.set(`laya-draft-v1:${PROVIDER_KEY_DRAFT}`, JSON.stringify({ version: 1, value: 42 }));
	expect(readProviderKey()).toBe('');
});

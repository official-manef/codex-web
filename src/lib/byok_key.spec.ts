import { beforeEach, expect, test } from 'vitest';
import { clearProviderKey, hasProviderKey, readProviderKey, saveProviderKey } from './byok_key';

/**
 * The key lives in module scope, so a stale value would leak across every later turn. These
 * cases exist because the failure mode is a credential outliving its tab or being forwarded
 * with a shape the server rejects.
 */

beforeEach(() => clearProviderKey());

test('a saved key is readable and reports presence', () => {
	expect(saveProviderKey('sk-test-0123456789')).toBe(true);
	expect(readProviderKey()).toBe('sk-test-0123456789');
	expect(hasProviderKey()).toBe(true);
});

test('surrounding whitespace is trimmed, not stored', () => {
	expect(saveProviderKey('  sk-test-0123456789\n')).toBe(true);
	expect(readProviderKey()).toBe('sk-test-0123456789');
});

test('a value the server would reject is refused and does not replace the held key', () => {
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

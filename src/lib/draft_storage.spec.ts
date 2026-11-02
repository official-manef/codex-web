import { expect, test } from 'vitest';
import { createDraftStore, type DraftStorage } from './draft_storage';

/**
 * Drafts are the only thing this app restores from storage without asking, and the key space is
 * writable by any script on the origin (or an older build). These pin the envelope check that
 * decides whether a stored value is restored, and that a blocked or full store loses the draft
 * instead of breaking the view.
 */

function store(
	initial: Record<string, string> = {},
	options: { throwsOn?: 'get' | 'set' | 'remove' } = {}
) {
	const map = new Map(Object.entries(initial));
	const storage: DraftStorage = {
		getItem: (key) => {
			if (options.throwsOn === 'get') throw new Error('blocked');
			return map.get(key) ?? null;
		},
		setItem: (key, value) => {
			if (options.throwsOn === 'set') throw new DOMException('full', 'QuotaExceededError');
			map.set(key, value);
		},
		removeItem: (key) => {
			if (options.throwsOn === 'remove') throw new Error('blocked');
			map.delete(key);
		}
	};
	return { map, storage };
}

const drafts = (prefix: string | null = 'd:') =>
	createDraftStore({
		prefix: () => prefix,
		defaultStorage: () => undefined,
		maxChars: 100,
		maxKeyChars: 10
	});

test('a saved value round-trips through its versioned envelope', () => {
	const { map, storage } = store();
	const store_ = drafts();
	expect(store_.save('key', { text: 'hello' }, storage)).toBe(true);
	expect(store_.read('key', null, storage)).toEqual({ text: 'hello' });
	// The envelope is what makes an older shape recognisable rather than silently trusted.
	expect(JSON.parse(map.get('d:key')!)).toEqual({ version: 1, value: { text: 'hello' } });
});

test('a foreign-version or valueless envelope is refused, a bare value is read as version 0', () => {
	const cases: Record<string, string> = {
		'version 2': '{"version":2,"value":"hello"}',
		'value missing': '{"version":1}',
		'value undefined key': '{"version":1,"value":null}'
	};
	for (const [label, raw] of Object.entries(cases)) {
		const { storage } = store({ 'd:key': raw });
		// `value: null` is a stored value, not an absent one; the other two are refused.
		const expected = label === 'value undefined key' ? null : 'fallback';
		expect(drafts().read('key', 'fallback', storage), label).toEqual(expected);
	}

	// A bare value with no envelope is version 0, and the chat draft's bare value *is* an object.
	// Reading it as corruption would lose every draft written before the envelope existed.
	const { storage } = store({ 'd:key': '{"text":"hello"}' });
	expect(drafts().read('key', 'fallback', storage)).toEqual({ text: 'hello' });
});

test('an unparseable, empty or oversized raw value falls back without throwing', () => {
	for (const raw of ['', 'not json', '{"version":1,"value":"' + 'x'.repeat(200) + '"}']) {
		const { storage } = store({ 'd:key': raw });
		expect(drafts().read('key', 'fallback', storage), raw.slice(0, 12)).toBe('fallback');
	}
});

test('a null prefix disables persistence in both directions', () => {
	const { map, storage } = store();
	const disabled = drafts(null);
	// No scope means no key: a hosted draft must not be written before the identity is known.
	expect(disabled.save('key', 'value', storage)).toBe(false);
	expect(map.size).toBe(0);
	const { storage: preexisting } = store({ 'd:key': '{"version":1,"value":"x"}' });
	expect(disabled.read('key', 'fallback', preexisting)).toBe('fallback');
});

test('an oversized value or key is refused rather than truncated', () => {
	const { map, storage } = store();
	expect(drafts().save('key', 'x'.repeat(200), storage)).toBe(false);
	expect(map.size).toBe(0);
	expect(drafts().save('k'.repeat(11), 'v', storage)).toBe(false);
	expect(map.size).toBe(0);
	// Boundaries are inclusive.
	expect(drafts().save('k'.repeat(10), 'v', storage)).toBe(true);
});

test('a blocked read, write or clear loses the draft instead of surfacing an error', () => {
	const blockedRead = store({}, { throwsOn: 'get' });
	expect(drafts().read('key', 'fallback', blockedRead.storage)).toBe('fallback');
	const blockedWrite = store({}, { throwsOn: 'set' });
	expect(drafts().save('key', 'v', blockedWrite.storage)).toBe(false);
	const blockedRemove = store({ 'd:key': 'x' }, { throwsOn: 'remove' });
	expect(() => drafts().clear('key', blockedRemove.storage)).not.toThrow();
	// The key survives a refused clear, so the next load still sees the old draft.
	expect(blockedRemove.map.get('d:key')).toBe('x');
	// A read-only block does not make writes fail, and vice versa: the store is not memoised.
	expect(drafts().save('key', 'v', blockedRead.storage)).toBe(true);
});

test('save refuses when there is no storage at all, rather than reporting success', () => {
	const { storage } = store();
	const unset = createDraftStore({
		prefix: () => 'd:',
		defaultStorage: () => undefined,
		maxChars: 100,
		maxKeyChars: 10
	});
	expect(unset.save('key', 'v')).toBe(false);
	expect(unset.read('key', 'fallback')).toBe('fallback');
	// An explicit storage wins over the absent default.
	expect(unset.save('key', 'v', storage)).toBe(true);
});

test('clear removes only its own key and is silent with a null prefix', () => {
	const { map, storage } = store({ 'd:key': '{"version":1,"value":"x"}', 'd:other': 'keep' });
	drafts().clear('key', storage);
	expect(map.has('d:key')).toBe(false);
	expect(map.get('d:other')).toBe('keep');
	// A null scope leaves keys from the scoped session readable by whoever holds them.
	drafts(null).clear('other', storage);
	expect(map.get('d:other')).toBe('keep');
});

test('a stored value is returned by reference, so the caller owns what it gets', () => {
	const { storage } = store();
	const value = { list: [1, 2] };
	drafts().save('key', value, storage);
	const read = drafts().read<typeof value | null>('key', null, storage);
	expect(read).toEqual(value);
	expect(read).not.toBe(value);
	// It is a fresh parse, not the object the caller saved, so mutating one does not affect
	// the stored envelope.
	read!.list.push(3);
	expect(drafts().read('key', null, storage)).toEqual(value);
});

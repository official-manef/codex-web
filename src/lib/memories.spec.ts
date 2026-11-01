import { beforeEach, expect, test } from 'vitest';
import {
	MAX_CONTEXT_CHARS,
	MAX_MEMORIES,
	MAX_TEXT_CHARS,
	cleanText,
	createMemoryStore
} from './memories';
import type { DraftStorage } from './draft_storage';

/**
 * Memory notes use user-writable localStorage, making every read a validation boundary.
 * These tests verify the limits, whitespace sanitisation, shape validation, and context
 * formatting under normal, boundary, and hostile storage conditions.
 */

class Memory implements DraftStorage {
	private rows = new Map<string, string>();
	getItem(key: string) {
		return this.rows.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.rows.set(key, value);
	}
	removeItem(key: string) {
		this.rows.delete(key);
	}
	/** Direct handle for writing values the module itself would never write. */
	seed(key: string, value: string) {
		this.rows.set(key, value);
	}
}

let store: Memory;

beforeEach(() => {
	store = new Memory();
	Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
});

const MEMORIES_KEY = 'codex-web:memories:v1';

test('add/list round trip and whitespace normalisation', () => {
	const memories = createMemoryStore();
	const created = memories.add('  User prefers   dark mode\nand   tabs.  ');
	expect(created).not.toBeNull();
	expect(created?.text).toBe('User prefers dark mode and tabs.');
	expect(created?.id).toMatch(/^memory-[a-z0-9]+-[a-z0-9]+$/);
	expect(typeof created?.createdAt).toBe('number');
	expect(created!.createdAt).toBeGreaterThan(0);

	const all = memories.all();
	expect(all).toHaveLength(1);
	expect(all[0]).toEqual(created);
});

test('rejection of empty, oversized and non-string text', () => {
	expect(cleanText('  collapsed   spaces  ')).toBe('collapsed spaces');
	expect(cleanText('')).toBeNull();
	expect(cleanText('   \n\t  ')).toBeNull();
	expect(cleanText('x'.repeat(MAX_TEXT_CHARS + 1))).toBeNull();
	expect(cleanText(42)).toBeNull();
	expect(cleanText(null)).toBeNull();
	expect(cleanText(undefined)).toBeNull();
	expect(cleanText({})).toBeNull();

	const exactLimit = 'x'.repeat(MAX_TEXT_CHARS);
	expect(cleanText(exactLimit)).toBe(exactLimit);

	const memories = createMemoryStore();
	expect(memories.add('')).toBeNull();
	expect(memories.add('   ')).toBeNull();
	expect(memories.add('x'.repeat(MAX_TEXT_CHARS + 1))).toBeNull();
	expect(memories.all()).toEqual([]);
});

test('MAX_MEMORIES ceiling is enforced without dropping existing items', () => {
	const memories = createMemoryStore();
	for (let index = 0; index < MAX_MEMORIES; index += 1) {
		expect(memories.add(`Note ${index}`)).not.toBeNull();
	}
	expect(memories.add('one note too many')).toBeNull();
	expect(memories.all()).toHaveLength(MAX_MEMORIES);
});

test('corrupt JSON and non-array storage yield an empty list', () => {
	store.seed(MEMORIES_KEY, 'not json at all');
	expect(createMemoryStore().all()).toEqual([]);

	store.seed(MEMORIES_KEY, JSON.stringify({ not: 'an array' }));
	expect(createMemoryStore().all()).toEqual([]);

	store.seed(MEMORIES_KEY, JSON.stringify(42));
	expect(createMemoryStore().all()).toEqual([]);

	store.seed(MEMORIES_KEY, JSON.stringify(null));
	expect(createMemoryStore().all()).toEqual([]);
});

test('remove and clear work as expected and handle nonexistent ids', () => {
	const memories = createMemoryStore();
	const first = memories.add('First note')!;
	const second = memories.add('Second note')!;

	expect(memories.remove(first.id)).toBe(true);
	expect(memories.all().map((m) => m.text)).toEqual(['Second note']);

	expect(memories.remove(first.id)).toBe(false);
	expect(memories.remove('memory-ghost-id')).toBe(false);

	expect(memories.remove(second.id)).toBe(true);
	expect(memories.all()).toEqual([]);

	memories.add('Third note');
	expect(memories.clear()).toBe(true);
	expect(memories.all()).toEqual([]);
});

test('remove, clear and add report failure when storage throws', () => {
	const memories = createMemoryStore();
	memories.add('Existing note');

	Object.defineProperty(globalThis, 'localStorage', {
		value: {
			getItem: () => store.getItem(MEMORIES_KEY),
			setItem: () => {
				throw new Error('QuotaExceededError');
			},
			removeItem: () => {}
		},
		configurable: true
	});

	const failStore = createMemoryStore();
	const existing = failStore.all()[0];
	expect(failStore.add('Another note')).toBeNull();
	expect(failStore.remove(existing.id)).toBe(false);
	expect(failStore.clear()).toBe(false);
});

test('membership of a hand-seeded invalid row is dropped on read', () => {
	store.seed(
		MEMORIES_KEY,
		JSON.stringify([
			{ id: 'm-valid', text: 'Valid note', createdAt: 100 },
			{ id: 'm-number', text: 42, createdAt: 101 },
			{ id: 'm-empty', text: '   ', createdAt: 102 },
			{ id: '', text: 'Missing id', createdAt: 103 },
			{ id: 'm-valid', text: 'Duplicate id', createdAt: 104 },
			{ id: 'm-oversized', text: 'x'.repeat(MAX_TEXT_CHARS + 1), createdAt: 105 },
			'not an object',
			null
		])
	);

	const memories = createMemoryStore().all();
	expect(memories).toEqual([{ id: 'm-valid', text: 'Valid note', createdAt: 100 }]);
});

test('context() is bounded by maxChars, contains each text, and returns empty string when empty', () => {
	const memories = createMemoryStore();
	expect(memories.context()).toBe('');
	expect(memories.context(50)).toBe('');

	memories.add('User prefers TypeScript');
	memories.add('Prefers dark theme');
	memories.add('Keep explanations brief');

	const fullContext = memories.context();
	expect(fullContext).toBe(
		'- User prefers TypeScript\n- Prefers dark theme\n- Keep explanations brief'
	);
	expect(fullContext).toContain('User prefers TypeScript');
	expect(fullContext).toContain('Prefers dark theme');
	expect(fullContext).toContain('Keep explanations brief');
	expect(fullContext.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);

	// Fits only the first line ('- User prefers TypeScript' is 25 chars)
	const bounded = memories.context(30);
	expect(bounded).toBe('- User prefers TypeScript');
	expect(bounded.length).toBeLessThanOrEqual(30);

	// Fits first two lines (25 + 1 + 20 = 46 chars)
	const twoLines = memories.context(46);
	expect(twoLines).toBe('- User prefers TypeScript\n- Prefers dark theme');
	expect(twoLines.length).toBeLessThanOrEqual(46);

	// Not enough space for even the first line
	expect(memories.context(10)).toBe('');
	expect(memories.context(0)).toBe('');
	expect(memories.context(-5)).toBe('');
});

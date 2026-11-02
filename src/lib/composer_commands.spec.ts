import { expect, test } from 'vitest';
import {
	composerCommandQuery,
	matchingComposerResources,
	nextComposerSelection,
	replaceComposerCommand
} from './composer_commands';

test('nextComposerSelection always answers with a real index or -1', () => {
	// Fuzz regression (`src/lib/fuzz.spec.ts`). The old modulo arithmetic indexed rows that
	// do not exist: `(-5 + 1 + -1) % -1` produced `-0` and `Enter` produced `-2`, both of
	// which the caller uses as array indexes.
	expect(Object.is(nextComposerSelection(-5, 'ArrowDown', -1), -1)).toBe(true);
	expect(nextComposerSelection(-5, 'ArrowDown', -1)).toBe(-1);
	expect(nextComposerSelection(-5, 'Enter', -1)).toBe(-1);
	expect(nextComposerSelection(0, 'ArrowUp', -1)).toBe(-1);
	// A usable count always yields a row inside it, whatever the incoming cursor.
	expect(nextComposerSelection(-5, 'ArrowDown', 4)).toBe(4 % 4 === 0 ? 0 : 0);
	expect(nextComposerSelection(-2, 'ArrowUp', 4)).toBe(1);
	expect(nextComposerSelection(9, 'Enter', 4)).toBe(1);
	for (const count of [1, 2, 5])
		for (const current of [-9, -1, 0, 3, 99])
			for (const key of ['ArrowDown', 'ArrowUp', 'Enter']) {
				const next = nextComposerSelection(current, key, count);
				expect(Number.isInteger(next)).toBe(true);
				expect(next).toBeGreaterThanOrEqual(0);
				expect(next).toBeLessThan(count);
			}
	// Nothing selected stays nothing selected, and a fractional count is not a list.
	expect(nextComposerSelection(0, 'ArrowDown', 0)).toBe(-1);
	expect(nextComposerSelection(0, 'ArrowDown', 2.5)).toBe(-1);
});

test('a command query is the token immediately before the caret', () => {
	expect(composerCommandQuery('hi /mod', 7)).toEqual({ marker: '/', start: 3, end: 7, query: 'mod' });
	// An email or a URL is text, not a command.
	expect(composerCommandQuery('mail me@example.com', 18)).toBeNull();
	expect(composerCommandQuery('see https://exa', 16)).toBeNull();
	// A stale or invalid caret is refused rather than slicing a different token.
	expect(composerCommandQuery('/abc', -1)).toBeNull();
	expect(composerCommandQuery('/abc', 1.5)).toBeNull();
	expect(composerCommandQuery('/abc', 2, 3)).toBeNull();
});

test('replacement is refused when the token no longer matches the text', () => {
	const token = composerCommandQuery('/mod', 4)!;
	expect(replaceComposerCommand('/mod', token, 'Model')).toEqual({
		text: 'Model',
		caret: 5,
		replaced: true
	});
	// The token moved: the same caret now points at a different offset, so refusing is the
	// only safe answer. The old code deleted whatever happened to sit at the stale offsets.
	expect(replaceComposerCommand('ab/mod', token, 'Model')).toEqual({
		text: 'ab/mod',
		caret: 4,
		replaced: false
	});
});

test('matching resources are ranked, de-duplicated and capped', () => {
	const resources = [
		{ id: 'a', label: 'Search', kind: 'tool' as const },
		{ id: 'b', label: 'Search the web', kind: 'tool' as const },
		{ id: 'c', label: 'Unrelated', kind: 'tool' as const, description: 'search' }
	];
	expect(matchingComposerResources(resources, 'search').map((item) => item.id)).toEqual([
		'a',
		'b',
		'c'
	]);
	expect(matchingComposerResources(resources, 'search', 1)).toHaveLength(1);
	// A non-finite maximum yields no rows rather than the whole catalogue.
	expect(matchingComposerResources(resources, 'search', Number.NaN)).toEqual([]);
	expect(matchingComposerResources(resources, 'nothing here')).toEqual([]);
});

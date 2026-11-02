import { expect, test } from 'vitest';
import {
	composerCommandQuery,
	matchingComposerResources,
	nextComposerSelection,
	replaceComposerCommand,
	toggleAvailableTool,
	type ComposerResource
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
	expect(composerCommandQuery('hi /mod', 7)).toEqual({
		marker: '/',
		start: 3,
		end: 7,
		query: 'mod'
	});
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

/**
 * The composer decides where a `/command` or `@mention` starts and ends, and what happens when
 * the text under it has moved. The contract these pin is the one `Chat.svelte` and
 * `ChatTools.svelte` rely on: only a token that begins the text or follows whitespace is a
 * command, and a stale token must not delete text it did not author.
 */

const at = (text: string) => text.length;

test('a marker at the start of the text is a command with an empty query', () => {
	expect(composerCommandQuery('/', at('/'))).toEqual({ marker: '/', start: 0, end: 1, query: '' });
	expect(composerCommandQuery('@', at('@'))).toEqual({ marker: '@', start: 0, end: 1, query: '' });
});

test('both markers are recognised, and the query is the text between the marker and the caret', () => {
	expect(composerCommandQuery('/he', at('/he'))).toEqual({
		marker: '/',
		start: 0,
		end: 3,
		query: 'he'
	});
	expect(composerCommandQuery('@to', at('@to'))).toEqual({
		marker: '@',
		start: 0,
		end: 3,
		query: 'to'
	});
	// Only the token that touches the caret counts, not an earlier one.
	expect(composerCommandQuery('/one two /th', at('/one two /th'))).toEqual({
		marker: '/',
		start: 9,
		end: 12,
		query: 'th'
	});
});

test('the marker may follow whitespace, including a newline or a tab', () => {
	expect(composerCommandQuery('hi /cmd', at('hi /cmd'))).toMatchObject({ start: 3, query: 'cmd' });
	expect(composerCommandQuery('hi\n/cmd', at('hi\n/cmd'))).toMatchObject({
		start: 3,
		query: 'cmd'
	});
	expect(composerCommandQuery('hi\t@cmd', at('hi\t@cmd'))).toMatchObject({
		start: 3,
		query: 'cmd'
	});
});

test('a marker inside a word is plain text, so an email or a url stays typeable', () => {
	for (const text of [
		'me@example.com',
		'https://example.com/a',
		'a/b',
		'see@',
		'path/to/file',
		'1/2',
		'C:\\Users\\rahma',
		'@scope/pkg'
	]) {
		expect(composerCommandQuery(text, at(text)), text).toBeNull();
	}
});

test('a trailing space ends the command instead of widening it', () => {
	expect(composerCommandQuery('/cmd ', at('/cmd '))).toBeNull();
	expect(composerCommandQuery('/cmd  more', at('/cmd  more'))).toBeNull();
	expect(composerCommandQuery(' /', 2)).toEqual({ marker: '/', start: 1, end: 2, query: '' });
	// With the caret before the marker there is no token yet.
	expect(composerCommandQuery(' /', 1)).toBeNull();
});

test('a second marker inside the token means there is no command', () => {
	// `/a/b` is a path, not a command named `a/b`; `/a@b` is neither marker's token.
	expect(composerCommandQuery('/a/b', at('/a/b'))).toBeNull();
	expect(composerCommandQuery('/a@b', at('/a@b'))).toBeNull();
});

test('an unknown command is still parsed: the parser does not own the command list', () => {
	// This is why the picker can show "no matches" and the user keeps their text.
	expect(composerCommandQuery('/notacommand', at('/notacommand'))).toMatchObject({
		marker: '/',
		query: 'notacommand'
	});
});

test('the caret decides the token, so text after the caret is not part of the query', () => {
	const text = '/he world';
	expect(composerCommandQuery(text, 3)).toEqual({ marker: '/', start: 0, end: 3, query: 'he' });
	// Caret after the space: the token no longer touches the caret.
	expect(composerCommandQuery(text, 4)).toBeNull();
	// A caret in the middle of `world` still sees no marker.
	expect(composerCommandQuery(text, 8)).toBeNull();
});

test('a quoted argument is not swallowed into the command: the space ends it', () => {
	const text = '/search "two words"';
	expect(composerCommandQuery(text, 7)).toMatchObject({ start: 0, end: 7, query: 'search' });
	// With the caret inside the quote the whole thing is plain text.
	expect(composerCommandQuery(text, 10)).toBeNull();
	expect(composerCommandQuery(text, at(text))).toBeNull();
});

test('a backslash is not an escape character, so it stays in the query', () => {
	expect(composerCommandQuery('/a\\', 3)).toEqual({ marker: '/', start: 0, end: 3, query: 'a\\' });
	expect(composerCommandQuery('/a\\b', at('/a\\b'))).toEqual({
		marker: '/',
		start: 0,
		end: 4,
		query: 'a\\b'
	});
	// A backslash does not escape the space that ends the token; what follows is plain text.
	expect(composerCommandQuery('/a\\ b', 4)).toBeNull();
	expect(composerCommandQuery('/a\\ b', 5)).toBeNull();
});

test('the query is capped at 80 characters, and only at the boundary', () => {
	const eighty = '/'.padEnd(81, 'a');
	expect(composerCommandQuery(eighty, at(eighty))).toMatchObject({ query: 'a'.repeat(80) });
	const eightyOne = '/'.padEnd(82, 'a');
	expect(composerCommandQuery(eightyOne, at(eightyOne))).toBeNull();
});

test('unicode in a query is kept verbatim, including a combining accent and an emoji', () => {
	expect(composerCommandQuery('/café', at('/café'))).toMatchObject({ query: 'café' });
	expect(composerCommandQuery('/cafe\u0301', at('/cafe\u0301'))).toMatchObject({
		query: 'cafe\u0301'
	});
	expect(composerCommandQuery('/résumé', at('/résumé'))).toMatchObject({ query: 'résumé' });
	expect(composerCommandQuery('/😀', at('/😀'))).toMatchObject({ query: '😀' });
	// A non-ASCII lookalike is not the ASCII marker.
	expect(composerCommandQuery('／cmd', at('／cmd'))).toBeNull();
});

test('an impossible caret or an active selection is refused rather than clamped', () => {
	expect(composerCommandQuery('/cmd', -1)).toBeNull();
	expect(composerCommandQuery('/cmd', 5)).toBeNull();
	expect(composerCommandQuery('/cmd', 1.5)).toBeNull();
	expect(composerCommandQuery('/cmd', Number.NaN)).toBeNull();
	// A selection means "replace this range", not "complete a command".
	expect(composerCommandQuery('/cmd', 4, 2)).toBeNull();
	expect(composerCommandQuery('/cmd', 4, 4)).not.toBeNull();
});

test('replaceComposerCommand swaps only the token and leaves the rest of the draft intact', () => {
	const text = '/he world';
	const token = composerCommandQuery(text, 3)!;
	expect(replaceComposerCommand(text, token)).toEqual({ text: ' world', caret: 0, replaced: true });
	const replaced = replaceComposerCommand(text, token, '/help');
	expect(replaced).toEqual({ text: '/help world', caret: 5, replaced: true });
	// The caret lands after the inserted text, before the preserved suffix.
	expect(replaced.text.slice(0, replaced.caret)).toBe('/help');
});

test('replaceComposerCommand is a no-op when the token it was given no longer exists', () => {
	const token = composerCommandQuery('/he', 3)!;
	// The user typed inside the token: the query at the caret is no longer the one held.
	expect(replaceComposerCommand('/ahe', token, '/help')).toEqual({
		text: '/ahe',
		caret: 3,
		replaced: false
	});
	// The marker itself was deleted.
	expect(replaceComposerCommand('he', token, '/help')).toEqual({
		text: 'he',
		caret: 2,
		replaced: false
	});
	// The token start moved because a character was inserted before it.
	expect(replaceComposerCommand(' /he', token, '/help')).toMatchObject({
		replaced: false,
		text: ' /he'
	});
	// Text typed after the caret is not part of the token, so it is not evidence of staleness —
	// and it stays exactly where it was, beyond the inserted replacement.
	expect(replaceComposerCommand('/hello', token, '/help')).toEqual({
		text: '/helpllo',
		caret: 5,
		replaced: true
	});
});

test('replaceComposerCommand refuses a token whose range is not what it holds', () => {
	const text = '/ab';
	const token = composerCommandQuery(text, 3)!;
	expect(replaceComposerCommand(text, { ...token, start: 0, query: 'a' }, 'x')).toMatchObject({
		replaced: false,
		text
	});
	expect(replaceComposerCommand(text, { ...token, marker: '@' }, 'x')).toMatchObject({
		replaced: false
	});
	expect(replaceComposerCommand(text, { ...token, query: '' }, 'x')).toMatchObject({
		replaced: false
	});
});

test('replaceComposerCommand clamps the caret when the token ends past the text', () => {
	const token = { marker: '/' as const, start: 0, end: 99, query: 'gone' };
	expect(replaceComposerCommand('short', token, 'x')).toEqual({
		text: 'short',
		caret: 5,
		replaced: false
	});
});

test('replaceComposerCommand can insert at the caret without deleting the suffix', () => {
	const text = '/go now';
	const token = composerCommandQuery(text, 3)!;
	expect(replaceComposerCommand(text, token, '/google_search')).toEqual({
		text: '/google_search now',
		caret: 14,
		replaced: true
	});
});

const resources: ComposerResource[] = [
	{ id: 'a', label: 'Google', kind: 'plugin', description: 'Search the web' },
	{ id: 'b', label: 'Google Drive', kind: 'connection' },
	{ id: 'c', label: 'Mail', kind: 'plugin', description: 'Find google messages' },
	{ id: 'd', label: 'Web search', kind: 'tool', toolName: 'google' },
	{ id: 'e', label: 'Snake', kind: 'mode', mode: 'chat' }
];

test('matching ranks an exact label above a prefix, a substring, and a description hit', () => {
	expect(matchingComposerResources(resources, 'google').map((item) => item.id)).toEqual([
		'a',
		'b',
		'c'
	]);
	// Case does not matter: the needle and the label are both lowercased.
	expect(matchingComposerResources(resources, 'Google').map((item) => item.id)).toEqual([
		'a',
		'b',
		'c'
	]);
	// A label hit outranks a description-only hit, whatever the source order.
	const mixed: ComposerResource[] = [
		{ id: 'desc', label: 'Zeta', kind: 'tool', description: 'mentions atlas' },
		{ id: 'label', label: 'Atlas', kind: 'tool' }
	];
	expect(matchingComposerResources(mixed, 'atlas').map((item) => item.id)).toEqual([
		'label',
		'desc'
	]);
	// `kind` is searchable too: `mode` finds the mode item by its type.
	expect(matchingComposerResources(resources, 'mode').map((item) => item.id)).toEqual(['e']);
});

test('matching drops a resource that only exists, and keeps source order for equal ranks', () => {
	expect(matchingComposerResources(resources, 'zzz')).toEqual([]);
	expect(matchingComposerResources(resources, 'o').map((item) => item.id)).toEqual([
		'a',
		'b',
		'c',
		'd',
		'e'
	]);
	// A rank is not a match quality the caller can see; equal ranks keep insertion order.
	const tied: ComposerResource[] = [
		{ id: 'one', label: 'Alpha one', kind: 'tool' },
		{ id: 'two', label: 'Alpha two', kind: 'tool' }
	];
	expect(matchingComposerResources(tied, 'alpha').map((item) => item.id)).toEqual(['one', 'two']);
	expect(matchingComposerResources([...tied].reverse(), 'alpha').map((item) => item.id)).toEqual([
		'two',
		'one'
	]);
});

test('an empty or whitespace query returns everything in source order', () => {
	expect(matchingComposerResources(resources, '').map((item) => item.id)).toEqual([
		'a',
		'b',
		'c',
		'd',
		'e'
	]);
	expect(matchingComposerResources(resources, '   ').map((item) => item.id)).toEqual([
		'a',
		'b',
		'c',
		'd',
		'e'
	]);
});

test('matching caps the result, never at zero and never above 24', () => {
	const many: ComposerResource[] = Array.from({ length: 40 }, (_, index) => ({
		id: `r${index}`,
		label: `Resource ${index}`,
		kind: 'tool'
	}));
	expect(matchingComposerResources(many, 'resource', 5)).toHaveLength(5);
	expect(matchingComposerResources(many, 'resource', 0)).toHaveLength(1);
	expect(matchingComposerResources(many, 'resource', -3)).toHaveLength(1);
	expect(matchingComposerResources(many, 'resource', 1000)).toHaveLength(24);
	expect(matchingComposerResources(many, 'resource')).toHaveLength(12);
	// A fractional cap is not rounded up past the requested count.
	expect(matchingComposerResources(many, 'resource', 2.7)).toHaveLength(2);
});

test('matching folds case with the runtime locale rather than a fixed one', () => {
	// ASCII folds identically in every locale.
	expect(
		matchingComposerResources([{ id: 'x', label: 'INVOICES', kind: 'tool' }], 'invoices')
	).toHaveLength(1);
	// A non-ASCII capital is folded, not compared literally, so the tail still matches.
	const dotted: ComposerResource[] = [{ id: 'i', label: 'İstanbul', kind: 'mode' }];
	expect(matchingComposerResources(dotted, 'stanbul')).toHaveLength(1);
	// Documented ceiling: `toLocaleLowerCase()` with no argument follows the runtime's default
	// locale, so under `tr` that label folds to `istanbul` and the pairing differs from `en`.
	// Pinned as a caveat rather than changed: command search is a local convenience, and
	// forcing `en` would break the opposite way for a Turkish user typing their own label.
});

test('matching does not mutate or reorder the input array', () => {
	const input = [...resources];
	const snapshot = input.map((item) => item.id);
	matchingComposerResources(input, 'google');
	expect(input.map((item) => item.id)).toEqual(snapshot);
});

test('toggleAvailableTool refuses a selection from a different or empty connection', () => {
	expect(() => toggleAvailableTool([], '', '', ['run'], 'run', true, 4)).toThrow(
		/The tool list changed/
	);
	expect(() => toggleAvailableTool([], 'alpha', 'beta', ['run'], 'run', true, 4)).toThrow(
		/The tool list changed/
	);
	expect(() => toggleAvailableTool([], 'alpha', 'alpha', ['run'], 'gone', true, 4)).toThrow(
		/The tool list changed/
	);
});

test('toggleAvailableTool adds the connection-scoped id and never mutates the input', () => {
	const selected = ['alpha::first'];
	const next = toggleAvailableTool(
		selected,
		'alpha',
		'alpha',
		['first', 'second'],
		'second',
		true,
		4
	);
	expect(next).toEqual(['alpha::first', 'alpha::second']);
	expect(selected).toEqual(['alpha::first']);
});

test('toggleAvailableTool disables by removing the id, whatever the limit says', () => {
	expect(
		toggleAvailableTool(['alpha::a', 'alpha::b'], 'alpha', 'alpha', ['a', 'b'], 'a', false, 1)
	).toEqual(['alpha::b']);
	// Removing a tool that was never selected is not an error, even with an unusable limit.
	expect(
		toggleAvailableTool(['alpha::b'], 'alpha', 'alpha', ['a', 'b'], 'a', false, undefined)
	).toEqual(['alpha::b']);
	// The same name on another connection is untouched.
	expect(toggleAvailableTool(['beta::a'], 'alpha', 'alpha', ['a'], 'a', false, 4)).toEqual([
		'beta::a'
	]);
});

test('toggleAvailableTool at the limit refuses instead of silently dropping the oldest choice', () => {
	expect(() =>
		toggleAvailableTool(['alpha::a', 'alpha::b'], 'alpha', 'alpha', ['a', 'b', 'c'], 'c', true, 2)
	).toThrow(/Choose up to 2 tools/);
	// Re-selecting an already selected tool is a copy, not a limit error, and not the same array.
	const selected = ['alpha::a'];
	const again = toggleAvailableTool(selected, 'alpha', 'alpha', ['a'], 'a', true, 1);
	expect(again).toEqual(['alpha::a']);
	expect(again).not.toBe(selected);
});

test('toggleAvailableTool refuses a limit it cannot trust rather than guessing one', () => {
	for (const maximum of [undefined, null, '4', 0, -1, 2.5, Number.NaN, Infinity]) {
		expect(
			() => toggleAvailableTool([], 'alpha', 'alpha', ['a'], 'a', true, maximum),
			String(maximum)
		).toThrow(/Tool limits are unavailable/);
	}
});

test('nextComposerSelection wraps in both directions and clamps every other key', () => {
	expect(nextComposerSelection(0, 'ArrowDown', 3)).toBe(1);
	expect(nextComposerSelection(2, 'ArrowDown', 3)).toBe(0);
	expect(nextComposerSelection(0, 'ArrowUp', 3)).toBe(2);
	expect(nextComposerSelection(1, 'ArrowUp', 3)).toBe(0);
	// Enter, Tab and a letter wrap the highlighted row the same way the arrows do: the new
	// contract normalises into range rather than clamping, so 9 of 3 is row 0, not row 2.
	expect(nextComposerSelection(0, 'Enter', 3)).toBe(0);
	expect(nextComposerSelection(9, 'Enter', 3)).toBe(0);
	expect(nextComposerSelection(-2, 'Enter', 3)).toBe(1);
	expect(nextComposerSelection(1, 'PageDown', 3)).toBe(1);
});

test('nextComposerSelection with an empty list is -1 for every key', () => {
	for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
		expect(nextComposerSelection(0, key, 0), key).toBe(-1);
	}
	expect(nextComposerSelection(0, 'ArrowDown', 1)).toBe(0);
	expect(nextComposerSelection(0, 'ArrowUp', 1)).toBe(0);
});

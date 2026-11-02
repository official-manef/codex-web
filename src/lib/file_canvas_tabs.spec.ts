import { expect, test } from 'vitest';
import { closeFileTab, openFileTab } from './file_canvas_tabs';

/**
 * The canvas holds one tab per file the user opened, and closing the selected tab decides what
 * is on screen next. These are about identity and neighbour choice, not about array shapes.
 */

type Tab = { id: string };
const a: Tab = { id: 'a' };
const b: Tab = { id: 'b' };
const c: Tab = { id: 'c' };

test('openFileTab appends a new file, and returns a copy for an already open one', () => {
	const opened = openFileTab([a], b);
	expect(opened).toEqual([a, b]);
	const again = openFileTab(opened, a);
	expect(again).toEqual([a, b]);
	// The canvas assigns this back into `$state`, so a shared array would not notify.
	expect(again).not.toBe(opened);
	expect(openFileTab([], a)).toEqual([a]);
});

test('openFileTab matches by reference, so a re-fetched copy of a file is a second tab', () => {
	expect(openFileTab([a], a)).toEqual([a]);
	// `includes` is identity, not deep equality: a fresh object with the same id opens again.
	// The canvas passes the object it holds, so this is a property of the contract, not a bug
	// it can hit through the UI.
	expect(openFileTab([a], { id: 'a' })).toHaveLength(2);
});

test('closeFileTab on a missing tab changes nothing and keeps the selection', () => {
	const result = closeFileTab([a, b], a, c);
	expect(result.tabs).toEqual([a, b]);
	expect(result.selected).toBe(a);
	// A fresh list, because the caller assigns it back into `$state`.
	expect(result.tabs).not.toBe(undefined);
	expect(result.tabs).not.toHaveLength(3);
});

test('closing the selected middle tab selects the tab that took its place', () => {
	expect(closeFileTab([a, b, c], b, b)).toEqual({ tabs: [a, c], selected: c });
});

test('closing the selected last tab falls back to the previous one', () => {
	expect(closeFileTab([a, b, c], c, c)).toEqual({ tabs: [a, b], selected: b });
});

test('closing the only tab leaves no selection rather than a stale one', () => {
	expect(closeFileTab([a], a, a)).toEqual({ tabs: [], selected: null });
});

test('closing an inactive tab never moves the selection', () => {
	expect(closeFileTab([a, b, c], a, c)).toEqual({ tabs: [a, b], selected: a });
	// Closing the tab before the selected one shifts its index but not its identity.
	expect(closeFileTab([a, b, c], c, a)).toEqual({ tabs: [b, c], selected: c });
	// No selection at all stays no selection.
	expect(closeFileTab([a, b], null, b)).toEqual({ tabs: [a], selected: null });
});

test('open then close is a round trip for an inactive tab, and neither mutates its input', () => {
	const tabs: Tab[] = [a, b];
	const opened = openFileTab(tabs, c);
	const closed = closeFileTab(opened, a, c);
	expect(closed).toEqual({ tabs: [a, b], selected: a });
	expect(tabs).toEqual([a, b]);
	expect(opened).toEqual([a, b, c]);
});

test('closeFileTab closes only the exact object it was given, not an equal copy', () => {
	// Same identity closes, and selection falls back to the surviving neighbour.
	expect(closeFileTab([a, b], b, b)).toEqual({ tabs: [a], selected: a });
	// A structurally equal stranger closes nothing and leaves the selection alone.
	expect(closeFileTab([a, b], b, { id: 'b' })).toEqual({ tabs: [a, b], selected: b });
});

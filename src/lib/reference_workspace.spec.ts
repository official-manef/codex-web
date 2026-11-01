import { describe, expect, test } from 'vitest';
import { isNearLatest, togglePinnedSession, validPinnedSessions } from './reference_workspace';

/**
 * The pin control was inert in the shipped build: `validPinnedSessions` only kept ids matching
 * `/^[a-f0-9]{32}$/`, but `src/lib/http.local.ts` issues ids shaped `session-<base36>-<n>`.
 * Every pin therefore filtered itself out and the control appeared dead.
 */
describe('pinned sessions', () => {
	const issued = 'session-mvyc0grt-1';

	test('an id the local store actually issues can be pinned', () => {
		expect(validPinnedSessions([issued])).toEqual([issued]);
		expect(togglePinnedSession([], issued)).toEqual([issued]);
	});

	test('pinning then unpinning returns to empty', () => {
		const pinned = togglePinnedSession([], issued);
		expect(togglePinnedSession(pinned, issued)).toEqual([]);
	});

	test('a legacy hex id is still honoured so an existing pin is not lost', () => {
		const legacy = 'a'.repeat(32);
		expect(validPinnedSessions([legacy])).toEqual([legacy]);
	});

	test('junk, duplicates and non-strings are dropped', () => {
		expect(
			validPinnedSessions([issued, issued, 7, null, '', 'has space', 'x'.repeat(200)])
		).toEqual([issued]);
		expect(validPinnedSessions('not an array')).toEqual([]);
		expect(validPinnedSessions(null)).toEqual([]);
	});

	test('the list is capped at 100', () => {
		const many = Array.from({ length: 250 }, (_, index) => `session-${index}`);
		expect(validPinnedSessions(many)).toHaveLength(100);
	});
});

describe('reading position', () => {
	test('near the bottom counts as following the newest output', () => {
		expect(isNearLatest(900, 100, 1000)).toBe(true);
		expect(isNearLatest(0, 100, 1000)).toBe(false);
	});
});

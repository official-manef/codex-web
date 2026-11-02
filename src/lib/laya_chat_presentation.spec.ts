import { expect, test } from 'vitest';
import { resolveLayaChatPresentation } from './laya_chat_presentation';

/**
 * The shell's config type requires `modes`, but `resolveChatPresentation` accepts a config that
 * omits it and defaults to `['chat']`. These cases are about that default, so the field is left
 * out deliberately rather than filled with a dummy that would mask the behaviour.
 */
type Config = Parameters<typeof resolveLayaChatPresentation>[0];
const withoutModes = (value: Omit<NonNullable<Config>, 'modes'>) => value as Config;

/**
 * The shell accepts any mode name; Laya's own taxonomy is narrower. This adapter is the filter
 * that decides which modes the chat surface is allowed to offer, and the fallback when a
 * consumer configured none of them.
 */

test('only modes Laya knows survive, and the configured order is kept', () => {
	expect(resolveLayaChatPresentation({ modes: ['work', 'compare', 'chat'] }).modes).toEqual([
		'work',
		'compare',
		'chat'
	]);
	expect(resolveLayaChatPresentation({ modes: ['chat', 'invented', 'work'] }).modes).toEqual([
		'chat',
		'work'
	]);
	// An empty list is not "all modes"; it is the one mode Laya always has.
	expect(resolveLayaChatPresentation({ modes: [] }).modes).toEqual(['chat']);
	expect(resolveLayaChatPresentation({ modes: ['invented', 'other'] }).modes).toEqual(['chat']);
	expect(resolveLayaChatPresentation().modes).toEqual(['chat']);
});

test('a default mode outside the kept set falls back to the first surviving mode', () => {
	expect(
		resolveLayaChatPresentation({ modes: ['chat', 'work'], defaultMode: 'work' }).defaultMode
	).toBe('work');
	// `compare` was configured as default but dropped, so the default follows the survivors.
	expect(
		resolveLayaChatPresentation({ modes: ['chat', 'invented'], defaultMode: 'invented' })
			.defaultMode
	).toBe('chat');
	// A default with no modes at all still resolves to the fallback mode.
	expect(resolveLayaChatPresentation(withoutModes({ defaultMode: 'compare' })).defaultMode).toBe('chat');
});

test('comparison kinds are filtered to the two Laya supports', () => {
	expect(
		resolveLayaChatPresentation(withoutModes({ comparisonKinds: ['processors', 'models'] })).comparisonKinds
	).toEqual(['processors', 'models']);
	expect(
		resolveLayaChatPresentation(withoutModes({ comparisonKinds: ['models', 'prices', 'models'] })).comparisonKinds
	).toEqual(['models']);
	// No comparison configured is an empty list, not a default pair.
	expect(resolveLayaChatPresentation().comparisonKinds).toEqual([]);
	expect(resolveLayaChatPresentation(withoutModes({ comparisonKinds: [] })).comparisonKinds).toEqual([]);
});

test('presentation-only fields pass through untouched, so the shell keeps its own labels', () => {
	const resolved = resolveLayaChatPresentation({
		modes: ['chat', 'work'],
		modeLabels: { chat: 'Ask', work: 'Do' },
		maxComparisonPanels: 2,
		comparisonAddLabel: 'Add another'
	});
	expect(resolved).toMatchObject({
		modeLabels: { chat: 'Ask', work: 'Do' },
		maxComparisonPanels: 2,
		comparisonAddLabel: 'Add another'
	});
});

test('the same config twice yields an equal, independent result', () => {
	const config = { modes: ['chat', 'work'], comparisonKinds: ['models'] };
	const first = resolveLayaChatPresentation(config);
	const second = resolveLayaChatPresentation(config);
	expect(second).toEqual(first);
	// Mutating one result must not reach the config the caller still holds.
	first.modes.push('compare');
	expect(config.modes).toEqual(['chat', 'work']);
	expect(resolveLayaChatPresentation(config).modes).toEqual(['chat', 'work']);
});

import { expect, test } from 'vitest';
import { deviceListState } from './view_states';

/**
 * The four device-list states, and the two distinctions that keep getting lost.
 *
 * `checking` used to fall through to "no device is detected", so every boot read as a machine
 * with no NPU or GPU. And a failed read used to render as an empty list, which claims the
 * machine has no device when the truth is that nobody asked it successfully.
 */

test('a list still being read is loading, never empty', () => {
	expect(deviceListState({ connection: 'checking', backends: [] })).toBe('loading');
	// Stale rows from a previous read must not turn a new read into "ready".
	expect(deviceListState({ connection: 'checking', backends: [{ id: 'local:cpu' }] })).toBe(
		'loading'
	);
});

test('a failed read is an error, even when the list is empty', () => {
	expect(deviceListState({ connection: 'offline', backends: [] })).toBe('error');
	expect(deviceListState({ connection: 'offline', backends: [{ id: 'local:cpu' }] })).toBe('error');
});

test('an answered zero-row list is empty, not an error', () => {
	expect(deviceListState({ connection: 'online', backends: [] })).toBe('empty');
});

test('an answered list with a row is ready', () => {
	expect(deviceListState({ connection: 'online', backends: [{ id: 'local:cpu' }] })).toBe('ready');
});

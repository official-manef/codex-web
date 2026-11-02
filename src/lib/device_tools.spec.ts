import { afterEach, expect, test, vi } from 'vitest';
import {
	createDeviceTools,
	DEVICE_TOOLS_STORAGE_KEY,
	type DeviceTool
} from './device_tools.svelte';

/**
 * These switches say "the user wants this tool", never "a device exists". The stored value is
 * writable by any script on the origin, so what it restores has to be a closed set, and a
 * blocked store has to leave the switch usable rather than throwing on click.
 */

function stubWindow(raw: string | null, options: { throwsOn?: 'get' | 'set' } = {}) {
	const setItem = vi.fn((key: string, value: string): void => {
		void key;
		void value;
		if (options.throwsOn === 'set') throw new DOMException('full', 'QuotaExceededError');
	});
	vi.stubGlobal('window', {
		localStorage: {
			getItem: (key: string) => {
				if (options.throwsOn === 'get') throw new Error('blocked');
				return key === DEVICE_TOOLS_STORAGE_KEY ? raw : null;
			},
			setItem
		}
	});
	return { setItem };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

test('every tool starts off, including before start() has run', () => {
	const tools = createDeviceTools();
	// The SSR/first-paint value must agree with the client, so nothing is enabled by default.
	expect(tools.isEnabled('terminal')).toBe(false);
	expect(tools.isEnabled('browser')).toBe(false);
	tools.start();
	expect(tools.isEnabled('terminal')).toBe(false);
});

test('a stored selection is restored once, and only for known tools', () => {
	stubWindow(JSON.stringify(['terminal', 'not-a-tool', 'browser', 42, null]));
	const tools = createDeviceTools();
	tools.start();
	expect(tools.isEnabled('terminal')).toBe(true);
	expect(tools.isEnabled('browser')).toBe(true);
	// An unknown name is never a switch, so it can never be asked about or enabled.
	expect(tools.isEnabled('not-a-tool' as DeviceTool)).toBe(false);
	expect(tools.isEnabled(42 as unknown as DeviceTool)).toBe(false);
});

test('a corrupt, oversized or non-array stored value loads as everything off', () => {
	for (const raw of [
		'not json',
		'{}',
		'"terminal"',
		'null',
		JSON.stringify(['terminal']).padEnd(2048, ' ')
	]) {
		stubWindow(raw);
		const tools = createDeviceTools();
		tools.start();
		expect(tools.isEnabled('terminal'), raw.slice(0, 12)).toBe(false);
	}
});

test('a blocked store leaves every tool off and does not throw on start', () => {
	stubWindow(null, { throwsOn: 'get' });
	const tools = createDeviceTools();
	expect(() => tools.start()).not.toThrow();
	expect(tools.isEnabled('browser')).toBe(false);
});

test('enabling writes the selection, and disabling removes it', () => {
	const { setItem } = stubWindow(null);
	const tools = createDeviceTools();
	tools.start();
	tools.setEnabled('terminal', true);
	expect(tools.isEnabled('terminal')).toBe(true);
	// Every key is written as one envelope now: `{ version, value }`.
	expect(JSON.parse(setItem.mock.calls.at(-1)![1])).toEqual({ version: 1, value: ['terminal'] });

	tools.setEnabled('browser', true);
	expect(JSON.parse(setItem.mock.calls.at(-1)![1])).toEqual({
		version: 1,
		value: ['terminal', 'browser']
	});
	tools.setEnabled('terminal', false);
	expect(tools.isEnabled('terminal')).toBe(false);
	expect(JSON.parse(setItem.mock.calls.at(-1)![1])).toEqual({ version: 1, value: ['browser'] });
});

test('setting a tool to the value it already has does not write again', () => {
	const { setItem } = stubWindow(null);
	const tools = createDeviceTools();
	tools.start();
	tools.setEnabled('terminal', false);
	expect(setItem).not.toHaveBeenCalled();
	tools.setEnabled('terminal', true);
	const calls = setItem.mock.calls.length;
	tools.setEnabled('terminal', true);
	// A redundant write would bump storage on every render pass.
	expect(setItem.mock.calls.length).toBe(calls);
});

test('a blocked write keeps the live switch working, because persistence is optional', () => {
	stubWindow(null, { throwsOn: 'set' });
	const tools = createDeviceTools();
	tools.start();
	expect(() => tools.setEnabled('browser', true)).not.toThrow();
	expect(tools.isEnabled('browser')).toBe(true);
});

test('start() is idempotent, so a remount does not re-read or resurrect a cleared value', () => {
	const { setItem } = stubWindow(JSON.stringify(['terminal']));
	const tools = createDeviceTools();
	tools.start();
	tools.setEnabled('terminal', false);
	const reads = setItem.mock.calls.length;
	tools.start();
	expect(tools.isEnabled('terminal')).toBe(false);
	expect(setItem.mock.calls.length).toBe(reads);
});

test('without a window every operation is a safe no-op', () => {
	// No stub: this is the server-side path, where the module is imported during SSR.
	expect(typeof window).toBe('undefined');
	const tools = createDeviceTools();
	expect(() => tools.start()).not.toThrow();
	expect(() => tools.setEnabled('terminal', true)).not.toThrow();
	// The live value still updates; only the write is skipped.
	expect(tools.isEnabled('terminal')).toBe(true);
});

test('two instances do not share state', () => {
	stubWindow(JSON.stringify(['terminal']));
	const first = createDeviceTools();
	const second = createDeviceTools();
	first.start();
	expect(first.isEnabled('terminal')).toBe(true);
	// The second instance has not started, so it is still off: no module-level cache.
	expect(second.isEnabled('terminal')).toBe(false);
});

import { afterEach, expect, test, vi } from 'vitest';

/**
 * The per-feature tool toggles decide which workspace screens the rail offers. They are
 * presentation only, but the stored selection is writable by any script on the origin, and
 * `terminal`/`chat`/`tools` must stay reachable or the user could hide the screen that turns the
 * others back on. `feature_settings` reads `$app/environment` and `$env/dynamic/public` at import
 * time, so each case installs its storage first and imports a fresh instance.
 */

const browserFlag = true;
vi.mock('$app/environment', () => ({
	get browser() {
		return browserFlag;
	},
	get dev() {
		return false;
	},
	get building() {
		return false;
	},
	get version() {
		return 'test';
	}
}));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

async function fresh() {
	vi.resetModules();
	return await import('./feature_settings.svelte');
}

function stubStorage(raw: string | null, options: { throwsOn?: 'get' | 'set' } = {}) {
	const setItem = vi.fn((key: string, value: string): void => {
		void key;
		void value;
		if (options.throwsOn === 'set') throw new DOMException('full', 'QuotaExceededError');
	});
	vi.stubGlobal('window', {
		location: { href: 'https://example.com/workspace' },
		localStorage: {
			getItem: () => {
				if (options.throwsOn === 'get') throw new Error('blocked');
				return raw;
			},
			setItem
		}
	});
	return setItem;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

test('before start() the surface-neutral defaults are what SSR and the first render agree on', async () => {
	stubStorage(null);
	const { createFeatureSettings } = await fresh();
	const settings = createFeatureSettings();
	expect(settings.surface).toBe('cloud');
	// A local-runtime screen is off on the neutral default, and the always-on ones are present.
	expect(settings.isEnabled('snake')).toBe(false);
	expect(settings.isEnabled('chat')).toBe(true);
	expect(settings.isEnabled('tools')).toBe(true);
	expect(settings.isEnabled('terminal')).toBe(true);
});

test('start() resolves the stored selection and keeps required navigation', async () => {
	stubStorage(JSON.stringify({ version: 1, enabled: ['snake', 'files'] }));
	const { createFeatureSettings } = await fresh();
	const settings = createFeatureSettings();
	settings.start();
	expect(settings.isEnabled('snake')).toBe(true);
	expect(settings.isEnabled('files')).toBe(true);
	// Even though the stored list omitted them, these cannot be hidden.
	for (const id of ['chat', 'tools', 'devices', 'terminal', 'manef', 'providers', 'keys', 'faq']) {
		expect(settings.isEnabled(id), id).toBe(true);
	}
});

test('an unknown, foreign or malformed stored selection falls back to the surface defaults', async () => {
	for (const raw of [
		'not json',
		JSON.stringify({ version: 2, enabled: ['snake'] }),
		JSON.stringify({ version: 1, enabled: 'snake' }),
		JSON.stringify({ version: 1, enabled: [1, 2] }),
		null
	]) {
		stubStorage(raw);
		const { createFeatureSettings } = await fresh();
		const settings = createFeatureSettings();
		settings.start();
		// The cloud default keeps `chat` and drops the local-only `snake`.
		expect(settings.isEnabled('snake'), String(raw)).toBe(false);
		expect(settings.isEnabled('chat'), String(raw)).toBe(true);
	}
	vi.resetModules();
});

test('an unknown id is never enabled, and a required id cannot be turned off', async () => {
	const setItem = stubStorage(null);
	const { createFeatureSettings } = await fresh();
	const settings = createFeatureSettings();
	settings.start();
	const before = setItem.mock.calls.length;

	settings.setEnabled('not-a-feature', true);
	expect(settings.isEnabled('not-a-feature')).toBe(false);

	settings.setEnabled('terminal', false);
	settings.setEnabled('chat', false);
	settings.setEnabled('tools', false);
	// Disabling these would remove the screen that can turn anything back on.
	expect(settings.isEnabled('terminal')).toBe(true);
	expect(settings.isEnabled('tools')).toBe(true);
	expect(setItem.mock.calls.length).toBe(before);
});

test('enabling writes a sorted, de-duplicated selection and disabling removes it', async () => {
	const setItem = stubStorage(null);
	const { createFeatureSettings } = await fresh();
	const settings = createFeatureSettings();
	settings.start();
	settings.setEnabled('snake', true);
	expect(settings.isEnabled('snake')).toBe(true);
	const stored = JSON.parse(setItem.mock.calls.at(-1)![1]);
	// One envelope for every key now: `{ version, value }`. The id list lives in `value`.
	expect(stored.version).toBe(1);
	expect(stored.value).toEqual([...stored.value].sort());
	expect(new Set(stored.value).size).toBe(stored.value.length);

	settings.setEnabled('snake', false);
	expect(settings.isEnabled('snake')).toBe(false);
	expect(JSON.parse(setItem.mock.calls.at(-1)![1]).value).not.toContain('snake');
});

test('setting a value it already has does not write, so a re-render cannot churn storage', async () => {
	const setItem = stubStorage(null);
	const { createFeatureSettings } = await fresh();
	const settings = createFeatureSettings();
	settings.start();
	const before = setItem.mock.calls.length;
	settings.setEnabled('chat', true);
	settings.setEnabled('snake', false);
	expect(setItem.mock.calls.length).toBe(before);
});

test('reset() restores the defaults for the resolved surface', async () => {
	stubStorage(JSON.stringify({ version: 1, enabled: [] }));
	const { createFeatureSettings } = await fresh();
	const settings = createFeatureSettings();
	settings.start();
	settings.reset();
	expect(settings.isEnabled('chat')).toBe(true);
	expect(settings.isEnabled('snake')).toBe(false);
});

test('hidden() names what the surface, not the user, is withholding', async () => {
	stubStorage(null);
	const { createFeatureSettings } = await fresh();
	const settings = createFeatureSettings();
	settings.start();
	const hidden = settings.hidden();
	expect(hidden).toContain('snake');
	// A feature the user enabled is not "hidden by the surface" any more.
	settings.setEnabled('files', true);
	expect(settings.hidden()).not.toContain('files');
	// Always-available navigation is never reported as hidden.
	expect(hidden).not.toContain('chat');
});

test('start() is idempotent and a blocked store still leaves a usable toggle list', async () => {
	stubStorage(null, { throwsOn: 'get' });
	const { createFeatureSettings } = await fresh();
	const settings = createFeatureSettings();
	expect(() => settings.start()).not.toThrow();
	expect(settings.isEnabled('chat')).toBe(true);
	const snapshot = [...settings.enabled];
	settings.start();
	expect([...settings.enabled]).toEqual(snapshot);
});

test('a blocked write keeps the live selection, because persistence is optional', async () => {
	stubStorage(null, { throwsOn: 'set' });
	const { createFeatureSettings } = await fresh();
	const settings = createFeatureSettings();
	settings.start();
	expect(() => settings.setEnabled('snake', true)).not.toThrow();
	expect(settings.isEnabled('snake')).toBe(true);
});

test('two instances do not share the stored selection', async () => {
	stubStorage(JSON.stringify({ version: 1, enabled: ['snake'] }));
	const { createFeatureSettings, STORAGE_KEY, MAX_STORED_BYTES } = await fresh();
	expect(STORAGE_KEY).toBe('workspace-template:tools-v1');
	expect(MAX_STORED_BYTES).toBe(8 * 1024);
	const first = createFeatureSettings();
	first.start();
	expect(first.isEnabled('snake')).toBe(true);
	const second = createFeatureSettings();
	// The module-level singleton is separate from any instance a host creates.
	expect(second.isEnabled('snake')).toBe(false);
});

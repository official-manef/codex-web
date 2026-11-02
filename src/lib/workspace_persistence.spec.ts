import { expect, test } from 'vitest';
import { createLayaWorkspacePersistence } from './laya_workspace_persistence';
import { createWorkspacePersistence } from './workspace_persistence';
import {
	DEFAULT_INSPECTOR_WIDTH,
	DEFAULT_NAV_WIDTH,
	DEFAULT_OUTPUT_RATIO,
	type WorkspaceLayout
} from '$shared/workspace-layout/index.js';

/**
 * These adapters are what the shell restores between visits. What matters is that a corrupted or
 * foreign stored layout comes back as the defaults instead of a broken panel, and that the two
 * products never read each other's keys.
 */

function memory(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial));
	const storage = {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		removeItem: (key: string) => void map.delete(key)
	};
	return { map, storage };
}

const DEFAULTS = {
	output: null,
	lastOutput: null,
	outputRatio: DEFAULT_OUTPUT_RATIO,
	navWidth: DEFAULT_NAV_WIDTH,
	inspectorWidth: DEFAULT_INSPECTOR_WIDTH
};

test('an empty store yields the shell defaults for both products', () => {
	const { storage } = memory();
	expect(createWorkspacePersistence({ draftStorage: storage }).loadLayout(['files'])).toEqual(
		DEFAULTS
	);
	expect(createLayaWorkspacePersistence({ draftStorage: storage }).loadLayout(['files'])).toEqual(
		DEFAULTS
	);
});

test('a saved layout round-trips, and a tool that is no longer registered is dropped', () => {
	const { storage } = memory();
	const template = createWorkspacePersistence({ draftStorage: storage });
	const saved = {
		output: 'files' as string | null,
		lastOutput: 'terminal' as string | null,
		outputRatio: 0.5,
		navWidth: 250,
		inspectorWidth: 400
	};
	expect(template.saveLayout(saved, ['files', 'terminal'])).toBe(true);
	expect(template.loadLayout(['files', 'terminal'])).toEqual(saved);
	// A removed view must not stay selected: the shell would render an empty panel.
	expect(template.loadLayout(['terminal'])).toEqual({
		...saved,
		output: null,
		lastOutput: 'terminal'
	});
});

test('out-of-range and non-numeric geometry is clamped instead of trusted', () => {
	for (const create of [createWorkspacePersistence, createLayaWorkspacePersistence]) {
		const { storage } = memory();
		const persistence = create({ draftStorage: storage });
		persistence.saveLayout(
			// A layout a previous build may have written: every field is the wrong number.
			{
				output: null,
				lastOutput: null,
				outputRatio: 5,
				navWidth: -100,
				inspectorWidth: Number.NaN
			} as unknown as WorkspaceLayout,
			[]
		);
		const loaded = persistence.loadLayout([]);
		expect(loaded.outputRatio).toBe(0.75);
		expect(loaded.navWidth).toBe(180);
		// A NaN cannot be clamped, so the default stands rather than the minimum.
		expect(loaded.inspectorWidth).toBe(DEFAULT_INSPECTOR_WIDTH);
	}
});

test('a corrupted stored layout loads as defaults without throwing', () => {
	const { storage, map } = memory();
	storage.setItem('laya-draft-v1:workspace-layout', 'not json');
	expect(createLayaWorkspacePersistence({ draftStorage: storage }).loadLayout([])).toEqual(
		DEFAULTS
	);

	// A valid envelope holding nonsense is refused field by field, not wholesale.
	storage.setItem('laya-draft-v1:workspace-layout', JSON.stringify({ version: 1, value: 'text' }));
	expect(createLayaWorkspacePersistence({ draftStorage: storage }).loadLayout([])).toEqual(
		DEFAULTS
	);
	expect(map.size).toBe(1);
});

test('the two products keep separate backend keys, so neither overrides the other', () => {
	const { storage } = memory();
	const template = createWorkspacePersistence({ backendStorage: () => storage });
	const laya = createLayaWorkspacePersistence({ backendStorage: () => storage });

	template.saveBackend('backend', 'local');
	template.saveBackend('chatBackend', 'local:npu');
	laya.saveBackend('backend', 'local:cpu');
	laya.saveBackend('chatBackend', 'local:gpu');

	// The template's own prefix, and Laya's legacy keys, are both intact.
	expect(template.readBackends()).toEqual({ backend: 'local', chatBackend: 'local:npu' });
	expect(laya.readBackends()).toEqual({ backend: 'local:cpu', chatBackend: 'local:gpu' });
});

test('a chat backend falls back to the primary one, and an empty store is empty', () => {
	const { storage } = memory();
	const laya = createLayaWorkspacePersistence({ backendStorage: () => storage });
	expect(laya.readBackends()).toEqual({ backend: '', chatBackend: '' });
	laya.saveBackend('backend', 'local:npu');
	expect(laya.readBackends()).toEqual({ backend: 'local:npu', chatBackend: 'local:npu' });
	// An explicitly saved chat backend wins over the fallback from then on.
	laya.saveBackend('chatBackend', 'local:cpu');
	expect(laya.readBackends()).toEqual({ backend: 'local:npu', chatBackend: 'local:cpu' });
});

test('a blocked backend store reports empty preferences instead of breaking the workspace', () => {
	const blocked = () => {
		throw new DOMException('blocked', 'SecurityError');
	};
	const template = createWorkspacePersistence({
		backendStorage: blocked,
		draftStorage: memory().storage
	});
	expect(template.readBackends()).toEqual({ backend: '', chatBackend: '' });
	expect(() => template.saveBackend('backend', 'local')).not.toThrow();

	const laya = createLayaWorkspacePersistence({ backendStorage: blocked });
	expect(laya.readBackends()).toEqual({ backend: '', chatBackend: '' });
	expect(() => laya.saveBackend('chatBackend', 'local')).not.toThrow();
});

test('an absent storage backend is optional, not a write failure the caller sees', () => {
	const template = createWorkspacePersistence({ backendStorage: () => undefined });
	expect(template.readBackends()).toEqual({ backend: '', chatBackend: '' });
	expect(() => template.saveBackend('backend', 'local')).not.toThrow();
});

test('readDraft/saveDraft go through the same namespaced store as the layout', () => {
	const { storage, map } = memory();
	const laya = createLayaWorkspacePersistence({ draftStorage: storage });
	expect(laya.readDraft('composer', 'fallback')).toBe('fallback');
	expect(laya.saveDraft('composer', 'draft text')).toBe(true);
	expect(laya.readDraft('composer', 'fallback')).toBe('draft text');
	// Persisted under Laya's draft prefix, so the template's drafts cannot collide with it.
	expect([...map.keys()]).toEqual(['laya-draft-v1:composer']);

	const template = createWorkspacePersistence({ draftStorage: storage });
	expect(template.saveDraft('composer', 'template text')).toBe(true);
	expect(template.readDraft('composer', 'fallback')).toBe('template text');
	// Both products share the draft namespace, so the last writer wins there; only the backend
	// keys are product-scoped. That is why the layout is stored under one key, not two.
	expect(laya.readDraft('composer', 'fallback')).toBe('template text');
});

test('with no options at all the default backend store is the browser one, absent in node', () => {
	// `window` does not exist here, so the default resolver must return undefined rather than
	// throw; the workspace still loads, it simply has no saved backend to restore.
	expect(typeof window).toBe('undefined');
	const template = createWorkspacePersistence();
	expect(template.readBackends()).toEqual({ backend: '', chatBackend: '' });
	expect(() => template.saveBackend('backend', 'local')).not.toThrow();
	const laya = createLayaWorkspacePersistence();
	expect(laya.readBackends()).toEqual({ backend: '', chatBackend: '' });
	expect(() => laya.saveBackend('chatBackend', 'local')).not.toThrow();
});

import { afterEach, expect, test, vi } from 'vitest';

/**
 * Two adapters expose the runtime to the shell: `template_runtime_adapter` (single local
 * backend) and `laya_runtime_adapter` (three device ids). Both decide what the UI may show and
 * remember. Their `listBackends` is the one place a malformed device list can reach the
 * selector, so it is checked against the real filter rather than a shape assertion.
 */

const api = { backends: vi.fn() };

/** A backend row as the selector receives it; only these three fields are meaningful. */
const backend = (id: string, kind: string, ready: boolean) => ({ id, kind, ready });

vi.mock('#lib/http.js', async () => {
	const actual = await vi.importActual<typeof import('./http')>('#lib/http.js');
	return {
		...actual,
		api: { ...actual.api, backends: () => api.backends() },
		runtimeConnection: () => ({
			hosted: false,
			connected: true,
			baseUrl: '',
			expiresAt: 0,
			allowActions: false
		})
	};
});

afterEach(() => {
	api.backends.mockReset();
});

test('a backend list keeps only entries with a string id, a string kind and a boolean ready', async () => {
	const { workspaceRuntime } = await import('./template_runtime_adapter');
	api.backends.mockResolvedValue({
		backends: [
			{ id: 'local:npu', kind: 'local', ready: true, label: 'NPU' },
			{ id: 'byok', kind: 'byok', ready: false },
			// Each of these is one broken field; a single bad entry must not hide the good ones.
			{ id: 7, kind: 'local', ready: true },
			{ id: 'x', kind: 2, ready: true },
			{ id: 'y', kind: 'local', ready: 'yes' },
			null,
			'local',
			[]
		]
	});
	const result = await workspaceRuntime.listBackends();
	expect(result.map((item) => item.id)).toEqual(['local:npu', 'byok']);
});

test('an error field wins over a body, and a non-array is an error rather than an empty list', async () => {
	const { workspaceRuntime } = await import('./template_runtime_adapter');
	api.backends.mockResolvedValue({
		error: 'runtime offline',
		backends: [{ id: 'a', kind: 'local', ready: true }]
	});
	await expect(workspaceRuntime.listBackends()).rejects.toThrow('runtime offline');

	// `{}` must not read as "no devices available"; that would silently disable the composer.
	api.backends.mockResolvedValue({ backends: 'local' });
	await expect(workspaceRuntime.listBackends()).rejects.toThrow(/invalid device list/);
	api.backends.mockResolvedValue({});
	await expect(workspaceRuntime.listBackends()).rejects.toThrow(/invalid device list/);
});

test('a rejected transport propagates instead of being reported as an empty list', async () => {
	const { workspaceRuntime } = await import('./template_runtime_adapter');
	api.backends.mockRejectedValue(new Error('socket closed'));
	await expect(workspaceRuntime.listBackends()).rejects.toThrow('socket closed');
});

test('the shell connection state is what the browser stub reports', async () => {
	const { workspaceRuntime } = await import('./template_runtime_adapter');
	expect(workspaceRuntime.connection()).toEqual({ hosted: false, connected: true });
});

test('the template offers one backend and never offers a BYOK key as a device', async () => {
	const { backendSelection } = await import('./template_runtime_adapter');
	expect(backendSelection.chatEligible(backend('local', 'local', true))).toBe(true);
	expect(backendSelection.chatEligible(backend('byok', 'byok', true))).toBe(false);
	expect(backendSelection.chatSelectable('local', [backend('local', 'local', true)])).toBe(true);
	// `local:npu` exists in Laya, not here, so it is not selectable in the template.
	expect(backendSelection.chatSelectable('local:npu', [backend('local:npu', 'local', true)])).toBe(false);
	expect(backendSelection.persistBackend('local')).toBe(true);
	expect(backendSelection.persistBackend('byok')).toBe(false);
	expect(backendSelection.defaultCompareIds).toEqual(['local']);
});

test('the Laya adapter offers the three device ids and refuses everything else', async () => {
	const { layaBackendSelection } = await import('./laya_runtime_adapter');
	for (const id of ['local:npu', 'local:gpu', 'local:cpu']) {
		expect(layaBackendSelection.chatSelectable(id, [backend(id, 'local', true)]), id).toBe(true);
	}
	// A prefix match would accept all of these; the anchored pattern does not.
	for (const id of [
		'local',
		'local:',
		'local:tpu',
		'local:npu ',
		'xlocal:npu',
		'local:npu\n',
		'LOCAL:NPU',
		'byok'
	]) {
		expect(layaBackendSelection.chatSelectable(id, [backend(id, 'local', true)]), id).toBe(false);
	}
	expect(layaBackendSelection.persistBackend('byok')).toBe(false);
	expect(layaBackendSelection.persistBackend('local:npu')).toBe(true);
	expect(layaBackendSelection.chatEligible(backend('local:npu', 'local', true))).toBe(true);
	expect(layaBackendSelection.chatEligible(backend('local:npu', 'byok', true))).toBe(false);
	// Comparison defaults are ordered as the UI shows them, and none is a BYOK model.
	expect(layaBackendSelection.defaultCompareIds).toEqual(['local:cpu', 'local:npu', 'local:gpu']);
});

test('the Laya adapter filters a device list the same way and shares the connection state', async () => {
	const { layaWorkspaceRuntime } = await import('./laya_runtime_adapter');
	api.backends.mockResolvedValue({
		backends: [
			{ id: 'local:npu', kind: 'local', ready: true },
			{ id: 'local:gpu', kind: 'local', ready: false },
			{ id: 42, kind: 'local', ready: true }
		]
	});
	expect((await layaWorkspaceRuntime.listBackends()).map((item) => item.id)).toEqual([
		'local:npu',
		'local:gpu'
	]);
	expect(layaWorkspaceRuntime.connection()).toEqual({ hosted: false, connected: true });

	api.backends.mockResolvedValue({ backends: null });
	await expect(layaWorkspaceRuntime.listBackends()).rejects.toThrow(/invalid device list/);
});

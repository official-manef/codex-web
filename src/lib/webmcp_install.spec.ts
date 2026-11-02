import { expect, test, vi } from 'vitest';
import { installWebMCP, type WebMCPAdapter, type WebMCPStatus } from './webmcp';

/**
 * `installWebMCP` is the boundary between a browser page and this workspace's tools. It decides
 * whether the browser may register anything at all, what each tool may read, and that every
 * failure reaches the page as data rather than a throw. A fake environment stands in for
 * `navigator.modelContext`, so the real registration path is exercised rather than mocked.
 */

type Registered = {
	name: string;
	execute: (input: unknown, options?: { signal?: AbortSignal }) => Promise<string>;
	inputSchema: { properties?: Record<string, unknown> };
	annotations: {
		readOnlyHint: boolean;
		consequentialHint: boolean;
		untrustedContentHint: boolean;
	};
};
/** The environment parameter `installWebMCP` accepts, without exporting a test-only alias. */
type Env = Parameters<typeof installWebMCP>[1];

function environment(overrides: { secure?: boolean; withDocument?: boolean } = {}) {
	const tools = new Map<string, Registered>();
	const unregistered: string[] = [];
	const modelContext = {
		registerTool(tool: Registered) {
			tools.set(tool.name, tool);
		},
		unregisterTool(name: string) {
			unregistered.push(name);
			tools.delete(name);
		}
	};
	return {
		tools,
		unregistered,
		modelContext,
		env:
			overrides.withDocument === false
				? { navigator: { modelContext }, secureContext: overrides.secure ?? true }
				: {
						document: { modelContext },
						navigator: { modelContext },
						secureContext: overrides.secure ?? true
					}
	};
}

const VIEWS = [
	{ id: 'chat', label: 'Chat' },
	{ id: 'files', label: 'Files', group: 'Workspace' },
	{ id: 'Bad Id', label: 'refused' },
	{ id: '@plugin', label: 'refused' }
];

function adapter(overrides: Partial<WebMCPAdapter> = {}) {
	const statuses: WebMCPStatus[] = [];
	const navigated: string[] = [];
	const read = vi.fn(async (path: string) => {
		if (path === '/api/runtime')
			return { state: 'ready', uptime_s: 12, local: true, blockers: ['a', 'b'] };
		if (path === '/api/capabilities')
			return { workflows: { max_spec_bytes: 64 }, chat: { max_tokens: 8 }, error: undefined };
		if (path === '/api/agent-context')
			return {
				schema_version: 1,
				purpose: 'authoring',
				model: { label: 'qwen', custom: false, capabilities: { chat: true }, api_key: 'leak' },
				secret: 'not-forwarded'
			};
		if (path === '/api/workflows/catalogue') return { adapters: [] };
		return {};
	});
	const value: WebMCPAdapter = {
		views: () => VIEWS,
		workspace: () => ({ activeView: 'files', openViews: ['files', 'files', 'ghost', 'chat'] }),
		navigate: (id) => void navigated.push(id),
		read,
		validate: vi.fn(async () => ({ ok: true })),
		onStatus: (status) => statuses.push(status),
		...overrides
	};
	return { value, statuses, navigated, read };
}

async function installed(overrides: Partial<WebMCPAdapter> = {}, options = {}) {
	const fake = environment(options);
	const harness = adapter(overrides);
	const integration = installWebMCP(harness.value, fake.env as unknown as Env);
	await integration.ready;
	return { ...fake, ...harness, integration };
}

const run = async (
	tool: Registered,
	input: unknown,
	options: { signal?: AbortSignal } = {}
) =>
	JSON.parse(await tool.execute(input, options));

test('without a modelContext nothing is registered and the state is unsupported', async () => {
	const harness = adapter();
	const statuses: WebMCPStatus[] = [];
	const integration = installWebMCP({ ...harness.value, onStatus: (s) => statuses.push(s) }, {});
	await integration.ready;
	expect(integration.status).toEqual({ state: 'unsupported', api: null, toolCount: 0 });
	expect(statuses.at(-1)?.state).toBe('unsupported');
});

test('an insecure context refuses to register even when the API exists', async () => {
	const fake = environment({ secure: false });
	const harness = adapter();
	const integration = installWebMCP(harness.value, fake.env as unknown as Env);
	await integration.ready;
	// A page served over http must not expose tools that read the workspace.
	expect(fake.tools.size).toBe(0);
	expect(integration.status.state).toBe('unsupported');
});

test('the document API is preferred, and every tool is registered once', async () => {
	const { tools, integration } = await installed();
	expect(integration.status).toEqual({ state: 'ready', api: 'document', toolCount: 6 });
	expect([...tools.keys()].sort()).toEqual([
		'laya_ui_agent_context',
		'laya_ui_open_view',
		'laya_ui_status',
		'laya_ui_validate_workflow',
		'laya_ui_views',
		'laya_ui_workflow_catalogue'
	]);
});

test('the legacy navigator API is used only when it can also unregister', async () => {
	const { integration } = await installed({}, { withDocument: false });
	expect(integration.status.api).toBe('navigator');

	// A navigator without `unregisterTool` would leave tools behind after dispose, so nothing
	// is registered at all.
	let registered = 0;
	const partial = {
		navigator: {
			modelContext: {
				registerTool: () => {
					registered++;
				}
			}
		},
		secureContext: true
	};
	const harness = adapter();
	const refused = installWebMCP(harness.value, partial as unknown as Env);
	await refused.ready;
	expect(refused.status).toEqual({ state: 'unsupported', api: null, toolCount: 0 });
	expect(registered).toBe(0);
});

test('a document API without registerTool falls back to a legacy one that has it', async () => {
	const legacyTools = new Map<string, Registered>();
	const env = {
		document: { modelContext: {} },
		navigator: {
			modelContext: {
				registerTool: (tool: Registered) => void legacyTools.set(tool.name, tool),
				unregisterTool: (name: string) => void legacyTools.delete(name)
			}
		},
		secureContext: true
	};
	const integration = installWebMCP(adapter().value, env as unknown as Env);
	await integration.ready;
	expect(integration.status).toMatchObject({ state: 'ready', api: 'navigator', toolCount: 6 });
	expect(legacyTools.size).toBe(6);
});

test('disposing unregisters every tool it registered, and is idempotent', async () => {
	const { tools, unregistered, integration } = await installed({}, { withDocument: false });
	integration.dispose();
	expect(unregistered.sort()).toEqual([
		'laya_ui_agent_context',
		'laya_ui_open_view',
		'laya_ui_status',
		'laya_ui_validate_workflow',
		'laya_ui_views',
		'laya_ui_workflow_catalogue'
	]);
	expect(tools.size).toBe(0);
	expect(integration.status).toEqual({ state: 'closed', api: 'navigator', toolCount: 0 });
	// A second dispose must not unregister anything again: the page may have re-registered.
	const before = unregistered.length;
	integration.dispose();
	expect(unregistered.length).toBe(before);
});

test('a view whose id is not a plain lowercase slug is never offered to the page', async () => {
	const { tools } = await installed();
	const result = await run(tools.get('laya_ui_views')!, {});
	expect(result.views.map((view: { id: string }) => view.id)).toEqual(['chat', 'files']);
	// Only the passive fields cross the boundary.
	expect(result.views[1]).toEqual({ id: 'files', label: 'Files', group: 'Workspace' });
});

test('the workspace snapshot drops unknown views and de-duplicates, falling back to chat', async () => {
	const { tools } = await installed();
	expect((await run(tools.get('laya_ui_views')!, {})).workspace).toEqual({
		activeView: 'files',
		openViews: ['files', 'chat']
	});

	const hidden = await installed({ workspace: () => ({ activeView: 'ghost', openViews: [] }) });
	// An active view the page cannot see becomes `chat` rather than leaking the id.
	expect((await run(hidden.tools.get('laya_ui_views')!, {})).workspace.activeView).toBe('chat');
});

test('opening a view refuses an unknown id before navigating', async () => {
	const { tools, navigated } = await installed();
	const tool = tools.get('laya_ui_open_view')!;
	expect(await run(tool, { view: 'files' })).toEqual({
		ok: true,
		workspace: { activeView: 'files', openViews: ['files', 'chat'] }
	});
	expect(navigated).toEqual(['files']);

	const refused = await run(tool, { view: 'ghost' });
	expect(refused.ok).toBe(false);
	expect(refused.error).toMatch(/Choose a view/);
	expect(navigated).toEqual(['files']);
});

test('a tool refuses input that is not in its declared schema', async () => {
	const { tools } = await installed();
	const open = tools.get('laya_ui_open_view')!;
	expect((await run(open, { view: 'files', extra: 1 })).error).toMatch(/Supply only the fields/);
	expect((await run(open, {})).error).toMatch(/Choose a view/);
	expect((await run(open, null)).error).toMatch(/Supply only the fields/);
	// A tool with no declared fields refuses all of them.
	expect((await run(tools.get('laya_ui_views')!, { anything: 1 })).error).toMatch(
		/Supply only the fields/
	);
});

test('the status tool reports bounded runtime facts and never a blocker string', async () => {
	const { tools, read } = await installed();
	const result = await run(tools.get('laya_ui_status')!, {});
	expect(result.runtime).toEqual({
		state: 'ready',
		uptime_s: 12,
		local: true,
		restart_available: false,
		blocked_operations: 2
	});
	expect(result.capabilities).toEqual({
		workflows: { max_spec_bytes: 64 },
		chat: { max_tokens: 8 }
	});
	expect(read).toHaveBeenCalledWith('/api/runtime', expect.anything());
	expect(read).toHaveBeenCalledWith('/api/capabilities', expect.anything());
});

test('a runtime error document becomes a refusal, not partial data', async () => {
	const { tools } = await installed({
		read: async () => ({ error: 'runtime offline at /home/user/model.bin' })
	});
	const result = await run(tools.get('laya_ui_status')!, {});
	expect(result.ok).toBe(false);
	// The upstream text never reaches the page.
	expect(result.error).not.toContain('model.bin');
	expect(result.error).toMatch(/could not complete this request/);
});

test('the agent-context tool forwards only the documented keys and strips model secrets', async () => {
	const { tools } = await installed();
	const result = await run(tools.get('laya_ui_agent_context')!, {});
	expect(Object.keys(result).sort()).toEqual(['model', 'purpose', 'schema_version']);
	expect(result.model).toEqual({ label: 'qwen', custom: false, capabilities: { chat: true } });
	expect(JSON.stringify(result)).not.toContain('api_key');
	expect(JSON.stringify(result)).not.toContain('not-forwarded');
});

test('workflow validation is bounded by the limit the runtime reported', async () => {
	const { tools, value } = await installed();
	const tool = tools.get('laya_ui_validate_workflow')!;
	// The fake runtime reports a 64-byte limit.
	expect((await run(tool, { spec: { steps: [] } })).ok).toBe(true);
	expect(value.validate).toHaveBeenCalledTimes(1);

	const tooBig = await run(tool, { spec: { pad: 'x'.repeat(200) } });
	expect(tooBig.ok).toBe(false);
	expect(tooBig.error).toMatch(/exceeds the runtime's current definition limit/);
	expect(value.validate).toHaveBeenCalledTimes(1);

	const notObject = await run(tool, { spec: 'text' });
	expect(notObject.error).toMatch(/as an object/);
});

test('validation refuses rather than guessing when the runtime reports no usable limit', async () => {
	for (const capabilities of [
		{},
		{ workflows: { max_spec_bytes: 0 } },
		{ workflows: { max_spec_bytes: -1 } },
		{ workflows: { max_spec_bytes: '64' } },
		{ workflows: { max_spec_bytes: Number.POSITIVE_INFINITY } }
	]) {
		const { tools } = await installed({
			read: async (path: string) => (path === '/api/capabilities' ? capabilities : {})
		});
		const result = await run(tools.get('laya_ui_validate_workflow')!, { spec: {} });
		expect(result.error, JSON.stringify(capabilities)).toMatch(/did not report its workflow limit/);
	}
});

test('an unserialisable workflow is refused before the runtime is called', async () => {
	const { tools, value } = await installed();
	const circular: Record<string, unknown> = {};
	circular.self = circular;
	const result = await run(tools.get('laya_ui_validate_workflow')!, { spec: circular });
	expect(result.error).toMatch(/serializable JSON/);
	expect(value.validate).not.toHaveBeenCalled();
});

test('a validation the runtime rejects is reported as a flat error, and the raw response is not exposed', async () => {
	const { tools } = await installed({
		validate: async () => ({ error: 'step 0 has an unknown type: /home/user/secret.py' })
	});
	const result = await run(tools.get('laya_ui_validate_workflow')!, { spec: {} });
	expect(result.ok).toBe(false);
	expect(JSON.stringify(result)).not.toContain('secret.py');
});

test('disposing with a tool call in flight cancels it instead of letting it finish', async () => {
	let aborted = false;
	const { tools, integration } = await installed({
		read: (_path: string, signal?: AbortSignal) =>
			new Promise((_resolve, reject) => {
				signal?.addEventListener('abort', () => {
					aborted = true;
					reject(new Error('the transport was aborted'));
				});
			})
	});
	const pending = run(tools.get('laya_ui_status')!, {});
	integration.dispose();
	const result = await pending;
	// The transport is actually told to stop; it is not left running after dispose.
	expect(aborted).toBe(true);
	expect(result.ok).toBe(false);
	expect(result.error).toMatch(/aborted/);
});

test('a cancelled action whose transport ignores the signal is reported as cancelled', async () => {
	const { tools, integration } = await installed({
		// A transport that resolves anyway, after the page closed.
		read: () =>
			new Promise((resolve) => {
				resolve({ state: 'ready' });
			})
	});
	const pending = run(tools.get('laya_ui_status')!, {});
	integration.dispose();
	const result = await pending;
	expect(result.ok).toBe(false);
	expect(result.error).toMatch(/cancelled/i);
});

test('an already-aborted signal refuses the call before the action runs', async () => {
	const { tools, read } = await installed();
	const controller = new AbortController();
	controller.abort();
	const before = read.mock.calls.length;
	const result = await run(tools.get('laya_ui_status')!, {}, { signal: controller.signal });
	expect(result.error).toMatch(/cancelled/i);
	expect(read.mock.calls.length).toBe(before);
});

test('every tool is annotated read-only where it only reads, and consequential never true', async () => {
	const { tools } = await installed();
	for (const [name, tool] of tools) {
		expect(tool.annotations.consequentialHint, name).toBe(false);
		expect(tool.annotations.readOnlyHint, name).toBe(
			// The only non-read-only tool is the one that navigates the workspace.
			name !== 'laya_ui_open_view'
		);
	}
	// Untrusted content is flagged for the two tools that echo runtime or workflow text.
	expect(tools.get('laya_ui_validate_workflow')!.annotations.untrustedContentHint).toBe(true);
	expect(tools.get('laya_ui_views')!.annotations.untrustedContentHint).toBe(false);
});

test('a registration failure aborts the rest and reports the error state', async () => {
	const fake = environment();
	let calls = 0;
	fake.modelContext.registerTool = (tool: Registered) => {
		if (++calls === 3) throw new Error('registration refused');
		fake.tools.set(tool.name, tool);
	};
	const harness = adapter();
	const integration = installWebMCP(harness.value, fake.env as unknown as Env);
	await integration.ready;
	expect(integration.status.state).toBe('error');
	// The first two registered tools are not left behind on the legacy API.
	expect(integration.status.toolCount).toBe(0);
	// And the tools that did register refuse to run after the abort.
	const first = fake.tools.values().next().value as Registered;
	expect((await run(first, {})).error).toMatch(/cancelled/i);
});

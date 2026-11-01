import { expect, test } from 'vitest';
import { CHAT_OUTPUTS, SECTIONS, WORKSPACE_VIEWS, WORKSPACE_VIEW_IDS } from './registry';
import { FEATURE_ACCESS } from './feature_access';
import {
	chatPanels,
	settingsMenu,
	launcherId,
	canvasPresentation,
	fileMenuViews
} from './workspace_routes';

/**
 * One id space. The registry names a destination; `feature_access` decides whether it shows;
 * `workspace_routes` points at it. These assertions exist so a fourth list cannot appear
 * silently — the failure mode this repo shipped, where an entry was "registered" and did
 * nothing because three files each kept their own copy of the names.
 */

type View = (typeof WORKSPACE_VIEWS)[number];

/**
 * A registered id must resolve to something. Either it carries a `loadScreen`, or the shell
 * mounts a host component for it. Those hosts are a closed list, so a new id cannot join them
 * by accident: `chat` is the `chat` prop, `workspace-home` is the launcher, and the three
 * `chat-*` ids are panel routes the chat view opens. Anything else that navigates nowhere is
 * the `Corpus`/`Reference`/`Schema` failure again — registered, reachable, blank.
 */
const HOSTED: Readonly<Record<string, string>> = {
	chat: 'the shell renders the chat view from its `chat` prop',
	'workspace-home': 'the shell renders the launcher component under `launcherId`',
	'chat-tools': 'a chat panel route (`chatPanels`)',
	'chat-settings': 'a chat panel route (`chatPanels`)',
	'chat-session': 'a chat panel route (`chatPanels`)'
};

function hasLoader(view: View): boolean {
	return typeof (view as { loadScreen?: unknown }).loadScreen === 'function';
}

test('every registered id resolves: a lazily loaded screen or a documented host', () => {
	for (const view of WORKSPACE_VIEWS as readonly View[]) {
		if (hasLoader(view)) continue;
		expect(
			HOSTED[view.id],
			`"${view.id}" has no loadScreen and no host. Delete it, or give it a real view.`
		).toBeTruthy();
	}
});

test('the host list does not outlive the ids it explains', () => {
	for (const id of Object.keys(HOSTED)) {
		expect(WORKSPACE_VIEW_IDS.has(id), `"${id}" is hosted but not registered`).toBe(true);
	}
	// Every `chat-*` id in the registry is one of the documented panel routes.
	for (const panel of chatPanels) expect(HOSTED[panel.id], panel.id).toBeTruthy();
	expect(HOSTED[launcherId], `${launcherId} must be the launcher host`).toContain('launcher');
});

test('every registered view has exactly one access rule, and no rule names an unknown view', () => {
	for (const view of [...SECTIONS, ...CHAT_OUTPUTS]) {
		expect(FEATURE_ACCESS[view.id], `${view.id} has no access rule`).toBeTruthy();
	}
	for (const id of Object.keys(FEATURE_ACCESS)) {
		expect(WORKSPACE_VIEW_IDS.has(id), `${id} has an access rule but is not registered`).toBe(true);
	}
});

test('workspace_routes only names registered ids', () => {
	const named = [
		...chatPanels.map((panel) => panel.id),
		settingsMenu.primary,
		settingsMenu.integrations,
		settingsMenu.help,
		settingsMenu.setup,
		launcherId,
		...canvasPresentation.selfHeaderIds,
		...canvasPresentation.hideComputeIds,
		...fileMenuViews.map((view) => view.id)
	];
	for (const id of named) expect(WORKSPACE_VIEW_IDS.has(id), id).toBe(true);
});

test('ids are unique across sections and chat outputs', () => {
	const ids = [...SECTIONS, ...CHAT_OUTPUTS].map((view) => view.id);
	expect(new Set(ids).size, 'a duplicate id would resolve to whichever entry wins').toBe(
		ids.length
	);
});

test('no registry entry claims a screen the repository does not ship', async () => {
	// `loadScreen` is a dynamic import, so a deleted view file fails at click time, not at
	// typecheck or test time. Read the registry source and stat each path it names instead of
	// importing the component: a Svelte view needs a browser, and this guard is about files.
	const { readFile, stat } = await import('node:fs/promises');
	const source = await readFile(new URL('./registry.ts', import.meta.url), 'utf8');
	const paths = [...source.matchAll(/import\('([^']+\.svelte)'\)/g)].map((match) => match[1]);
	expect(paths.length, 'no loader found — did the registry format change?').toBeGreaterThan(0);
	for (const path of paths) {
		const file = path.replace('#lib/views/', new URL('./views/', import.meta.url).pathname);
		await expect(stat(file), `${path} is registered but not on disk`).resolves.toBeTruthy();
	}
});

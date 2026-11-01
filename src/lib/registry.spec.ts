import { expect, test } from 'vitest';
import { CHAT_OUTPUTS, SECTIONS, WORKSPACE_VIEW_IDS } from './registry';
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

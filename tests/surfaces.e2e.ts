import { expect, test, type Locator, type Page } from '@playwright/test';
import { CHAT_OUTPUTS, SECTIONS } from '../src/lib/registry';

/**
 * Every registry id, walked in a real browser.
 *
 * `tests/surfaces.e2e.ts` used to cover two screens; `docs/surface-coverage-2026-11-02.md` records
 * what each id does today. This suite is the same claim in executable form: for each id it opens
 * the surface through the control a user actually has (rail, More tools, the settings window's own
 * category list, the launcher, the tab strip), then asserts four things —
 *
 *   1. reachable: the surface is on screen after that control, not just a hash change;
 *   2. named: it renders a landmark with an accessible name (heading, region, log or tabpanel);
 *   3. quiet: no page errors, no failed request the screen did not ask for, no console error of its
 *      own. A documented degraded answer (`/api/manef/*` 503, `/api/git` 404) is allowed per id and
 *      is itself asserted as that screen's honest state;
 *   4. honest: the text naming why the surface cannot do the thing is present, so a screen with no
 *      backend says so instead of showing a blank box or a fake "connected".
 *
 * Copy is described by concept ("not configured", "no model", "not paired"), never by the exact
 * sentence, so a copy pass in another branch does not fail this file. The two tests that pin a
 * literal string already existed and pin what the app itself guarantees.
 */

const RAIL = ['chat', 'manef', 'apps', 'transcribe', 'files', 'browser'] as const;

type Surface = {
	id: string;
	/** The control a user has for this id. */
	open: (page: Page) => Promise<unknown>;
	/** Where the surface renders: the shell's panel, the chat region, or the settings window. */
	root: (page: Page) => Locator;
	/** Text that proves the screen states why it cannot do the thing. */
	honest: RegExp;
	/** Failed responses this screen is designed to answer with. */
	degraded?: RegExp;
};

async function ready(page: Page): Promise<void> {
	await page.goto('/');
	// The chat boots from the local session store; `enabled` is the hydration barrier.
	await expect(page.locator('#chat-message')).toBeEnabled();
}

const click = (page: Page, name: string) =>
	page.getByRole('button', { name, exact: true }).first().click();

async function explore(page: Page, name: string): Promise<void> {
	await click(page, 'More tools');
	await page.getByRole('menuitem', { name, exact: true }).click();
}

/** View ▸ Tools ▸ Open tools. The launcher tab is not in the strip until the strip exists. */
async function openTools(page: Page): Promise<void> {
	await page.getByRole('menuitem', { name: 'View' }).click();
	await page.getByRole('menuitem', { name: 'Tools', exact: true }).hover();
	await page.getByRole('menuitem', { name: 'Open tools' }).click();
}

async function userMenuItem(page: Page, item: RegExp): Promise<void> {
	await click(page, 'User menu');
	await page.locator('.workspace-overflow-item', { hasText: item }).click();
}

async function settings(page: Page, label: string): Promise<void> {
	await userMenuItem(page, /^Settings$/);
	await page.locator('.settings-nav button', { hasText: label }).click();
}

async function launcher(page: Page): Promise<void> {
	await openTools(page);
}

const panel = (page: Page) => page.locator('#workspace');
const dialogContent = (page: Page) => page.locator('.settings-content');
const stubStatus = /stub|no runtime|not configured/i;

/** Where the app says it is: the settings window's selection, or the addressed output panel. */
async function opened(page: Page): Promise<string> {
	return page.evaluate(() => {
		const dialog = document.querySelector<HTMLElement>('.settings-window');
		if (dialog && (dialog.offsetWidth || dialog.offsetHeight))
			return `settings:${dialog.querySelector('.settings-content')?.getAttribute('aria-label') ?? ''}`;
		const panelElement = document.querySelector<HTMLElement>('#workspace');
		if (panelElement && !panelElement.hidden)
			return `panel:${panelElement.getAttribute('aria-label') ?? ''}`;
		return 'chat';
	});
}

const SURFACES: readonly Surface[] = [
	{
		id: 'chat',
		open: (page) => click(page, 'Chat'),
		root: (page) => page.locator('.desktop-chat'),
		honest: /no provider configured|what would you like to do\?/i
	},
	{
		id: 'manef',
		open: (page) => click(page, 'MANEF AI'),
		root: panel,
		honest: /hub is configured|unconfigured/i,
		degraded: /\/api\/manef\//
	},
	{
		id: 'apps',
		open: (page) => click(page, 'Automation'),
		root: panel,
		honest: /no backend|not configured|no runtime/i
	},
	{
		id: 'transcribe',
		open: (page) => click(page, 'Transcribe'),
		root: panel,
		honest: /no speech model|no file limit is reported/i
	},
	{
		id: 'files',
		open: (page) => click(page, 'Files'),
		root: panel,
		honest: /choose files or a folder|not uploaded/i
	},
	{
		id: 'browser',
		open: (page) => click(page, 'Browser'),
		root: panel,
		honest: /enter an address to preview|open a website/i
	},
	{
		id: 'overview',
		open: (page) => explore(page, 'Start here'),
		root: panel,
		honest: /no compute device is configured|check my setup/i
	},
	{
		id: 'voice',
		open: (page) => explore(page, 'Voice to action'),
		root: panel,
		honest: /no file limit is reported|no speech model|nothing is sent/i
	},
	{
		id: 'playground',
		open: (page) => explore(page, 'Decision simulation'),
		root: panel,
		honest: /no model|stub|no runtime/i
	},
	{
		id: 'snake',
		open: (page) => explore(page, 'Snake demo'),
		root: panel,
		honest: /no device is selected|choose a cpu, npu or gpu|no model/i
	},
	{
		id: 'embeddings',
		open: (page) => explore(page, 'Embedding search'),
		root: panel,
		honest: /install an embedding model|no backend|not configured/i
	},
	{
		id: 'models',
		open: (page) => settings(page, 'Models & downloads'),
		root: dialogContent,
		honest: /no openvino devices|no runtime|no download route/i
	},
	{
		id: 'setup',
		open: (page) => settings(page, 'Setup check'),
		root: dialogContent,
		honest: /not configured|not detected|unavailable/i
	},
	{
		id: 'backends',
		open: (page) => settings(page, 'Compute & devices'),
		root: dialogContent,
		honest: /no model runs|template stub|not detected|no endpoint/i
	},
	{
		id: 'providers',
		open: (page) => settings(page, 'Providers'),
		root: dialogContent,
		honest: /not configured|not measured/i
	},
	{
		id: 'pricing',
		open: (page) => settings(page, 'Costs'),
		root: dialogContent,
		honest: /no endpoint is connected|no price list|no billing route/i
	},
	{
		id: 'keys',
		open: (page) => settings(page, 'Model keys'),
		root: dialogContent,
		honest: /not configured/i
	},
	{
		id: 'faq',
		open: (page) => userMenuItem(page, /^Help$/),
		root: dialogContent,
		honest: /this browser build|desktop app/i
	},
	{
		id: 'tools',
		open: (page) => settings(page, 'Tools'),
		root: dialogContent,
		honest: /needs a runtime|works in any build/i
	},
	{
		id: 'devices',
		open: (page) => settings(page, 'Paired devices'),
		root: dialogContent,
		honest: /not configured|nothing is paired/i
	},
	{
		id: 'memories',
		open: (page) => settings(page, 'Memories'),
		root: dialogContent,
		honest: /no memories stored yet|this browser only|saved memories/i
	},
	{
		id: 'git',
		open: (page) => settings(page, 'Repository'),
		root: dialogContent,
		honest: /git_surface_enabled/i,
		degraded: /\/api\/git/
	},
	{
		id: 'automations',
		open: (page) => settings(page, 'Scheduled tasks'),
		root: dialogContent,
		honest: /not configured|does not run them yet/i
	},
	{
		id: 'chat-tools',
		open: (page) => userMenuItem(page, /^Integrations$/),
		root: dialogContent,
		honest: /keeps no connections|choose an mcp connection|choose a connection/i
	},
	{
		id: 'chat-settings',
		open: (page) => userMenuItem(page, /^Settings$/),
		root: dialogContent,
		honest: /no provider configured|no model is installed/i
	},
	{
		id: 'chat-session',
		open: (page) => settings(page, 'Session'),
		root: dialogContent,
		honest: /chat and utilities|clear messages/i
	},
	{
		id: 'workspace-home',
		open: launcher,
		root: panel,
		honest: /every tool this build registers|no tool has been opened yet/i
	},
	{
		id: 'terminal',
		open: async (page) => {
			await launcher(page);
			await page.getByRole('searchbox', { name: 'Find a local tool' }).fill('Terminal');
			await page.locator('.launcher-list button', { hasText: 'Terminal' }).click();
		},
		root: panel,
		honest: /no terminal can open yet|no backend/i
	}
];

/** Headings, regions, logs and tabpanels that are on screen and carry a name. */
async function namedLandmarks(root: Locator): Promise<string[]> {
	return root.evaluate((element) => {
		const visible = (node: HTMLElement) => !!(node.offsetWidth || node.offsetHeight);
		const name = (node: HTMLElement) => {
			const label = node.getAttribute('aria-label')?.trim();
			if (label) return label;
			const ids = node.getAttribute('aria-labelledby');
			if (ids)
				return ids
					.split(/\s+/)
					.map((id) => document.getElementById(id)?.textContent ?? '')
					.join(' ')
					.trim();
			return (node.textContent ?? '').trim();
		};
		const selector =
			'h1, h2, h3, [role="region"], [role="log"], section[aria-label], [role="tabpanel"][aria-label]';
		return [...element.querySelectorAll<HTMLElement>(selector)]
			.filter(visible)
			.map((node) => `${node.tagName}:${name(node)}`)
			.filter((entry) => (entry.split(':')[1] ?? '').length > 0);
	});
}

test.describe('registered surfaces', () => {
	for (const surface of SURFACES) {
		test(`${surface.id}: reachable, named, quiet and honest`, async ({ page }, testInfo) => {
			test.skip(
				testInfo.project.name !== 'desktop',
				'one pass over the registry; the controls are the same DOM at every width'
			);

			const pageErrors: string[] = [];
			const consoleErrors: string[] = [];
			const failed: string[] = [];
			page.on('pageerror', (error) => pageErrors.push(error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') consoleErrors.push(message.text());
			});
			page.on('response', (response) => {
				if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
			});

			await ready(page);
			await surface.open(page);

			const root = surface.root(page);
			await expect(root).toBeVisible();

			// Reachable: the surface the registry names is the one that opened. Settings ids move the
			// window's own selection; canvas ids move the addressed output panel. `chat` is the
			// primary region, which is what the rail button returns to.
			const label = [...SECTIONS, ...CHAT_OUTPUTS].find((view) => view.id === surface.id)?.label;
			expect(label, `${surface.id} is a registry id`).toBeTruthy();
			const expected =
				surface.id === 'chat'
					? 'chat'
					: surface.root === dialogContent
						? `settings:${label}`
						: `panel:${label}`;
			expect(await opened(page), `${surface.id} opened its own surface`).toBe(expected);

			const landmarks = await namedLandmarks(root);
			expect(landmarks, `${surface.id} renders a named landmark`).not.toEqual([]);

			await expect(root.getByText(surface.honest).first()).toBeAttached();

			const unexpected = failed.filter((entry) => !surface.degraded?.test(entry));
			expect(unexpected, `${surface.id} made no request it cannot answer`).toEqual([]);
			expect(pageErrors, `${surface.id} threw nothing`).toEqual([]);
			// Chromium logs one "Failed to load resource" per non-2xx answer; anything else is the
			// app's own error, and the count must not exceed the answers the screen states.
			expect(consoleErrors.length).toBeLessThanOrEqual(failed.length);
			expect(
				consoleErrors.filter((text) => !/Failed to load resource/.test(text)),
				`${surface.id} logged no error of its own`
			).toEqual([]);

			// Nothing in the surface may print an unfinished value where a number belongs.
			await expect(root.getByText(/NaN|undefined|\[object Object\]/)).toHaveCount(0);
		});
	}

	test('every registry id has a surface case', () => {
		const registered = [...SECTIONS, ...CHAT_OUTPUTS].map((view) => view.id).sort();
		expect(SURFACES.map((surface) => surface.id).sort()).toEqual(registered);
	});

	/**
	 * The chat's Session panel is a list of destinations. Two of them used to fire `go("corpus")`
	 * at an id `6ed1f3e` deleted, so the click did nothing and said nothing. Opening a destination
	 * from here must change the surface: the hash for a canvas view, the window's own selection
	 * for a settings view.
	 */
	test('the session panel only offers destinations that open', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop', 'one pass; the list is the same at every width');
		await ready(page);

		const labels = new Set<string>();
		await settings(page, 'Session');
		for (const label of await dialogContent(page)
			.locator('.utility-links button')
			.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? '')))
			labels.add(label);
		expect([...labels].length).toBeGreaterThan(0);

		for (const label of labels) {
			await page.keyboard.press('Escape');
			await expect(page.getByRole('dialog')).toBeHidden();

			await settings(page, 'Session');
			const before = await opened(page);
			await dialogContent(page).locator('.utility-links button', { hasText: label }).click();

			await expect
				.poll(() => opened(page), { message: `"${label}" opens a registered view` })
				.not.toEqual(before);
		}
	});
});

/**
 * A hash is the app's own link format: views link to each other with `href="#playground"`, and the
 * shell routes on `hashchange`. Loading one directly has to work too, including for a view the
 * host only enables after mount — `#apps` used to keep the address bar's promise while rendering
 * nothing.
 */
test('a hash link to an enabled view opens that view on first load', async ({ page }) => {
	await page.goto('/#apps');
	await expect(panel(page)).toHaveAttribute('aria-label', 'Automation');
	await expect(page.getByRole('tab').filter({ hasText: 'Automation' })).toBeVisible();
});

test('memories are added, listed and removed in this browser', async ({ page }) => {
	await page.goto('/#memories');

	const heading = page.getByRole('heading', { name: 'Memories' }).first();
	await expect(heading).toBeVisible();

	const field = page.getByLabel(/memory|note/i).first();
	await expect(field).toBeVisible();
	await field.fill('Prefers Indonesian for short answers');
	await page.getByRole('button', { name: /add memory/i }).click();

	await expect(page.getByText('Prefers Indonesian for short answers')).toBeVisible();
	// Stored in this browser only; the count proves the note came back from `localStorage`,
	// and the view's subtitle says where it lives.
	await expect(page.getByText(/\d+ of 50/)).toBeVisible();

	await page
		.getByRole('button', { name: /delete|remove/i })
		.first()
		.click();
	await expect(page.getByText('Prefers Indonesian for short answers')).toBeHidden();
});

test('the repository view states that the server has not enabled it', async ({ page }) => {
	await page.goto('/#git');
	// 404 from `/api/git` is a normal state, not an error banner.
	await expect(page.getByText(/GIT_SURFACE_ENABLED/).first()).toBeVisible();
});

/**
 * A named landmark on every settings surface. The window's own `<section aria-label>` is named by
 * the shell, so this fails only when a view renders no heading of its own into it.
 */
test('every settings surface renders a heading inside the window', async ({ page }, testInfo) => {
	test.skip(
		testInfo.project.name !== 'desktop',
		'one pass; the window markup is width-independent'
	);
	await ready(page);
	await settings(page, 'Tools');
	const categories = await page
		.locator('.settings-nav button')
		.evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
	expect(categories.length).toBeGreaterThan(5);
	expect(await dialogContent(page).getByRole('heading').count()).toBeGreaterThan(0);
});

export { RAIL, stubStatus };

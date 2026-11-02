import { expect, test, type Page } from '@playwright/test';

/**
 * Empty, loading, degraded and error states, forced rather than hoped for.
 *
 * `docs/empty-states-2026-11-02.md` records the anatomy and the surface × dependency matrix.
 * This suite is the same claim in executable form.
 *
 * **What can be forced from a browser, and what cannot.** This app has two transports:
 *
 *   - `/api/mcp/apps`, `/api/git`, `/api/automations/run` and `/api/manef/*` are real server
 *     routes, so `page.route` intercepts them and every state of those surfaces is forcible.
 *   - `/api/backends`, `/api/chat`, `/api/automation/status`, `/api/sessions` and the rest are
 *     answered by the in-page dispatch in `src/lib/http.local.ts`. `get()` calls that dispatch
 *     directly and never touches `fetch`, so neither `page.route` nor a `window.fetch` shim
 *     reaches it. A test that stubs those paths passes while testing nothing, which is worse
 *     than no test.
 *
 * The four device-list states (loading / error / empty / ready) are therefore proved by
 * `src/lib/view_states.spec.ts`, which tests the exact predicate the three views branch on.
 * This file covers what a browser can genuinely produce: the real-route surfaces, and the
 * in-page stub's own degraded answers.
 */

const CHAT_READY = '#chat-message';

async function boot(page: Page): Promise<void> {
	await page.goto('/');
	await expect(page.locator(CHAT_READY)).toBeEnabled();
}

/** Opens a settings surface through the user menu, the control a person actually has. */
async function settings(page: Page, label: string): Promise<void> {
	await page.getByRole('button', { name: 'User menu' }).first().click();
	await page.locator('.workspace-overflow-item', { hasText: /^Settings$/ }).click();
	await page.locator('.settings-nav button', { hasText: label }).click();
}

test.describe('loading is never answered with empty copy', () => {
	test('MCP apps says it is still reading, not that no app exists', async ({ page }) => {
		// Hold the request open. A resolved 404 is the degraded state and is covered below; this
		// test is about the window before any answer arrives.
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		await page.route('**/api/mcp/apps', async (route) => {
			await held;
			await route.fulfill({ status: 404, body: '{}' });
		});

		await boot(page);
		await settings(page, 'MCP apps');

		await expect(page.getByText(/Reading the configured app list/).first()).toBeVisible();
		// The defect this test exists for: a loading window that reads as "no app configured".
		await expect(page.getByText(/No MCP app is configured/)).toHaveCount(0);

		release();
		await expect(page.getByText(/The app host is switched off/).first()).toBeVisible();
	});

	test('MANEF AI does not read an empty registry while it is still reading', async ({ page }) => {
		await page.route('**/api/manef/modules', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1200));
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ foundationVersion: '1.0.0', modules: [] })
			});
		});

		await boot(page);
		await page.getByRole('button', { name: 'MANEF AI' }).first().click();

		await expect(page.getByText(/Reading the hub's module declarations/).first()).toBeVisible();
		await expect(page.getByText(/No module declarations came back/)).toHaveCount(0);
		await expect(page.getByText(/No module declarations came back/).first()).toBeVisible();
	});
});

test.describe('a degraded build says which piece is missing and who can fix it', () => {
	test('MCP apps names the switch that is off', async ({ page }) => {
		// `/api/mcp/apps` answers 404 until MCP_APPS_ENABLED is set; the real route does this.
		await boot(page);
		await settings(page, 'MCP apps');

		await expect(page.getByText(/The app host is switched off/).first()).toBeVisible();
		await expect(page.getByText(/A server operator can change this/).first()).toBeVisible();
	});

	test('MCP apps separates a switch that is off from a configuration it cannot read', async ({
		page
	}) => {
		await page.route('**/api/mcp/apps', (route) =>
			route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'MCP_APPS_JSON is not valid JSON.' })
			})
		);

		await boot(page);
		await settings(page, 'MCP apps');

		await expect(page.getByText(/cannot read its configuration/).first()).toBeVisible();
		await expect(page.getByText(/The app host is switched off/)).toHaveCount(0);
	});

	test('Automation names the missing schedule store and who can add one', async ({ page }) => {
		await boot(page);
		await settings(page, 'Scheduled tasks');

		await expect(page.getByText(/No schedule store is configured/).first()).toBeVisible();
		await expect(page.getByText(/A server operator can change this/).first()).toBeVisible();
		// Zero rows must not be claimed when the store was never reachable.
		await expect(page.getByText(/No automations recorded/)).toHaveCount(0);
	});

	test('the repository view names the switch an operator can turn on', async ({ page }) => {
		await boot(page);
		await settings(page, 'Repository');

		await expect(page.getByText(/The git surface is switched off/).first()).toBeVisible();
		await expect(page.getByText(/GIT_SURFACE_ENABLED/).first()).toBeVisible();
	});

	test('Compute names the absent endpoint transport as a build difference', async ({ page }) => {
		await boot(page);
		await settings(page, 'Compute & devices');

		await expect(page.getByText(/No endpoint provider is set up/).first()).toBeVisible();
		await expect(page.getByText(/The desktop app is the build that does/).first()).toBeVisible();
	});
});

test.describe('an empty store is named as empty, not as broken', () => {
	test('MCP apps names a zero-entry allowlist as a complete list', async ({ page }) => {
		await page.route('**/api/mcp/apps', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ apps: [], blocked: 0 })
			})
		);

		await boot(page);
		await settings(page, 'MCP apps');

		await expect(page.getByText(/No MCP app is configured/).first()).toBeVisible();
		await expect(
			page.getByText(/this is a complete list, not a partial one/).first()
		).toBeVisible();
	});

	test('MANEF AI names a registry that answered with no modules', async ({ page }) => {
		await page.route('**/api/manef/modules', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ foundationVersion: '1.0.0', modules: [] })
			})
		);

		await boot(page);
		await page.getByRole('button', { name: 'MANEF AI' }).first().click();

		await expect(page.getByText(/No module declarations came back/).first()).toBeVisible();
		await expect(page.getByText(/A server operator can change this/).first()).toBeVisible();
	});
});

test.describe('a real failure gets an alert and a retry that can work', () => {
	test('MCP apps reports a failed read with the reason the server gave', async ({ page }) => {
		await page.route('**/api/mcp/apps', (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'MCP_APPS_JSON is not valid JSON.' })
			})
		);

		await boot(page);
		await settings(page, 'MCP apps');

		const alert = page.getByRole('alert').filter({ hasText: 'The app list did not load' });
		await expect(alert).toBeVisible();
		await expect(alert).toContainText('MCP_APPS_JSON is not valid JSON.');
		await expect(page.getByRole('button', { name: 'Request the list again' })).toBeVisible();
	});

	test('the repository view reports a failed read as failed, not as disabled', async ({ page }) => {
		await page.route('**/api/git', (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'the repository could not be read' })
			})
		);

		await boot(page);
		await settings(page, 'Repository');

		await expect(page.getByText(/the repository could not be read/).first()).toBeVisible();
		await expect(page.getByText(/The git surface is switched off/)).toHaveCount(0);
	});
});

test.describe('the shell does not claim a connection it does not have', () => {
	test('the in-page stub is labelled as a stub, not as connected', async ({ page }) => {
		await boot(page);
		// This build answers every request from a stub in the page. "Workspace ready" and a
		// filled dot over that was the false claim this pass removes.
		const status = page.locator('.titlebar-status').first();
		await expect(status).toHaveText(/In-page stub/);
		await expect(status).not.toHaveText(/Workspace ready/);
		const dot = page.locator('.connection-dot').first();
		await expect(dot).toHaveAttribute('title', /In-page stub/);
	});
});

test.describe('every in-page degraded answer names the desktop app, not an error', () => {
	const SURFACES = [
		{
			name: 'Transcribe',
			open: (page: Page) => page.getByRole('button', { name: 'Transcribe' }).first().click(),
			marker: /No speech model in this build/
		},
		{
			name: 'Embedding search',
			open: async (page: Page) => {
				await page.getByRole('button', { name: 'More tools' }).first().click();
				await page.getByRole('menuitem', { name: 'Embedding search' }).click();
			},
			marker: /Install an embedding model to try this/
		},
		{
			name: 'Setup check',
			open: (page: Page) => settings(page, 'Setup check'),
			marker: /Not configured/
		}
	] as const;

	for (const surface of SURFACES) {
		test(`${surface.name} names the missing piece without an alert`, async ({ page }) => {
			await boot(page);
			await surface.open(page);

			await expect(page.getByText(surface.marker).first()).toBeVisible();
			// Degraded is not an error: no alert for a build difference.
			await expect(
				page.locator('#workspace [role="alert"]').filter({ hasText: /runtime behind it/ })
			).toHaveCount(0);
		});
	}
});

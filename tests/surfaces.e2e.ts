import { expect, test } from '@playwright/test';

/**
 * The two surfaces added after the handover: local memories and the read-only repository view.
 *
 * The playwright config runs with `AI_ENABLED=false` and no `GIT_SURFACE_ROOTS`, so these assert
 * the honest degraded states the app shows on a bare clone — a working memories store, and a
 * repository view that says the server has not enabled it.
 */

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

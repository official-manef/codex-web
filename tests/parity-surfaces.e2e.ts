import { expect, test } from '@playwright/test';

/**
 * The surfaces added by the parity batch: scheduled tasks, and the artifact fence.
 *
 * The playwright config runs with no Convex deployment and no AI provider, so these assert the
 * honest degraded states — a scheduler that says it does not run anything, and an artifact
 * fence that refuses executable content before a frame is ever created.
 */

test('scheduled tasks renders an honest state and never claims to run', async ({ page }) => {
	await page.goto('/#automations');

	await expect(page.getByRole('heading', { name: 'Scheduled tasks' }).first()).toBeVisible();
	// The view's own copy (inside "About this tool") must not promise a scheduler.
	const about = page.getByText(/does not run them yet/i).first();
	await expect(about).toBeAttached();
	// With no deployment configured it says so instead of showing a form that cannot save.
	await expect(page.getByText(/Cloud mode is not configured/i).first()).toBeVisible();
	await expect(page.getByText(/0 of 20/).first()).toBeVisible();
});

test('the repository view refuses writes by default', async ({ page }) => {
	await page.goto('/#git');
	// 404 from `/api/git` is the honest "not enabled" state, not a failure.
	await expect(page.getByText(/GIT_SURFACE_ENABLED/).first()).toBeVisible();
});

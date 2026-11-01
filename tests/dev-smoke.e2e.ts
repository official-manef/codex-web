import { expect, test, type Page } from '@playwright/test';

/** Console and page errors seen before navigation and during hydration. */
function collectErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	page.on('pageerror', (error) => errors.push(error.message));
	return errors;
}

test('fresh clone boots without credentials and hydrates the workspace shell', async ({ page }) => {
	const errors = collectErrors(page);
	await page.goto('/');

	// The shell's own landmarks: menubar, rail, sidebar and the unstarted heading.
	await expect(page.getByRole('menubar', { name: 'Workspace menu' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Chat', exact: true }).first()).toBeVisible();
	await expect(page.getByRole('heading', { name: /What would you like to do\?/ })).toBeVisible();

	// No credentials configured: the composer is present and usable.
	const composer = page.getByRole('combobox').first();
	await expect(composer).toBeVisible();
	await expect(composer).toBeEnabled();

	expect(errors).toEqual([]);
});

test('a local send produces a timeline entry and a stub reply', async ({ page }) => {
	await page.goto('/');

	const composer = page.getByRole('combobox').first();
	await composer.fill('Hello from the template');
	await composer.press('Enter');

	const log = page.getByRole('log', { name: 'Conversation' });
	await expect(log).toContainText('Hello from the template');
	// The stub names itself: no reply is generated and no provider is configured.
	await expect(log.getByText(/No provider configured/).first()).toBeVisible();
});

test('settings destinations open the settings window, not the primary region', async ({ page }) => {
	await page.goto('/#faq');
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	// The window renders the section title twice (nav heading and content heading), which
	// is the shell's own markup; assert on the count instead of forcing uniqueness.
	await expect(dialog.getByRole('heading', { name: 'Help & limits' })).toHaveCount(2);

	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).toBeHidden();
});

test('rail navigation reaches a lazily loaded feature screen', async ({ page }) => {
	await page.goto('/');
	// In dev the module graph hydrates later than the markup; wait for the composer to be
	// interactive before clicking, or the click lands on a not-yet-bound button.
	const composer = page.getByRole('combobox').first();
	await expect(composer).toBeVisible();
	await expect(composer).toBeEnabled();
	await page.getByRole('button', { name: 'Files', exact: true }).first().click();
	await expect(page).toHaveURL(/#files$/);
	await expect(page.getByText('Choose files or a folder', { exact: false })).toBeVisible();
});

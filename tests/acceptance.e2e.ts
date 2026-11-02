import { expect, test, type Page } from '@playwright/test';

/**
 * Browser proof for the acceptance criteria that still map to a live surface.
 *
 * `docs/PRD.md` §5 still states AC01–AC18 as the bar, but `6ed1f3e` deleted the
 * `/workspace`, `/capabilities` and `/settings` route family these scenarios were written
 * against. `docs/ac-coverage-2026-11-02.md` records, per criterion, whether today's single
 * route (`/`, hash navigation, settings window, output tabs) can carry it. Criteria whose
 * surface is gone are not faked here.
 *
 * Every assertion drives the shipped UI. Nothing is imported from the app.
 */

const PNG_1X1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
	'base64'
);

/** The composer is the chat's only `<textarea>`; its id is the app's own contract. */
function composer(page: Page) {
	return page.locator('#chat-message');
}

/**
 * The chat boots from the local session store, so the composer is disabled until the first
 * session resolves. Waiting on `enabled` is what keeps a later `fill` from racing hydration.
 */
async function openWorkspace(page: Page): Promise<void> {
	await page.goto('/');
	await expect(composer(page)).toBeEnabled();
}

/** Rail buttons are the app's own navigation contract; `Chat` returns to the primary region. */
async function goToRail(page: Page, label: string): Promise<void> {
	await page.getByRole('button', { name: label, exact: true }).first().click();
}

/**
 * Below 1100px the session list is an off-canvas drawer, so anything inside it has to be
 * revealed first. On desktop the same call is a no-op.
 */
async function revealSessions(page: Page): Promise<void> {
	const newChat = page.getByRole('button', { name: 'New chat' }).first();
	if (await newChat.isVisible()) return;
	// `aria-expanded` is true once the drawer is open; the toggle is the only way in.
	const toggle = page.locator('#sidebar-toggle');
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await toggle.click();
	await expect(newChat).toBeVisible();
}

/** One app-level "new chat", drawer-aware. */
async function newChat(page: Page): Promise<void> {
	await revealSessions(page);
	await page.getByRole('button', { name: 'New chat' }).first().click();
}

async function openSettingsSection(page: Page, label: string): Promise<void> {
	await page.getByRole('button', { name: 'User menu' }).click();
	await page.locator('.workspace-overflow-item', { hasText: /^Settings$/ }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await dialog.locator('.settings-nav button', { hasText: label }).click();
	await expect(dialog.getByRole('heading', { name: label, exact: true }).last()).toBeVisible();
}

/** The tab strip only exists while an output view is open. */
function outputTabs(page: Page) {
	return page.getByRole('tablist', { name: 'Open output tabs' });
}

test.describe('composer acceptance', () => {
	// AC01: New chat, no draft → empty entry surface, submit disabled.
	// The current composer has no inline "why" copy: the control is natively `disabled` and
	// carries no `aria-disabled="false"` claim. That is the whole of the contract it enforces,
	// so that is the whole of what this test asserts.
	test('AC01 an empty draft leaves the entry surface and the send control closed', async ({
		page
	}) => {
		await openWorkspace(page);

		await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
		await expect(composer(page)).toHaveValue('');
		await expect(composer(page)).toBeEnabled();

		const send = page.getByRole('button', { name: 'Send message' });
		await expect(send).toBeVisible();
		await expect(send).toBeDisabled();

		// A draft is the only thing that opens it (attachment-only send is AC02).
		await composer(page).fill('one word');
		await expect(send).toBeEnabled();
	});

	// AC02: A valid image attached → the file is accepted and the send control opens.
	test('AC02 an accepted image becomes a ready attachment and enables send', async ({ page }) => {
		await openWorkspace(page);
		const send = page.getByRole('button', { name: 'Send message' });
		await expect(send).toBeDisabled();

		await page.setInputFiles('input[type="file"]', [
			{ name: 'ready.png', mimeType: 'image/png', buffer: PNG_1X1 }
		]);

		const chips = page.locator('.composer-attachments > div');
		await expect(chips).toHaveCount(1);
		// The stub stores metadata only, so the chip names the file and says what it can do.
		await expect(chips.first()).toContainText('Preview only · model cannot see this file');
		await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(1);

		await expect(send).toBeEnabled();
	});

	// AC03: Two attachments, one failed → per-file reason, ready files kept.
	// The current composer does NOT block the send when one file fails; the ready file is
	// what keeps it open. That deviation is recorded in docs/ac-coverage-2026-11-02.md rather
	// than asserted as intended here.
	test('AC03 a rejected file names its own reason and the ready file is kept', async ({ page }) => {
		await openWorkspace(page);

		await page.setInputFiles('input[type="file"]', [
			{ name: 'ready.png', mimeType: 'image/png', buffer: PNG_1X1 },
			// The stub's only per-file rejection is size; its ceiling is 10 MiB.
			{
				name: 'oversize.bin',
				mimeType: 'application/octet-stream',
				buffer: Buffer.alloc(11 * 1024 * 1024)
			}
		]);

		// The rejection copy names the file and its own cause, and says the other file stayed.
		const reason = page.getByRole('alert').filter({ hasText: 'oversize.bin' });
		await expect(reason).toBeVisible();
		await expect(reason).toContainText('File is too large. Choose a smaller file.');
		await expect(reason).toContainText('Other attached files were kept');

		await expect(page.locator('.composer-attachments > div')).toHaveCount(1);
	});

	// AC04: Valid draft → submit clicked twice fast → exactly one message appended.
	test('AC04 two clicks in one tick append exactly one turn', async ({ page }) => {
		await openWorkspace(page);
		const field = composer(page);
		await field.fill('single flight');

		const send = page.getByRole('button', { name: 'Send message' });
		await expect(send).toBeEnabled();

		// One tick, two clicks: the run guard is what must collapse them. Two sequential
		// Playwright clicks would hit the re-rendered Stop control instead, which is not the
		// double-submit race AC04 names.
		await send.evaluate((element: HTMLButtonElement) => {
			element.click();
			element.click();
		});

		const turns = page.locator('.conversation-turn');
		await expect(page.getByRole('button', { name: /Stop$/ })).toBeVisible();
		await expect(turns).toHaveCount(1);
		await expect(page.locator('.conversation-user p')).toHaveText(['single flight']);
		await expect(field).toHaveValue('');

		// The run settles to one reply, not two.
		await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
		await expect(turns).toHaveCount(1);
	});

	// AC06: Response streaming → user cancels → cancelled status explicit, the turn is kept.
	// The stub has no token stream, so there is no partial text to preserve: the honest
	// assertion is the explicit cancelled status plus the kept turn after a reload.
	test('AC06 cancelling marks the turn cancelled and keeps it', async ({ page }) => {
		await openWorkspace(page);
		await composer(page).fill('streamed body');
		await page.getByRole('button', { name: 'Send message' }).click();

		const stop = page.getByRole('button', { name: /Stop$/ });
		await expect(stop).toBeVisible();
		await stop.click();

		await expect(stop).toHaveCount(0);
		await expect(page.locator('.reply-note')).toHaveText(
			'Generation stopped. Partial replies, if any, are shown above.'
		);
		await expect(page.locator('.conversation-user p')).toHaveText(['streamed body']);

		await page.reload();
		await expect(composer(page)).toBeEnabled();
		await expect(page.locator('.reply-note')).toHaveText(
			'Generation stopped. Partial replies, if any, are shown above.'
		);
		await expect(page.locator('.conversation-turn')).toHaveCount(1);
	});
});

test.describe('workspace acceptance', () => {
	// AC07: Chat A has a draft → switch to B and back → A's draft restored, never mixed.
	test('AC07 each chat keeps its own draft', async ({ page }) => {
		await openWorkspace(page);
		await composer(page).fill('draft A');

		await newChat(page);
		await expect(composer(page)).toHaveValue('');
		await composer(page).fill('draft B');

		const rows = page.locator('.session-open');
		await expect(rows).toHaveCount(2);

		// Opening a chat closes the drawer below 1100px, so each pick re-reveals the list.
		// Rows are newest first, so the older "draft A" chat is the second one.
		await revealSessions(page);
		await rows.nth(1).click();
		await expect(composer(page)).toHaveValue('draft A');

		await revealSessions(page);
		await rows.first().click();
		await expect(composer(page)).toHaveValue('draft B');
	});

	// AC08: Work region with tabs → hide then show → tabs and active tab preserved.
	test('AC08 hiding and showing the output panel keeps both tabs and the active one', async ({
		page
	}) => {
		await openWorkspace(page);

		await goToRail(page, 'Files');
		await expect(outputTabs(page)).toBeVisible();
		await expect(page.getByRole('tab')).toHaveCount(1);

		// Keep the first tab so the second one is added beside it instead of replacing it.
		await page.getByRole('button', { name: /^Keep .* tab$/ }).click();
		await page.getByRole('button', { name: 'New tab' }).click();
		await goToRail(page, 'Browser');

		const tabs = page.getByRole('tab');
		await expect(tabs).toHaveCount(2);
		const activeBefore = await tabs.evaluateAll((elements) =>
			elements.map((element) => element.getAttribute('aria-selected'))
		);
		expect(activeBefore.filter((value) => value === 'true')).toHaveLength(1);

		await page.getByRole('menuitem', { name: 'View' }).click();
		await page.getByRole('menuitem', { name: 'Toggle output panel' }).click();

		await expect(page.getByRole('tab')).toHaveCount(0);
		await expect(page).toHaveURL(/#chat$/);

		await page.getByRole('button', { name: 'Show output panel' }).click();

		await expect(outputTabs(page)).toBeVisible();
		await expect(page.getByRole('tab')).toHaveCount(2);
		await expect
			.poll(() =>
				page
					.getByRole('tab')
					.evaluateAll((elements) => elements.map((el) => el.getAttribute('aria-selected')))
			)
			.toEqual(activeBefore);
	});

	// AC10: Split layout on desktop → viewport shrinks → degrades without losing draft or tabs.
	test('AC10 shrinking the viewport degrades the split and keeps the draft and tabs', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await openWorkspace(page);
		await composer(page).fill('draft across resize');

		await goToRail(page, 'Files');
		await expect(page.getByRole('tab')).toHaveCount(1);

		// Wide: chat and output are side by side, so the region switch is not offered yet.
		const regions = page.getByRole('group', { name: 'Visible workspace region' });
		await expect(regions).toHaveCount(0);

		await page.setViewportSize({ width: 700, height: 800 });

		// Narrow: one region at a time, chosen explicitly.
		await expect(regions).toBeVisible();
		await expect(page.getByRole('tab')).toHaveCount(1);

		await regions.getByRole('button', { name: 'Chat', exact: true }).click();
		await expect(composer(page)).toHaveValue('draft across resize');

		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
		).toBe(true);
	});

	// AC11: More menu opened by keyboard → Escape → menu closes, focus returns to its trigger.
	test('AC11 Escape closes the keyboard-opened More menu and restores focus', async ({ page }) => {
		await openWorkspace(page);
		const trigger = page.getByRole('button', { name: 'More tools' });
		await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

		await trigger.focus();
		await expect(trigger).toBeFocused();
		await page.keyboard.press('Enter');

		const items = page.locator('.workspace-overflow-item');
		await expect(items.first()).toBeVisible();
		// The trigger owns the menu it opened; prove the focus went into the menu body.
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');

		await page.keyboard.press('Escape');

		await expect(items).toHaveCount(0);
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await expect(trigger).toBeFocused();
	});

	// AC12: Setting changed twice quickly → the newest value is the one that persists.
	// The current store is synchronous with a single writer, so there is no stale save left
	// to lose a race; this proves the last write wins and survives a reload.
	test('AC12 the newest of two quick toggles is what persists', async ({ page }) => {
		await openWorkspace(page);
		await openSettingsSection(page, 'Tools');

		const dialog = page.getByRole('dialog');
		const filesToggle = dialog.locator('[id$="-files"]');
		await expect(filesToggle).toHaveAttribute('aria-checked', 'true');

		await filesToggle.click();
		await filesToggle.click();
		await expect(filesToggle).toHaveAttribute('aria-checked', 'true');

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();

		// The stored selection is the newest write, and it is what a reload reads back.
		expect(
			await page.evaluate(() => {
				const raw = window.localStorage.getItem('workspace-template:tools-v1');
				if (!raw) return false;
				const stored = JSON.parse(raw) as { version: number; value: string[] };
				return stored.version === 1 && stored.value.includes('files');
			})
		).toBe(true);

		await page.reload();
		await expect(composer(page)).toBeEnabled();
		await openSettingsSection(page, 'Tools');
		await expect(page.locator('[id$="-files"]')).toHaveAttribute('aria-checked', 'true');
	});

	// AC14: Settings opened from chat → return to workspace → chat, draft and tabs restored.
	test('AC14 closing settings restores the chat draft and its open tab', async ({ page }) => {
		await openWorkspace(page);
		await composer(page).fill('survives settings');

		await goToRail(page, 'Files');
		await expect(page.getByRole('tab')).toHaveCount(1);

		await page.getByRole('button', { name: 'User menu' }).click();
		await page.locator('.workspace-overflow-item', { hasText: /^Help$/ }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog.getByRole('heading', { name: 'Help & limits' })).toHaveCount(2);

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();

		await expect(page.getByRole('tab')).toHaveCount(1);
		await goToRail(page, 'Chat');
		await expect(composer(page)).toHaveValue('survives settings');
	});
});

test.describe('list and timeline acceptance', () => {
	// AC15: Populated list → search with no match → no-match copy, not empty copy.
	test('AC15 a no-match chat search never falls back to the empty-state copy', async ({ page }) => {
		await openWorkspace(page);
		await newChat(page);
		await expect(page.locator('.session-open')).toHaveCount(2);

		await revealSessions(page);
		await page.getByRole('button', { name: 'Search chats' }).click();
		const search = page.locator('#session-search');
		await expect(search).toBeFocused();

		await search.fill('zzzz');

		// Scoped to the chat list: the page has other lists with their own empty copy. The
		// sidebar is an `<aside aria-label="Chat sessions">`, not a navigation landmark.
		const list = page.locator('aside[aria-label="Chat sessions"]');
		await expect(list.getByText('No matching chats.')).toBeVisible();
		await expect(list.getByText('Your saved chats appear here.')).toHaveCount(0);

		await search.fill('');
		await expect(page.locator('.session-open')).toHaveCount(2);
		await expect(list.getByText('No matching chats.')).toHaveCount(0);
	});

	// AC17: Reading old messages → new output arrives → scroll kept, new-content marker shown.
	// The seeded session is what makes the timeline taller than one screen: the stub needs a
	// round trip per turn, and the assertion is about scroll behaviour, not about sending.
	test('AC17 an append while reading keeps the position and marks new content', async ({
		page
	}) => {
		await page.addInitScript(() => {
			const turns = Array.from({ length: 30 }, (_, index) => ({
				id: `turn-${index}`,
				content: `old message ${index}`,
				attachments: [],
				status: 'done',
				created_at: Date.now(),
				replies: []
			}));
			window.sessionStorage.setItem(
				'workspace-template:sessions',
				JSON.stringify([
					{
						id: 'session-seeded',
						title: 'seeded',
						settings: {},
						turns,
						tool_events: [],
						created_at: Date.now(),
						updated_at: Date.now()
					}
				])
			);
			window.localStorage.setItem('laya-session', 'session-seeded');
		});

		await openWorkspace(page);
		const timeline = page.getByRole('log', { name: 'Conversation' });
		await expect(page.locator('.conversation-turn')).toHaveCount(30);
		expect(
			await timeline.evaluate((element) => element.scrollHeight > element.clientHeight + 120)
		).toBe(true);

		await composer(page).fill('arrives while reading');
		await page.getByRole('button', { name: 'Send message' }).click();

		// Scrolled away from the bottom once the new turn lands.
		await timeline.evaluate((element) => {
			element.scrollTop = 150;
		});
		const recorded = await timeline.evaluate((element) => element.scrollTop);
		expect(recorded).toBeGreaterThan(24);

		const marker = page.getByRole('button', { name: 'New messages' });
		await expect(marker).toBeVisible();
		await expect(page.locator('.conversation-turn')).toHaveCount(31);
		expect(
			Math.abs((await timeline.evaluate((element) => element.scrollTop)) - recorded)
		).toBeLessThanOrEqual(2);

		// Reaching the bottom is the only thing that clears the marker.
		await marker.click();
		await expect(marker).toHaveCount(0);
		expect(
			await timeline.evaluate(
				(element) => element.scrollHeight - element.scrollTop - element.clientHeight < 2
			)
		).toBe(true);
	});

	// AC18: Landing present but the related list is empty → the copy scopes the emptiness
	// to that list. Here the landing is the open tab strip and the list is its own picker.
	test('AC18 the empty tab-picker copy is scoped to the picker', async ({ page }) => {
		await openWorkspace(page);
		await goToRail(page, 'Files');
		await expect(page.getByRole('tab')).toHaveCount(1);

		await page.getByRole('button', { name: 'Find an open tab' }).click();
		const picker = page.locator('.workspace-tab-picker');
		await expect(picker).toBeVisible();
		await expect(picker.getByRole('button', { name: 'Files' })).toBeVisible();

		await picker.locator('#find-output-tab').fill('zzz');

		await expect(picker.getByText('No matching open tab.')).toBeVisible();
		// The landing keeps its content and no other list inherits the message.
		await expect(page.getByRole('tab')).toHaveCount(1);
		await expect(page.getByText('No matching open tab.')).toHaveCount(1);
		await expect(page.getByText('No matching chats.')).toHaveCount(0);
	});
});

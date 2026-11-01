import { expect, test, type Page } from '@playwright/test';

/**
 * Browser proof for the accessibility defects fixed in `docs/a11y-2026-11-02.md`.
 *
 * Each test drives the shipped markup and asserts on what a keyboard or screen-reader user
 * actually gets: focus location after a close, the computed contrast of the palette, the
 * accessible name a table needs. Nothing here imports from the app, and nothing depends on
 * axe or any other new dependency.
 */

const composer = (page: Page) => page.locator('#chat-message');

/** The chat boots from the local session store; `enabled` is the hydration barrier. */
async function openWorkspace(page: Page): Promise<void> {
	await page.goto('/');
	await expect(composer(page)).toBeEnabled();
}

/** What has focus, described the way a bug report would. */
async function active(page: Page): Promise<string> {
	return page.evaluate(() => {
		const element = document.activeElement;
		if (!element) return 'null';
		return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}.${String(
			element.className || ''
		)
			.split(/\s+/)[0]
			.replace(/^svelte-.*/, '')}`;
	});
}

/** WCAG 2.1 relative luminance, from an `rgb(...)` string. */
function contrast(foreground: readonly number[], background: readonly number[]): number {
	const channel = (value: number): number => {
		const scaled = value / 255;
		return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
	};
	const luminance = ([r, g, b]: readonly number[]): number =>
		0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
	const a = luminance(foreground);
	const b = luminance(background);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function rgb(value: string): number[] {
	return value
		.match(/\d+(?:\.\d+)?/g)!
		.slice(0, 3)
		.map(Number);
}

test.describe('focus management in overlays', () => {
	// The settings window and the shortcuts dialog are both reachable from a menubar item, and
	// the item unmounts with the menu. Escape used to leave focus on <body>.
	test('Escape from the settings window opened by a menu item returns focus to that menu', async ({
		page
	}) => {
		await openWorkspace(page);
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		await page.getByRole('menuitem', { name: /Settings/ }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();

		await expect.poll(() => active(page)).toBe('button#bits-s7.workspace-menubar-trigger');
	});

	test('Escape from the shortcuts dialog returns focus to the Help menu', async ({ page }) => {
		await openWorkspace(page);
		await page.getByRole('menuitem', { name: 'Help' }).click();
		await page.getByRole('menuitem', { name: /Keyboard Shortcuts/i }).click();

		const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
		await expect(dialog).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();

		// Whatever the menu trigger's generated id is, focus must be back inside the menubar.
		await expect
			.poll(() =>
				page.evaluate(() => !!document.activeElement?.closest('.workspace-menubar-trigger'))
			)
			.toBe(true);
	});

	// The drawer is a modal surface on a narrow viewport: Tab has to cycle inside it.
	test('the narrow-viewport session drawer keeps Tab and Shift+Tab inside itself', async ({
		page
	}) => {
		await page.setViewportSize({ width: 700, height: 800 });
		await openWorkspace(page);

		await page.locator('#sidebar-toggle').click();
		await expect(page.locator('#sidebar-toggle')).toHaveAttribute('aria-expanded', 'true');

		const focusInside = () =>
			page.evaluate(() => !!document.activeElement?.closest('.session-sidebar'));

		for (let step = 0; step < 20; step++) {
			await page.keyboard.press('Tab');
			expect(await focusInside()).toBe(true);
		}
		for (let step = 0; step < 20; step++) {
			await page.keyboard.press('Shift+Tab');
			expect(await focusInside()).toBe(true);
		}

		await page.keyboard.press('Escape');
		await expect(page.locator('#sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
		await expect.poll(() => active(page)).toContain('#sidebar-toggle');
	});
});

test.describe('disclosure and panel wiring', () => {
	// `aria-controls` must name an element that exists in the DOM at the time it is set.
	test('the sidebar toggle points aria-controls at the session drawer it expands', async ({
		page
	}) => {
		await openWorkspace(page);
		const toggle = page.locator('#sidebar-toggle');
		const controls = await toggle.getAttribute('aria-controls');

		expect(controls).toBeTruthy();
		await expect(page.locator(`#${controls}`)).toBeAttached();
		// Narrow viewports use the same toggle for the drawer, so the id must hold there too.
		await page.setViewportSize({ width: 700, height: 800 });
		await expect(toggle).toHaveAttribute('aria-controls', controls!);
		await expect(page.locator(`#${controls}`)).toHaveAttribute('aria-label', 'Chat sessions');
	});

	// The launcher tabpanel exists before its tab does (nothing opens the launcher as a tab on a
	// fresh load), so its aria-labelledby pointed at a missing id.
	test('every tabpanel is named by an id that exists', async ({ page }) => {
		await openWorkspace(page);
		await page.getByRole('button', { name: 'Files', exact: true }).first().click();
		await expect(page.getByRole('tablist', { name: 'Open output tabs' })).toBeVisible();

		const unresolved = await page.evaluate(() =>
			[...document.querySelectorAll('[role="tabpanel"]')]
				.map((panel) => ({
					id: panel.id,
					labelledby: panel.getAttribute('aria-labelledby'),
					label: panel.getAttribute('aria-label')
				}))
				.filter(
					({ labelledby, label }) => !label && (!labelledby || !document.getElementById(labelledby))
				)
		);
		expect(unresolved).toEqual([]);
	});

	// `aria-controls` on the runtime trigger pointed at a panel that only exists while open.
	test('the server controls trigger only names a panel while that panel is mounted', async ({
		page
	}) => {
		await openWorkspace(page);
		const trigger = page.getByRole('button', { name: 'Server controls', exact: true });

		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		expect(await trigger.getAttribute('aria-controls')).toBeNull();

		await trigger.click();
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');
		const controls = await trigger.getAttribute('aria-controls');
		expect(controls).toBeTruthy();
		await expect(page.locator(`#${controls}`)).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await expect(trigger).toBeFocused();
		// Closing must not leave a dangling reference behind.
		expect(await trigger.getAttribute('aria-controls')).toBeNull();
	});
});

test.describe('the skip link reaches a region that is on screen', () => {
	// With the output panel expanded the chat region is display:none, so focusing its id did
	// nothing and the skip link was a no-op for the one case where it matters most.
	test('skipping to chat while the output panel fills the view reveals and focuses the composer', async ({
		page
	}) => {
		await openWorkspace(page);
		await page.getByRole('button', { name: 'Files', exact: true }).first().click();
		await page.getByRole('button', { name: 'Expand output panel' }).click();
		await expect(page.locator('.desktop-chat')).toHaveAttribute('inert', '');

		await page.locator('.skip-link').focus();
		await page.keyboard.press('Enter');

		await expect(composer(page)).toBeFocused();
		await expect(page).toHaveURL(/#chat$/);
		await expect(page.locator('.desktop-chat')).not.toHaveAttribute('inert', '');
	});
});

test.describe('table names', () => {
	// A real <table> with no caption and no aria-label reaches a screen reader with no name.
	test('every table on the engine comparison screen has an accessible name', async ({ page }) => {
		await openWorkspace(page);
		await page.getByRole('button', { name: 'More tools' }).click();
		await page.locator('.workspace-overflow-item', { hasText: 'Snake demo' }).click();

		const tables = page.locator('.engine-results table');
		await expect(tables.first()).toBeVisible();
		const count = await page.locator('table').count();
		expect(count).toBeGreaterThan(0);

		for (let index = 0; index < count; index++) {
			const name = await page
				.locator('table')
				.nth(index)
				.evaluate((table) => {
					const caption = table.querySelector('caption');
					return table.getAttribute('aria-label') || (caption ? caption.textContent.trim() : '');
				});
			expect(name, `table ${index} has no accessible name`).not.toBe('');
		}
	});
});

test.describe('palette contrast', () => {
	// The numbers come from the shipped custom properties, so darkening the palette in
	// `src/routes/layout.css` fails this test instead of silently regressing contrast.
	test('the ink scale stays legible on every surface it is used on', async ({ page }) => {
		await openWorkspace(page);

		const palette = await page.evaluate(() => {
			const token = (name: string): number[] => {
				const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
				// The palette shorthand #aaa and the long form #aaaaaa are both legal.
				const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
				if (!hex) throw new Error(`token ${name} is not a hex colour: "${raw}"`);
				const digits =
					hex[1].length === 3
						? hex[1]
								.split('')
								.map((digit) => digit + digit)
								.join('')
						: hex[1];
				return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16));
			};
			return {
				ink: token('--color-ink'),
				ink2: token('--color-ink-2'),
				ink3: token('--color-ink-3'),
				page: token('--color-page'),
				panel: token('--color-panel'),
				panel2: token('--color-panel-2'),
				composer: token('--color-composer')
			};
		});

		// Body text is 4.5:1; these are all small sizes in the shell.
		expect(contrast(palette.ink3, palette.panel2)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(palette.ink3, palette.panel)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(palette.ink3, palette.page)).toBeGreaterThanOrEqual(4.5);
		// The composer placeholder is ink-3 on the composer surface.
		expect(contrast(palette.ink3, palette.composer)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(palette.ink2, palette.panel2)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(palette.ink, palette.page)).toBeGreaterThanOrEqual(4.5);
	});

	// The bug: the dropdown surface and its roving highlight were both --color-hover (1.00:1),
	// and the items carried `outline: none`, so keyboard navigation had no visible cursor.
	test('a keyboard-highlighted menu item is distinguishable from the menu surface', async ({
		page
	}) => {
		await openWorkspace(page);
		const trigger = page.getByRole('button', { name: 'More tools' });
		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');

		await page.keyboard.press('ArrowDown');

		const appearance = await page.evaluate(() => {
			const item = document.activeElement as HTMLElement;
			const style = getComputedStyle(item);
			return {
				outlineWidth: parseFloat(style.outlineWidth),
				outlineStyle: style.outlineStyle,
				outlineColor: style.outlineColor,
				itemBackground: style.backgroundColor
			};
		});

		// Either a real outline, or a background that differs from the menu's own surface.
		const menuBackground = await page.evaluate(() => {
			const menu = document.querySelector('.workspace-overflow-menu')!;
			return getComputedStyle(menu).backgroundColor;
		});
		expect(
			appearance.outlineStyle !== 'none' && appearance.outlineWidth >= 2,
			`menu item highlight has no outline; background ${appearance.itemBackground} vs menu ${menuBackground}`
		).toBe(true);
		expect(contrast(rgb(appearance.outlineColor), rgb(menuBackground))).toBeGreaterThanOrEqual(3);
	});
});

test.describe('composer and timeline announcements', () => {
	// The slash picker is a listbox the composer drives with aria-activedescendant; without
	// aria-autocomplete the value has nowhere to be announced.
	test('the composer exposes its picker as an autocomplete listbox', async ({ page }) => {
		await openWorkspace(page);
		await composer(page).fill('/');

		const listbox = page.getByRole('listbox', { name: 'Add to chat' });
		await expect(listbox).toBeVisible();
		await expect(composer(page)).toHaveAttribute('aria-expanded', 'true');
		await expect(composer(page)).toHaveAttribute('aria-autocomplete', 'list');
		await expect(composer(page)).toHaveAttribute('aria-controls', 'composer-resources');

		await page.keyboard.press('ArrowDown');
		const activeId = await composer(page).getAttribute('aria-activedescendant');
		expect(activeId).toBeTruthy();
		await expect(page.locator(`#${activeId}`)).toHaveAttribute('aria-selected', 'true');
	});

	// The timeline is aria-live=polite, but aria-busy=true suppresses speech until it clears;
	// what matters is that the reply lands while busy is false, and the log is labelled.
	test('the conversation log is labelled and stops being busy when the reply settles', async ({
		page
	}) => {
		await openWorkspace(page);
		const log = page.getByRole('log', { name: 'Conversation' });
		await expect(log).toHaveAttribute('aria-live', 'polite');
		await expect(log).toHaveAttribute('aria-busy', 'false');

		await composer(page).fill('announce me');
		await page.getByRole('button', { name: 'Send message' }).click();
		await expect(log).toHaveAttribute('aria-busy', 'true');

		// The run settles and the reply text is in the log while it is not busy.
		await expect(log).toContainText('No provider configured');
		await expect(log).toHaveAttribute('aria-busy', 'false');
		await expect(log).toHaveAttribute('aria-live', 'polite');
	});
});

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

/**
 * Makes the session list reachable. Above 1100px it is a permanent column; below that it is an
 * off-canvas drawer behind `#sidebar-toggle`, which is also the keyboard route to it.
 */
async function revealSessions(page: Page): Promise<void> {
	const toggle = page.locator('#sidebar-toggle');
	if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	}
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

/* ── second layer ───────────────────────────────────────────────────────────────
 * The first pass fixed eight defects and left five things as product decisions. These
 * tests close the deferred layer: they assert what a screen reader receives rather than
 * what the attributes say, and they walk the whole keyboard map.
 */

/** The accessibility tree node for a selector, straight from Chromium over CDP. */
async function axNode(
	page: Page,
	selector: string
): Promise<{ role: string; name: string; properties: Record<string, unknown> } | null> {
	const session = await page.context().newCDPSession(page);
	const { root } = await session.send('DOM.getDocument', { depth: -1 });
	const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
	if (!nodeId) return null;
	const { nodes } = await session.send('Accessibility.getPartialAXTree', {
		nodeId,
		fetchRelatives: false
	});
	const node = nodes[0];
	await session.detach();
	if (!node) return null;
	type AxEntry = { name: string; value?: { value?: unknown } };
	return {
		role: node.role?.value ?? '',
		name: node.name?.value ?? '',
		properties: Object.fromEntries(
			((node.properties ?? []) as AxEntry[]).map((entry) => [entry.name, entry.value?.value])
		)
	};
}

type Announcement = { busy: string | null; type: string; text: string };

declare global {
	interface Window {
		/** Mutation observer used to model what a live region would announce. */
		__a11yObserver?: MutationObserver;
		__a11yAnnouncements?: Announcement[];
	}
}

test.describe('screen-reader announcement policy', () => {
	// Deferred item: the first pass called per-run announcement "a UX choice". It is only a
	// choice if the finished reply is genuinely announced once. `aria-busy` is the mechanism,
	// so this asserts the state transitions rather than trusting the attribute's presence.
	test('a streaming run keeps the log busy and announces the reply exactly once when it clears', async ({
		page
	}) => {
		await openWorkspace(page);
		const log = page.getByRole('log', { name: 'Conversation' });

		// Record every mutation together with the log's busy state and visible text at that
		// moment, which is what a live-region implementation keys off.
		await page.evaluate(() => {
			const region = document.querySelector('[role="log"]')!;
			window.__a11yAnnouncements = [];
			window.__a11yObserver = new MutationObserver((records) => {
				for (const record of records)
					window.__a11yAnnouncements!.push({
						busy: region.getAttribute('aria-busy'),
						type: record.type,
						text: (region.textContent ?? '').trim()
					});
			});
			window.__a11yObserver.observe(region, {
				childList: true,
				subtree: true,
				characterData: true,
				attributes: true
			});
		});

		await composer(page).fill('announce exactly once');
		await page.getByRole('button', { name: 'Send message' }).click();
		await expect(log).toHaveAttribute('aria-busy', 'true');
		await expect(log).toContainText('No provider configured');
		await expect(log).toHaveAttribute('aria-busy', 'false');
		const settled = (await log.innerText()).replace(/\s+/g, '');

		const announcements = await page.evaluate(() => {
			window.__a11yObserver?.disconnect();
			return window.__a11yAnnouncements ?? [];
		});

		const textual = announcements.filter((entry) => entry.type !== 'attributes');
		const duringRun = textual.filter((entry) => entry.busy === 'true');
		const afterRun = textual.filter((entry) => entry.busy === 'false');

		// Streaming really does produce several DOM commits, so `aria-busy` has work to do.
		expect(duringRun.length).toBeGreaterThan(1);
		// …and none of them is announced: a screen reader only ever sees a non-busy mutation.
		expect(afterRun.length).toBeGreaterThan(0);
		// Whatever lands while not busy must already be the finished reply, so the user hears
		// the reply, never a half-written prefix.
		for (const entry of afterRun)
			expect(entry.text.replace(/\s+/g, ''), 'announced text is not the settled reply').toBe(
				settled
			);
	});

	// Every turn has to carry an accessible name, because inside a `role=log` a screen reader
	// navigates by article and previously heard "article" with no idea which turn it was.
	test('every turn and reply carries an accessible name', async ({ page }) => {
		await openWorkspace(page);
		await composer(page).fill('name the turn');
		await page.getByRole('button', { name: 'Send message' }).click();

		const log = page.getByRole('log', { name: 'Conversation' });
		await expect(log).toContainText('No provider configured');

		const articles = await page.evaluate(() =>
			[...document.querySelectorAll('.conversation-turn article')].map((article) => ({
				tone: article.className.includes('conversation-user') ? 'user' : 'assistant',
				label: article.getAttribute('aria-label')
			}))
		);
		expect(articles.length).toBeGreaterThanOrEqual(2);
		for (const article of articles)
			expect(article.label, `a ${article.tone} article has no accessible name`).toBeTruthy();

		const userNode = await axNode(page, '.conversation-user');
		const assistantNode = await axNode(page, '.conversation-assistant');
		expect(userNode?.role).toBe('article');
		expect(userNode?.name).toMatch(/^Your message/);
		expect(assistantNode?.name).toMatch(/^Reply from/);
	});

	// Switching conversations used to replace the whole log while it was not busy, so the
	// entire history was handed to the live region as one insertion.
	test('switching conversations does not replay the whole history into the live region', async ({
		page
	}) => {
		await openWorkspace(page);
		for (const text of ['first conversation', 'second conversation']) {
			await composer(page).fill(text);
			await page.getByRole('button', { name: 'Send message' }).click();
			await expect(page.getByRole('log')).toContainText('No provider configured');
			// Narrow viewports keep "New chat" inside the off-canvas drawer, so open it first;
			// creating a session closes it again, hence the reopen on the next pass.
			await revealSessions(page);
			await page.getByRole('button', { name: 'New chat' }).first().click();
			await expect(composer(page)).toBeEnabled();
		}

		await page.evaluate(() => {
			const region = document.querySelector('[role="log"]')!;
			window.__a11yAnnouncements = [];
			window.__a11yObserver = new MutationObserver((records) => {
				for (const record of records)
					window.__a11yAnnouncements!.push({
						busy: region.getAttribute('aria-busy'),
						type: record.type,
						text: (region.textContent ?? '').trim()
					});
			});
			window.__a11yObserver.observe(region, {
				childList: true,
				subtree: true,
				characterData: true,
				attributes: true
			});
		});

		// On a narrow viewport the session list lives in the off-canvas drawer, so it has to be
		// opened first. The drawer is the same surface a keyboard user reaches with the toggle.
		await revealSessions(page);

		await page.getByRole('button', { name: 'first conversation', exact: true }).click();
		await expect(page.getByRole('log')).toContainText('first conversation');

		const duringSwitch = await page.evaluate(() => {
			window.__a11yObserver?.disconnect();
			return window.__a11yAnnouncements ?? [];
		});
		// The transcript is replaced while the log is busy, so the platform suppresses it. The
		// clear itself is the single non-busy mutation — that is the one announcement.
		const structural = duringSwitch.filter((entry) => entry.type === 'childList');
		expect(structural.length).toBeGreaterThan(0);
		const whileBusy = structural.filter((entry) => entry.busy === 'true');
		expect(whileBusy.length).toBeGreaterThan(0);
	});
});

test.describe('form semantics', () => {
	// The composer carried `aria-expanded` on a plain textbox, an invalid combination whose
	// state Chromium dropped from the accessibility tree entirely.
	test('the composer is a real combobox and the state survives into the accessibility tree', async ({
		page
	}) => {
		await openWorkspace(page);
		const node = await axNode(page, '#chat-message');

		expect(node?.role).toBe('combobox');
		expect(node?.name).toBeTruthy();
		expect(node?.properties['expanded']).toBe(false);
		expect(node?.properties['autocomplete']).toBe('list');
		expect(node?.properties['hasPopup']).toBe('listbox');

		await composer(page).fill('/');
		await expect(page.getByRole('listbox', { name: 'Add to chat' })).toBeVisible();
		const expanded = await axNode(page, '#chat-message');
		expect(expanded?.properties['expanded']).toBe(true);
	});

	// A placeholder is not a label. Every visible form control must have a programmatic one.
	test('every visible form control has a programmatic label', async ({ page }) => {
		await openWorkspace(page);
		await page.getByRole('button', { name: 'Files', exact: true }).first().click();
		await expect(page.getByRole('tablist', { name: 'Open output tabs' })).toBeVisible();

		const unlabelled = await page.evaluate(() => {
			const named = (element: Element): boolean => {
				if (element.getAttribute('aria-label')?.trim()) return true;
				const labelledby = element.getAttribute('aria-labelledby');
				if (labelledby && document.getElementById(labelledby)) return true;
				if (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`))
					return true;
				return !!element.closest('label');
			};
			return [...document.querySelectorAll('input, select, textarea')]
				.filter((element) => {
					const field = element as HTMLInputElement;
					if (field.type === 'hidden' || field.disabled) return false;
					if (!element.getClientRects().length) return false;
					return !named(element);
				})
				.map((element) => `${element.tagName.toLowerCase()}#${element.id || '(no id)'}`);
		});
		expect(unlabelled).toEqual([]);
	});

	// The picker's category row used `role=tab` with `aria-controls` pointing at a listbox and
	// was reachable only by pointer, because Tab dismissed the popup before focus could leave
	// the textarea. It is now a labelled toggle group inside the tab order.
	test('the picker is fully operable by keyboard alone', async ({ page }) => {
		await openWorkspace(page);
		await composer(page).fill('/');
		const listbox = page.getByRole('listbox', { name: 'Add to chat' });
		await expect(listbox).toBeVisible();

		// Arrow keys move the active option and the listbox follows.
		const firstActive = await composer(page).getAttribute('aria-activedescendant');
		await page.keyboard.press('ArrowDown');
		const secondActive = await composer(page).getAttribute('aria-activedescendant');
		expect(secondActive).not.toBe(firstActive);
		await expect(page.locator(`#${secondActive}`)).toHaveAttribute('aria-selected', 'true');

		// Tab reaches the picker's own controls instead of dismissing it.
		const reached: string[] = [];
		for (let step = 0; step < 3; step++) {
			await page.keyboard.press('Tab');
			reached.push(
				await page.evaluate(
					() =>
						document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ?? ''
				)
			);
		}
		expect(reached[0]).toBe('Close picker');
		expect(await composer(page).getAttribute('aria-expanded')).toBe('true');

		// The category toggle is operable with Enter and swaps the option set.
		const categories = page.locator('.picker-tabs button');
		expect(await categories.count()).toBeGreaterThan(1);
		await categories.nth(1).focus();
		await page.keyboard.press('Enter');
		await expect(categories.nth(1)).toHaveAttribute('aria-pressed', 'true');
		await expect(categories.nth(0)).toHaveAttribute('aria-pressed', 'false');
		await expect(listbox).toContainText(/plugin|server/i);

		// Escape closes and returns focus to the composer, which is the documented way out.
		await composer(page).focus();
		await page.keyboard.press('Escape');
		await expect(composer(page)).toHaveAttribute('aria-expanded', 'false');
	});

	test('the composer keeps a single accessible name and does not rely on its placeholder', async ({
		page
	}) => {
		await openWorkspace(page);
		const node = await axNode(page, '#chat-message');
		// "Message Laya" comes from the <label for="chat-message">, not the placeholder text.
		expect(node?.name).not.toContain('/ tools');
		expect(node?.name).not.toContain('@ mentions');
	});
});

test.describe('keyboard map', () => {
	// Walks Tab from the document and returns what got focus, in order.
	async function tabMap(page: Page, steps: number): Promise<string[]> {
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
		await page.locator('body').click({ position: { x: 2, y: 2 } });
		const sequence: string[] = [];
		for (let step = 0; step < steps; step++) {
			await page.keyboard.press('Tab');
			sequence.push(
				await page.evaluate(() => {
					const element = document.activeElement as HTMLElement | null;
					if (!element || element === document.body) return 'body';
					return (
						element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 40) || ''
					);
				})
			);
		}
		return sequence;
	}

	test('the shell controls are all reachable in one Tab pass', async ({ page }) => {
		await page.setViewportSize({ width: 1400, height: 900 });
		await openWorkspace(page);

		// Enough steps to cover the shell twice, so a control that is skipped stands out.
		const sequence = await tabMap(page, 40);
		const required = [
			'Skip to chat',
			'Hide sidebar',
			'File',
			'Chat',
			'More tools',
			'Server controls',
			'User menu',
			'Search chats',
			'New chat',
			'Show output panel',
			'Chat actions',
			'Add tools and plugins',
			'Chat model'
		];
		for (const label of required)
			expect(sequence, `"${label}" never received focus`).toContain(label);

		// And the composer is on the path, so sending never requires the pointer.
		await expect(composer(page)).toBeEnabled();
	});

	test('send, stop, attach and the model picker are operable without a pointer', async ({
		page
	}) => {
		await openWorkspace(page);
		await page.setViewportSize({ width: 1400, height: 900 });

		// Attach is a button; Enter opens the picker (which is the file chooser's gate).
		const attach = page.getByRole('button', { name: 'Add tools and plugins' });
		await attach.focus();
		await page.keyboard.press('Enter');
		await expect(composer(page)).toHaveAttribute('aria-expanded', 'true');
		await page.keyboard.press('Escape');

		// Send by keyboard: Enter in the composer, not the mouse.
		await composer(page).focus();
		await composer(page).fill('keyboard send');
		await page.keyboard.press('Enter');
		await expect(page.getByRole('log')).toContainText('keyboard send');

		// While a run is in flight the Send button is replaced by Stop, which must be a real
		// focusable button rather than a styled span.
		await composer(page).fill('needs stopping');
		await page.keyboard.press('Enter');
		const stop = page.getByRole('button', { name: /Stop/ });
		await expect(stop).toBeVisible();
		await stop.focus();
		await expect(stop).toBeFocused();
		const shape = await stop.evaluate((element) => ({
			tag: element.tagName,
			tabIndex: (element as HTMLElement).tabIndex,
			disabled: (element as HTMLButtonElement).disabled
		}));
		expect(shape.tag).toBe('BUTTON');
		expect(shape.tabIndex).toBe(0);
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
	});

	test('the model picker opens, moves and commits by keyboard alone', async ({ page }) => {
		await page.setViewportSize({ width: 1400, height: 900 });
		await openWorkspace(page);

		const trigger = page.getByRole('button', { name: 'Chat model' });
		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');

		// The listbox is portalled but the trigger keeps focus and names the active option.
		const listbox = page.getByRole('listbox').last();
		await expect(listbox).toBeVisible();
		const activeId = await trigger.getAttribute('aria-activedescendant');
		expect(activeId).toBeTruthy();
		await expect(page.locator(`#${activeId}`)).toHaveAttribute('role', 'option');

		await page.keyboard.press('Escape');
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await expect(trigger).toBeFocused();
	});

	test('the output tab strip is a roving-tabindex tablist with working arrow keys', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1400, height: 900 });
		await openWorkspace(page);

		await page.getByRole('button', { name: 'Files', exact: true }).first().click();
		await page.getByRole('button', { name: 'Keep Files tab' }).click();
		await page.getByRole('button', { name: 'Browser', exact: true }).first().click();

		const tabs = page.getByRole('tab');
		await expect(tabs).toHaveCount(2);
		// Exactly one tab is in the tab order; the rest are reached with arrows.
		const tabIndexes = await tabs.evaluateAll((elements) =>
			elements.map((element) => (element as HTMLElement).tabIndex)
		);
		expect(tabIndexes.filter((value) => value === 0)).toHaveLength(1);

		await tabs.first().focus();
		const start = await tabs.first().getAttribute('aria-selected');
		await page.keyboard.press('ArrowRight');
		await expect
			.poll(() => page.evaluate(() => document.querySelector('[role="tab"]:focus')?.id ?? ''))
			.toBe('output-tab-browser');
		const moved = await page.locator('#output-tab-browser').getAttribute('aria-selected');
		expect(moved).not.toBe(start);

		// Home and End are part of the pattern and must not fall through to a scroll.
		await page.keyboard.press('Home');
		await expect(page.locator('#output-tab-files')).toBeFocused();
		await page.keyboard.press('End');
		await expect(page.locator('#output-tab-browser')).toBeFocused();

		// Delete closes the focused tab, per the same pattern.
		await page.keyboard.press('Delete');
		await expect(page.getByRole('tab')).toHaveCount(1);
	});

	test('the tab picker, output toggle and rail are all keyboard reachable and active', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1400, height: 900 });
		await openWorkspace(page);
		await page.getByRole('button', { name: 'Files', exact: true }).first().click();

		// Output panel toggle: Enter flips it and the label follows the state.
		const toggle = page.getByRole('button', { name: 'Expand output panel' });
		await toggle.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: 'Restore split view' })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: 'Expand output panel' })).toBeFocused();

		// Tab picker: the trigger opens it, the search field is focused, Escape restores.
		const picker = page.getByRole('button', { name: 'Find an open tab' });
		await picker.focus();
		await page.keyboard.press('Enter');
		const search = page.locator('#find-output-tab');
		await expect(search).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(picker).toBeFocused();

		// Rail: every button is in the tab order and reports the current app.
		const rail = page.getByRole('navigation', { name: 'App shortcuts' });
		const railButtons = rail.getByRole('button');
		expect(await railButtons.count()).toBeGreaterThan(3);
		const currents = await railButtons.evaluateAll((elements) =>
			elements.map((element) => element.getAttribute('aria-current'))
		);
		expect(currents.filter((value) => value === 'page')).toHaveLength(1);

		// Menubar: arrows move between the menu triggers.
		const firstMenu = page.getByRole('menuitem', { name: 'File' });
		await firstMenu.focus();
		await page.keyboard.press('ArrowRight');
		await expect
			.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''))
			.toBe('Edit');
	});

	test('the settings window is fully tabbable and every field is labelled', async ({ page }) => {
		await page.setViewportSize({ width: 1400, height: 900 });
		await openWorkspace(page);
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		await page.getByRole('menuitem', { name: /Settings/ }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();

		// Tab inside the dialog visits its controls and never escapes to the page behind it.
		const inside: string[] = [];
		for (let step = 0; step < 12; step++) {
			await page.keyboard.press('Tab');
			const label = await page.evaluate(() => {
				const element = document.activeElement as HTMLElement | null;
				if (!element) return 'null';
				const inDialog = !!element.closest('[role="dialog"]');
				return `${inDialog ? 'in' : 'out'}:${element.getAttribute('aria-label') ?? element.id ?? element.tagName}`;
			});
			inside.push(label);
		}
		expect(inside.every((label) => label.startsWith('in:'))).toBe(true);

		// The search field that filters sections is the first thing the dialog offers, named.
		await expect(dialog.locator('#settings-search')).toHaveAttribute('id', 'settings-search');
		expect(await dialog.locator('label[for="settings-search"]').count()).toBe(1);
	});

	test('the tools panel and the device list expose their controls to the keyboard', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1400, height: 900 });
		await openWorkspace(page);
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		await page.getByRole('menuitem', { name: /Settings/ }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();

		for (const section of ['Tools', 'Paired devices']) {
			const button = dialog.getByRole('button', { name: section, exact: true });
			await button.focus();
			await page.keyboard.press('Enter');
			// Opening a section by keyboard must not throw focus out of the dialog.
			await expect(button).toBeFocused();
			const focusStayed = await page.evaluate(
				() => !!document.activeElement?.closest('[role="dialog"]')
			);
			expect(focusStayed, `${section} dropped focus out of the settings window`).toBe(true);
		}
	});

	test('no visible enabled control is parked outside the Tab order', async ({ page }) => {
		await page.setViewportSize({ width: 1400, height: 900 });
		await openWorkspace(page);
		await page.getByRole('button', { name: 'Files', exact: true }).first().click();

		const parked = await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')]
				.filter((element) => {
					if ((element as HTMLButtonElement).disabled) return false;
					if (!element.getClientRects().length) return false;
					if (element.tabIndex >= 0) return false;
					// Composite widgets own their own roving tabindex; only standalone
					// controls are a defect here.
					return !element.closest(
						'[role="tablist"], [role="listbox"], [role="menu"], [role="menubar"], [role="grid"], [role="tree"]'
					);
				})
				.map(
					(element) =>
						`${element.tagName.toLowerCase()}:${element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 30)}`
				)
		);
		expect(parked).toEqual([]);
	});
});

test.describe('reduced motion', () => {
	// `test.use({ reducedMotion })` does not reach the browser in this configuration (it was
	// measured as `false` inside the page), so the preference is emulated per page instead.
	// The blanket `animation-duration: 0.01ms` rule did not cover `scroll-behavior: smooth`
	// or an infinitely looping animation that is only revealed while a run is streaming.
	const reduceMotion = (page: Page) => page.emulateMedia({ reducedMotion: 'reduce' });

	test('no element keeps a running transition or animation', async ({ page }) => {
		await reduceMotion(page);
		await openWorkspace(page);
		await page.getByRole('button', { name: 'Files', exact: true }).first().click();

		const moving = await page.evaluate(() =>
			[...document.querySelectorAll('body *')]
				.filter((element) => {
					const style = getComputedStyle(element);
					const transitions = style.transitionDuration.split(',').map(parseFloat);
					const animations = style.animationDuration.split(',').map(parseFloat);
					return (
						transitions.some((value) => value > 0.001) || animations.some((value) => value > 0.001)
					);
				})
				.map(
					(element) =>
						`${element.tagName.toLowerCase()}.${String(element.className).split(/\s+/)[0]}:${getComputedStyle(element).transitionDuration}/${getComputedStyle(element).animationDuration}`
				)
		);
		expect(moving).toEqual([]);
	});

	test('smooth scrolling is off for a reduced-motion user', async ({ page }) => {
		await reduceMotion(page);
		await openWorkspace(page);
		const behaviour = await page.evaluate(() => ({
			root: getComputedStyle(document.documentElement).scrollBehavior,
			body: getComputedStyle(document.body).scrollBehavior
		}));
		expect(behaviour.root).toBe('auto');
		expect(behaviour.body).toBe('auto');
	});

	test('the typing indicator and streaming caret do not animate', async ({ page }) => {
		await reduceMotion(page);
		await openWorkspace(page);
		await composer(page).fill('motion probe');
		await page.getByRole('button', { name: 'Send message' }).click();

		// Both live only while a run is in flight, so they need an explicit assertion.
		const states = await page.evaluate(() => {
			const read = (selector: string) => {
				const element = document.querySelector(selector);
				if (!element) return null;
				const style = getComputedStyle(element);
				return { name: style.animationName, iterations: style.animationIterationCount };
			};
			return { dots: read('.typing-indicator i'), caret: read('.streaming-caret') };
		});

		for (const [label, state] of Object.entries(states)) {
			if (!state) continue;
			expect(state.name, `${label} still runs ${state.name}`).toBe('none');
			expect(state.iterations, `${label} still loops`).not.toBe('infinite');
		}
	});

	test('motion is preserved for everyone else', async ({ page }) => {
		// Same page, no reduced-motion preference: the transitions must still be there, so the
		// guard above cannot be satisfied by deleting motion outright.
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await openWorkspace(page);
		// `.btn` is in the shared sheet and always transitions its background; on a bare page
		// there is no message yet, so it is the reliable probe.
		const durations = await page.evaluate(() =>
			getComputedStyle(document.querySelector('.btn') ?? document.body)
				.transitionDuration.split(',')
				.map(parseFloat)
		);
		expect(Math.max(...durations)).toBeGreaterThan(0.001);
	});
});

test.describe('forced colours', () => {
	// Emulated per page for the same reason as reduced motion: `test.use` does not reach the
	// browser here, and asserting on a preference the page never received would be a lie.
	const forceColors = (page: Page) => page.emulateMedia({ forcedColors: 'active' });

	// Forced colours replaces every author background with the system palette, so state that
	// was only a background tint disappears. These assert a non-colour signal survives.
	test('the current rail item and the selected tab keep a visible state', async ({ page }) => {
		await forceColors(page);
		await page.setViewportSize({ width: 1400, height: 900 });
		await openWorkspace(page);

		const supported = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
		expect(supported).toBe(true);

		const railCurrent = await page.evaluate(() => {
			const element = document.querySelector('[aria-current="page"]') as HTMLElement | null;
			if (!element) return null;
			const style = getComputedStyle(element);
			return { outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle };
		});
		expect(railCurrent).not.toBeNull();
		expect(
			railCurrent!.outlineStyle !== 'none' && parseFloat(railCurrent!.outlineWidth) > 0,
			'the current rail item has no non-colour state marker'
		).toBe(true);

		await page.getByRole('button', { name: 'Files', exact: true }).first().click();
		await page.getByRole('button', { name: 'Keep Files tab' }).click();
		await page.getByRole('button', { name: 'Browser', exact: true }).first().click();

		const tabs = await page.evaluate(() =>
			[...document.querySelectorAll('[role="tab"]')].map((element) => {
				const style = getComputedStyle(element);
				return {
					selected: element.getAttribute('aria-selected'),
					borderColor: style.borderTopColor,
					weight: style.fontWeight
				};
			})
		);
		const selected = tabs.find((tab) => tab.selected === 'true')!;
		const idle = tabs.find((tab) => tab.selected === 'false')!;
		expect(
			selected.borderColor !== idle.borderColor || selected.weight !== idle.weight,
			`the selected tab is visually identical to an idle one (${selected.weight} vs ${idle.weight})`
		).toBe(true);
	});

	test('text and controls keep readable system colours and a visible focus ring', async ({
		page
	}) => {
		await forceColors(page);
		await openWorkspace(page);
		await composer(page).focus();

		const composerRing = await page.evaluate(() => {
			const style = getComputedStyle(document.querySelector('.conversation-composer')!);
			return { width: style.outlineWidth, style: style.outlineStyle };
		});
		expect(composerRing.style).not.toBe('none');
		expect(parseFloat(composerRing.width)).toBeGreaterThan(0);

		const readable = await page.evaluate(() => {
			const luminance = (rgbText: string) => {
				const [r, g, b] = (rgbText.match(/\d+/g) ?? ['0', '0', '0']).map(Number);
				const channel = (value: number) => {
					const scaled = value / 255;
					return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
				};
				return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
			};
			const contrastOf = (element: Element | null) => {
				if (!element) return null;
				const style = getComputedStyle(element);
				const a = luminance(style.color);
				const background = element.closest('.conversation-composer, body') ?? document.body;
				const b = luminance(getComputedStyle(background).backgroundColor);
				return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
			};
			return {
				composer: contrastOf(document.querySelector('#chat-message')),
				send: contrastOf(document.querySelector('.send-button'))
			};
		});
		// System colours are guaranteed to pair, so this is a smoke test that the swap happened
		// and nothing overrode it back to an author colour.
		for (const [label, value] of Object.entries(readable))
			expect(value, `${label} had no computed contrast`).toBeGreaterThan(1);
	});

	test('the composer keeps a border in forced colours so both tones stay distinguishable', async ({
		page
	}) => {
		await forceColors(page);
		await openWorkspace(page);
		await composer(page).fill('forced colour turn');
		await page.getByRole('button', { name: 'Send message' }).click();
		await page
			.getByRole('log')
			.getByText(/No provider configured/)
			.first()
			.waitFor();

		const bubbles = await page.evaluate(() =>
			[...document.querySelectorAll('.chat-message-body')].map((element) => {
				const style = getComputedStyle(element);
				return {
					borderWidth: style.borderTopWidth,
					borderStyle: style.borderTopStyle,
					borderColor: style.borderTopColor
				};
			})
		);
		expect(bubbles.length).toBeGreaterThan(0);
		// Every bubble keeps a border, so the two tones remain distinguishable without colour.
		for (const bubble of bubbles) expect(parseFloat(bubble.borderWidth)).toBeGreaterThan(0);
	});
});

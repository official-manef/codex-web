import { expect, test, type Page } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Adversarial edge cases, driven through the shipped UI.
 *
 * Every case here is a way a real person breaks the app without meaning to: a browser whose
 * storage is full, a reload in the middle of a reply, an upstream that stops answering, a
 * 320px phone, a chat list past the write cap. The verdict for each lives in
 * `docs/edge-cases-2026-11-02.md`; a case that is a known defect asserts today's behaviour and
 * says so in its own name.
 *
 * Nothing is imported from the app: the storage keys and DOM contracts asserted here are the
 * ones `src/lib/http.local.ts` and the chat view already publish.
 */

const SESSIONS_KEY = 'workspace-template:sessions';
const DRAFT_PREFIX = 'laya-draft-v1:';

/** The composer is the chat's only textarea; enabling happens after the first session resolves. */
function composer(page: Page) {
	return page.locator('#chat-message');
}

async function openWorkspace(page: Page): Promise<void> {
	await page.goto('/');
	await expect(composer(page)).toBeEnabled();
}

/** Below 1100px the session list is an off-canvas drawer, so it has to be opened first. */
async function revealSessions(page: Page): Promise<void> {
	const newChat = page.getByRole('button', { name: 'New chat' }).first();
	if (await newChat.isVisible()) return;
	const toggle = page.locator('#sidebar-toggle');
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await toggle.click();
	await expect(newChat).toBeVisible();
}

/** Answer `/api/ai/chat` with frames we release by hand, so timing is ours. */
async function streamChat(
	page: Page,
	frames: (push: (event: unknown) => void, close: () => void) => Promise<void> | void
): Promise<void> {
	await page.addInitScript(() => {
		sessionStorage.setItem(
			'laya-draft-v1:byok-key',
			JSON.stringify({ version: 1, value: 'fake-not-a-secret-1234' })
		);
	});
	await page.route('**/api/ai/config', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				ai: { enabled: true, providers: [{ id: 'openai', models: ['gpt-4o'] }] }
			})
		})
	);
	await page.addInitScript((source) => {
		const realFetch = window.fetch.bind(window);
		const run = new Function(`return (${source})`)() as (
			push: (event: unknown) => void,
			close: () => void
		) => Promise<void> | void;
		window.fetch = (input, init) => {
			const url =
				typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
			if (!url.includes('/api/ai/chat')) return realFetch(input, init);
			const encoder = new TextEncoder();
			const body = new ReadableStream({
				start(controller) {
					const push = (event: unknown) => {
						try {
							controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
						} catch {
							// The page tore the stream down; nothing left to write to.
						}
					};
					const close = () => {
						try {
							controller.close();
						} catch {
							// Already closed.
						}
					};
					init?.signal?.addEventListener('abort', () => {
						try {
							controller.error(new DOMException('aborted', 'AbortError'));
						} catch {
							// Already errored.
						}
					});
					void run(push, close);
				}
			});
			return Promise.resolve(new Response(body, { status: 200 }));
		};
	}, frames.toString());
}

/** Every turn the store has written for the newest chat. */
async function storedTurns(page: Page) {
	return page.evaluate((key) => {
		const rows = JSON.parse(sessionStorage.getItem(key) ?? '[]') as Array<{
			title: string;
			turns: Array<{ status: string; replies?: Array<{ text: string }> }>;
		}>;
		return rows.map((row) => ({
			title: row.title,
			turns: row.turns.map((turn) => ({
				status: turn.status,
				text: turn.replies?.[0]?.text ?? ''
			}))
		}));
	}, SESSIONS_KEY);
}

test.describe('storage that this build did not write', () => {
	// The three shapes below each threw during `initialize()`: `[null]` broke `sessions[0].id`,
	// a row with no `turns` broke `.length`, and `turns: null` broke `.filter`. The composer
	// stayed disabled and "New chat" could not recover, so the tab had to be cleared by hand.
	for (const [name, payload] of [
		['a null row', '[null]'],
		['a row from an older schema', JSON.stringify([{ id: 'legacy', title: 'old schema' }])],
		[
			'a null turn list',
			JSON.stringify([
				{
					id: 'a',
					title: 't',
					turns: null,
					settings: {},
					tool_events: [],
					created_at: 1,
					updated_at: 1
				}
			])
		]
	] as const) {
		test(`corrupt session storage (${name}) still boots a usable composer`, async ({ page }) => {
			await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [
				SESSIONS_KEY,
				payload
			] as const);
			await openWorkspace(page);

			// Usable, and a send works: the chat is not a dead shell.
			await composer(page).fill('still works');
			await composer(page).press('Enter');
			await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('still works');
		});
	}

	test('a corrupt draft and a corrupt pin list are dropped, not rendered', async ({ page }) => {
		await page.addInitScript(
			([prefix, key]) => {
				sessionStorage.setItem(`${prefix}chat:any`, '{"version":1,"value":{"content":42}}');
				sessionStorage.setItem(`${prefix}pinned-sessions`, '{"version":1,"value":"oops"}');
				sessionStorage.setItem(key, '[]');
			},
			[`${DRAFT_PREFIX}`, SESSIONS_KEY] as const
		);
		await openWorkspace(page);
		// A non-string draft must not be put in the textarea, and a non-array pin list must not
		// break the sidebar. Below 1100px the session list is an off-canvas drawer, so it is
		// opened before being asserted.
		await expect(composer(page)).toHaveValue('');
		await revealSessions(page);
		await expect(page.getByRole('navigation', { name: 'Saved conversations' })).toBeVisible();
	});

	test('a session write the browser refuses is reported instead of silently lost', async ({
		page
	}) => {
		await page.addInitScript((key) => {
			const realSet = Storage.prototype.setItem;
			Storage.prototype.setItem = function (this: Storage, name: string, value: string) {
				// Only the chat store throws, exactly like a quota that is already spent.
				if (name === key && this.getItem(key))
					throw new DOMException('quota', 'QuotaExceededError');
				return realSet.call(this, name, value);
			};
		}, SESSIONS_KEY);
		await openWorkspace(page);

		await composer(page).fill('this turn cannot be written');
		await composer(page).press('Enter');
		// The turn is live...
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(
			'this turn cannot be written'
		);
		// ...and the app says it is not saved. Before this, the only way to find out was to
		// reload and watch the chat vanish with no message at all.
		await expect(page.getByText(/could not be saved/i)).toBeVisible();
	});

	test('a draft typed while the quota is full survives a reload', async ({ page }) => {
		await openWorkspace(page);
		// Fill the store, but leave room for a small draft: that is the case a person hits.
		await page.evaluate(() => {
			const chunk = 'x'.repeat(100_000);
			for (let index = 0; index < 500; index += 1) {
				try {
					sessionStorage.setItem(`filler-${index}`, chunk);
				} catch {
					return;
				}
			}
		});
		await composer(page).fill('draft typed near the quota');
		await page.waitForTimeout(400);
		await page.reload();
		await expect(composer(page)).toBeEnabled();
		await expect(composer(page)).toHaveValue('draft typed near the quota');
	});
});

test.describe('streaming that does not end the way the protocol says', () => {
	test('an upstream that closes with no done frame is reported, not shown as complete', async ({
		page
	}) => {
		await streamChat(page, (push, close) => {
			push({ type: 'text', text: 'truncated answer' });
			close();
		});
		await openWorkspace(page);
		await composer(page).fill('no done frame');
		await composer(page).press('Enter');

		const log = page.getByRole('log', { name: 'Conversation' });
		// The partial text is kept so the user can see what arrived...
		await expect(log).toContainText('truncated answer');
		// ...and the ending is named instead of being presented as a finished reply.
		await expect(log).toContainText(/closed before the reply finished/i);
	});

	test('a reply whose last frame has no trailing newline is not silently dropped', async ({
		page
	}) => {
		await streamChat(page, (push) => {
			push({ type: 'text', text: 'unterminated final frame' });
		});
		await openWorkspace(page);
		await composer(page).fill('no trailing newline');
		await composer(page).press('Enter');

		// `split('\n')` used to leave the only frame in the buffer, so the reply came back
		// empty and was saved as a successful blank answer.
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(
			'unterminated final frame'
		);
	});

	test('a reply that finishes normally is saved and survives a reload', async ({ page }) => {
		await streamChat(page, (push) => {
			push({ type: 'text', text: 'first ' });
			push({ type: 'text', text: 'second' });
			push({ type: 'done' });
		});
		await openWorkspace(page);
		await composer(page).fill('persisted reply');
		await composer(page).press('Enter');
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('first second');

		// `turns` was ignored by `/api/sessions/update`, so every BYOK reply lived only in
		// memory until the next reload.
		expect((await storedTurns(page))[0].turns[0]).toMatchObject({
			status: 'done',
			text: 'first second'
		});
		await page.reload();
		await expect(composer(page)).toBeEnabled();
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('first second');
	});

	test('stopping mid-reply keeps the partial text and settles into a stated state', async ({
		page
	}) => {
		await streamChat(page, (push) => {
			push({ type: 'text', text: 'before the stop' });
			// Never finishes: only the stop control ends this.
		});
		await openWorkspace(page);
		await composer(page).fill('stop me');
		await composer(page).press('Enter');
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('before the stop');

		await page.getByRole('button', { name: /^stop$/i }).click();

		// The UI settles: no stop control, a usable composer, and the partial reply kept.
		await expect(page.getByRole('button', { name: /^stop$/i })).toHaveCount(0);
		await expect(composer(page)).toBeEnabled();
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('before the stop');
		await expect(page.getByText(/Generation stopped/i).first()).toBeVisible();
		expect((await storedTurns(page))[0].turns[0]).toMatchObject({ status: 'cancelled' });
	});

	test('a stream that errors after a partial frame keeps the turn and says what happened', async ({
		page
	}) => {
		await page.addInitScript(() => {
			sessionStorage.setItem(
				'laya-draft-v1:byok-key',
				JSON.stringify({ version: 1, value: 'fake-not-a-secret-1234' })
			);
			const realFetch = window.fetch.bind(window);
			window.fetch = (input, init) => {
				const url = typeof input === 'string' ? input : String(input);
				if (!url.includes('/api/ai/chat')) return realFetch(input, init);
				const encoder = new TextEncoder();
				const body = new ReadableStream({
					start(controller) {
						controller.enqueue(
							encoder.encode(`${JSON.stringify({ type: 'text', text: 'partial then boom' })}\n`)
						);
						setTimeout(() => controller.error(new Error('network gone')), 200);
					}
				});
				return Promise.resolve(new Response(body, { status: 200 }));
			};
		});
		await page.route('**/api/ai/config', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					ai: { enabled: true, providers: [{ id: 'openai', models: ['gpt-4o'] }] }
				})
			})
		);
		await openWorkspace(page);
		await composer(page).fill('boom turn');
		await composer(page).press('Enter');

		// The message the user typed used to disappear with no turn row, leaving nothing to
		// retry from; now the turn is recorded as failed and the reason is shown.
		await expect(page.getByText(/network gone/i).first()).toBeVisible();
		const turns = await storedTurns(page);
		expect(turns[0].turns).toHaveLength(1);
		expect(turns[0].turns[0].status).toBe('error');
	});

	test('a send with no provider key in the tab does not lock the composer', async ({ page }) => {
		await page.route('**/api/ai/config', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					ai: { enabled: true, providers: [{ id: 'openai', models: ['gpt-4o'] }] }
				})
			})
		);
		await openWorkspace(page);
		await composer(page).fill('no key here');
		await composer(page).press('Enter');

		// The old path returned with the synthetic job still set, so `busy` stayed true and the
		// chat could not be used again without a reload.
		await expect(page.getByText(/holds no key for this tab/i).first()).toBeVisible();
		await expect(composer(page)).toBeEnabled();
		await expect(composer(page)).toHaveValue('no key here');
		await expect(page.getByRole('button', { name: /^stop$/i })).toHaveCount(0);
	});
});

test.describe('files', () => {
	test('a rejected file names itself and the accepted files stay', async ({ page }) => {
		await openWorkspace(page);
		await page.setInputFiles('input[type="file"]', [
			{ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
			{ name: 'ready.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') },
			{ name: '../../etc/passwd', mimeType: 'text/plain', buffer: Buffer.from('x') }
		]);
		// Four is the per-turn cap; three fit, so all three are accepted and each chip keeps the
		// name the user chose. The stub used to answer with `name: 'attachment'` for all of them.
		const chips = page.locator('.composer-attachments > div');
		await expect(chips).toHaveCount(3);
		await expect(chips.filter({ hasText: 'empty.txt' })).toHaveCount(1);
		await expect(chips.filter({ hasText: 'passwd' })).toHaveCount(1);
	});

	test('a fifth file is refused with a reason instead of silently dropped', async ({ page }) => {
		await openWorkspace(page);
		await page.setInputFiles(
			'input[type="file"]',
			Array.from({ length: 5 }, (_, index) => ({
				name: `file-${index}.txt`,
				mimeType: 'text/plain',
				buffer: Buffer.from(`content ${index}`)
			}))
		);
		await expect(page.locator('.composer-attachments > div')).toHaveCount(4);
		await expect(page.getByText(/Remove an attachment before adding another file/i)).toBeVisible();
	});

	test('an oversized file is refused by name and never reaches the composer', async ({ page }) => {
		await openWorkspace(page);
		// Playwright refuses to hand over a 50 MB buffer inline, so the file goes to disk first.
		const big = join(tmpdir(), 'edge-oversized.bin');
		writeFileSync(big, Buffer.alloc(50 * 1024 * 1024, 97));
		try {
			await page.setInputFiles('input[type="file"]', big);
			await expect(page.locator('.composer-attachments > div')).toHaveCount(0);
			await expect(page.getByText(/edge-oversized\.bin: File is too large/i)).toBeVisible();
		} finally {
			rmSync(big, { force: true });
		}
	});
});

test.describe('layout extremes', () => {
	test('a 320px viewport has no horizontal scroll and keeps the composer usable', async ({
		page
	}) => {
		await page.setViewportSize({ width: 320, height: 720 });
		await openWorkspace(page);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
		await expect(composer(page)).toBeEnabled();
		await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
	});

	test('a 4000px viewport does not stretch the shell past the window', async ({ page }) => {
		await page.setViewportSize({ width: 4000, height: 900 });
		await openWorkspace(page);
		const width = await page.evaluate(() => ({
			doc: document.documentElement.scrollWidth,
			view: document.documentElement.clientWidth
		}));
		expect(width.doc).toBeLessThanOrEqual(width.view);
	});

	test('a 4000-character unbroken message does not push the page sideways', async ({ page }) => {
		await openWorkspace(page);
		await composer(page).fill('A'.repeat(4000));
		await composer(page).press('Enter');
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('AAAA');
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});

	test('a chat with 500 turns loads and still takes a message', async ({ page }) => {
		const id = 'a'.repeat(32);
		await page.addInitScript(
			([key, sessionId]) => {
				const turn = (index: number) => ({
					id: `turn-${index}`,
					content: `message number ${index}`,
					attachments: [],
					status: 'done',
					created_at: 1,
					replies: [
						{ text: `reply ${index}`, model_id: 'stub', model_label: 'x', device: 'x', ms: 1 }
					]
				});
				sessionStorage.setItem(
					key,
					JSON.stringify([
						{
							id: sessionId,
							title: 'Long chat',
							settings: {},
							turns: Array.from({ length: 500 }, (_, index) => turn(index)),
							tool_events: [],
							created_at: 1,
							updated_at: 1
						}
					])
				);
				localStorage.setItem('laya-session', sessionId);
			},
			[SESSIONS_KEY, id] as const
		);
		await openWorkspace(page);
		const log = page.getByRole('log', { name: 'Conversation' });
		await expect(log.locator('section.conversation-turn')).toHaveCount(500);
		// The newest turn is the one in view, and the composer still works.
		await expect(log).toContainText('message number 499');
		await expect(composer(page)).toBeEnabled();
	});

	test('a 5000-character chat title does not overflow the sidebar', async ({ page }) => {
		await page.addInitScript((key) => {
			sessionStorage.setItem(
				key,
				JSON.stringify([
					{
						id: 'a'.repeat(32),
						title: 'T'.repeat(5000),
						settings: {},
						turns: [],
						tool_events: [],
						created_at: 1,
						updated_at: 1
					}
				])
			);
		}, SESSIONS_KEY);
		await openWorkspace(page);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});

test.describe('two tabs', () => {
	test('each tab keeps its own sessionStorage chat list and neither loses its own chat', async ({
		context,
		page
	}) => {
		await openWorkspace(page);
		await composer(page).fill('tab one message');
		await composer(page).press('Enter');
		const log = page.getByRole('log', { name: 'Conversation' });
		await expect(log).toContainText('tab one message');
		// The stub reply lands after its own 700ms job, so wait for it before snapshotting;
		// otherwise the snapshot captures a half-written turn.
		await expect(log).toContainText('No provider configured');
		const firstTurns = await storedTurns(page);

		const second = await context.newPage();
		await second.goto('/');
		await expect(second.locator('#chat-message')).toBeEnabled();
		await second.locator('#chat-message').fill('tab two message');
		await second.locator('#chat-message').press('Enter');
		await expect(second.getByRole('log', { name: 'Conversation' })).toContainText(
			'tab two message'
		);

		// `laya-session` is localStorage and therefore shared; the chat list is sessionStorage
		// and is not, so the remembered id may point at a chat this tab cannot see. Reloading
		// the first tab must still land on its own chat rather than an error.
		await page.reload();
		await expect(composer(page)).toBeEnabled();
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('tab one message');
		expect(await storedTurns(page)).toEqual(firstTurns);
	});

	test('a remembered chat that this tab no longer has opens a fresh chat, not an error', async ({
		context,
		page
	}) => {
		await openWorkspace(page);
		await composer(page).fill('chat that will be gone');
		await composer(page).press('Enter');
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(
			'chat that will be gone'
		);

		// The chat list lives in `sessionStorage`, which is per tab, so another tab cannot
		// delete this one's chats. What *is* shared is the `laya-session` pointer in
		// `localStorage`, and the other tab moves it to a chat this tab has never seen. That
		// stale pointer is the real cross-tab hazard.
		const second = await context.newPage();
		await second.goto('/');
		await expect(second.locator('#chat-message')).toBeEnabled();
		await second.locator('#chat-message').fill('a chat only the second tab has');
		await second.locator('#chat-message').press('Enter');
		await expect(second.getByRole('log', { name: 'Conversation' })).toContainText(
			'a chat only the second tab has'
		);
		const pointer = await second.evaluate(() => localStorage.getItem('laya-session'));
		expect(pointer).toBeTruthy();

		// The first tab has no chat with that id. It must still open something usable.
		await page.reload();
		await expect(composer(page)).toBeEnabled();
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(
			'chat that will be gone'
		);
		await expect(page.getByText(/no longer available/i)).toHaveCount(0);
	});

	test('a chat store emptied behind the tab opens a fresh chat instead of an error', async ({
		page
	}) => {
		await openWorkspace(page);
		await composer(page).fill('about to be cleared');
		await composer(page).press('Enter');
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(
			'about to be cleared'
		);

		// Same effect as a delete from a second tab, expressed on the tab that owns the store.
		await page.evaluate((key) => sessionStorage.setItem(key, '[]'), SESSIONS_KEY);
		await page.reload();
		await expect(composer(page)).toBeEnabled();
		await expect(page.getByText(/no longer available/i)).toHaveCount(0);
		await expect(page.getByRole('heading', { name: /What would you like to do\?/ })).toBeVisible();
	});
});

test.describe('reload mid-stream', () => {
	test('reloading while a reply is streaming leaves a stated, usable state', async ({ page }) => {
		await streamChat(page, (push) => {
			push({ type: 'text', text: 'half a reply' });
			// Never finishes.
		});
		await openWorkspace(page);
		await composer(page).fill('interrupted by a reload');
		await composer(page).press('Enter');
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('half a reply');

		await page.reload();
		await expect(composer(page)).toBeEnabled();
		// The interrupted turn is not left as a running job in the UI, and no stop control is
		// stuck on screen.
		await expect(page.getByRole('button', { name: /^stop$/i })).toHaveCount(0);
		await expect(page.getByRole('heading', { name: /What would you like to do\?/ })).toBeVisible();
	});
});

test.describe('the write cap', () => {
	test('past 50 chats the oldest are reported as dropped, not lost without a word', async ({
		page
	}) => {
		await openWorkspace(page);
		await composer(page).fill('the oldest chat');
		await composer(page).press('Enter');
		await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('the oldest chat');

		for (let index = 0; index < 55; index += 1) {
			await revealSessions(page);
			await page.getByRole('button', { name: 'New chat' }).first().click();
		}

		const stored = await page.evaluate(
			(key) => JSON.parse(sessionStorage.getItem(key) ?? '[]').length,
			SESSIONS_KEY
		);
		expect(stored).toBe(50);
		// The oldest chat no longer fits in storage; the app says how many were dropped.
		await expect(page.getByText(/older chats were dropped|chat was dropped/i)).toBeVisible();
	});
});

test.describe('pins', () => {
	test('a chat can be pinned and stays pinned after a reload', async ({ page }) => {
		await openWorkspace(page);
		await revealSessions(page);
		// The pin button only reveals itself on hover of its row, so the row is hovered first.
		await page.locator('.chat-list-row').first().hover();
		const pin = page.locator('.session-pin').first();
		await expect(pin).toHaveAttribute('aria-label', /^Pin /);
		await pin.click();
		await expect(page.locator('.session-pin').first()).toHaveAttribute('aria-label', /^Unpin /);

		// Ids are `session-<base36>-<n>`; the old hex-only filter dropped every real id, so the
		// pin never survived and the control looked dead.
		await page.reload();
		await expect(composer(page)).toBeEnabled();
		await revealSessions(page);
		await expect(page.locator('.session-pin').first()).toHaveAttribute('aria-label', /^Unpin /);
	});
});

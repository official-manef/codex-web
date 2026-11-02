/**
 * The terminal path, end to end, in a browser.
 *
 * `src/lib/runtime/terminal-bridge.spec.ts` proves the bridge speaks its own protocol. That is a
 * different claim from "a user can run a shell from this app": it never opens the panel, never
 * sends what the panel sends, and never reads what the panel paints. Both defects this file was
 * written to catch were invisible to that suite —
 *
 *   1. the panel reports its grid size on open. The bridge answered that with
 *      `child.kill('SIGWINCH')`, which sets `child.killed` permanently, so every keystroke was
 *      dropped while the socket still read `open`. A protocol test that ignores `resize` never
 *      sees it, and neither does any test that asserts on frames instead of on the panel.
 *   2. `/v1/health` sent no CORS headers, so `Devices`'s own "Test connection" reported
 *      `TypeError: Failed to fetch` for a bridge that answered `200` to curl.
 *
 * So every assertion here reads what the user reads: the `<pre aria-label="Terminal output">`
 * and the panel's status line, never a websocket frame on its own.
 *
 * The app needs a non-empty `PUBLIC_CONVEX_URL` before `Terminal.svelte` offers the device form,
 * and this repo's gate has no Convex deployment. A second `vite preview` is started with that
 * variable pointing at a port nothing listens on, and the Convex sync socket is answered by
 * `page.routeWebSocket` with one paired `terminal` device. The app's own code, the app's own
 * rendering; only the one query that is not under test is stood in for.
 *
 * Every process started here is recorded and stopped by exact PID in `afterAll`. Nothing kills a
 * process it did not spawn, and no port is chosen by looking at what is already listening.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import WebSocket from 'ws';

const BRIDGE = 'bridge/terminal-bridge.mjs';
const VITE = path.join('node_modules', 'vite', 'bin', 'vite.js');
// Deliberately not shaped like a credential: this value only has to be long enough for the
// bridge's own 32-character floor, and the repo's secret scanner should never see a fake one.
const TOKEN = 'fixture-not-a-secret-bridge-token';
const ROTATED = 'rotated-token-0987654321-ponmlkjihgfedcba';
const MAX_OUTPUT = 200_000;
const TS = 'AAAAAAAAAAA=';

/** Every child this file started, so `afterAll` can stop exactly those and nothing else. */
const children = new Set<ChildProcess>();
const scratch: string[] = [];

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as AddressInfo;
			server.close(() => resolve(port));
		});
	});
}

/** True once something accepts a TCP connection on `port`. */
function accepts(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ port, host: '127.0.0.1' });
		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.once('error', () => resolve(false));
	});
}

async function until(check: () => Promise<boolean>, message: () => string, timeout = 60_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	throw new Error(message());
}

type Bridge = { child: ChildProcess; port: number; origin: string; log: () => string };

async function startBridge(options: {
	allowOrigin: string;
	port?: number;
	token?: string;
	maxConnections?: number;
}): Promise<Bridge> {
	const port = options.port ?? (await freePort());
	const child = spawn(process.execPath, [BRIDGE], {
		env: {
			...process.env,
			BRIDGE_TOKEN: options.token ?? TOKEN,
			BRIDGE_PORT: String(port),
			BRIDGE_HOST: '127.0.0.1',
			BRIDGE_ALLOW_ORIGIN: options.allowOrigin,
			BRIDGE_SHELL: 'bash',
			BRIDGE_CWD: process.cwd(),
			BRIDGE_MAX_CONNECTIONS: String(options.maxConnections ?? 8)
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	children.add(child);
	let log = '';
	const collect = (chunk: Buffer) => (log += chunk.toString());
	child.stdout?.on('data', collect);
	child.stderr?.on('data', collect);
	await until(
		async () => log.includes('terminal bridge on'),
		() => `bridge on ${port} did not start: ${log || '(no output)'}`
	);
	return { child, port, origin: `http://127.0.0.1:${port}`, log: () => log };
}

/** Stop one bridge this file started and wait until its port is actually free again. */
async function stopBridge(bridge: Bridge | null): Promise<void> {
	if (!bridge) return;
	if (bridge.child.exitCode === null && bridge.child.signalCode === null) {
		await new Promise<void>((resolve) => {
			bridge.child.once('exit', () => resolve());
			bridge.child.kill();
		});
	}
	children.delete(bridge.child);
	await until(
		async () => !(await accepts(bridge.port)),
		() => `port ${bridge.port} still accepts connections after the bridge exited`
	);
}

let appPromise: Promise<string> | null = null;

/**
 * A cloud-shaped app server on a port of its own.
 *
 * `PUBLIC_CONVEX_URL` is read per request from `$env/dynamic/public`, so the value here is what
 * the browser receives. It points at a port nothing listens on: the panel only needs it to be
 * non-empty, and the sync socket it would open is answered inside the page by `pairDevice`.
 * The build itself is the one the gate already produced.
 */
function app(): Promise<string> {
	appPromise ??= (async () => {
		const port = await freePort();
		const child = spawn(
			process.execPath,
			[VITE, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
			{
				env: { ...process.env, PUBLIC_CONVEX_URL: 'http://127.0.0.1:1' },
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
		children.add(child);
		await until(
			() => accepts(port),
			() => `the app on ${port} did not start`
		);
		return `http://127.0.0.1:${port}`;
	})();
	return appPromise;
}

/**
 * Answer the one Convex query the panel reads, with a single paired `terminal` device.
 *
 * `convex-svelte` subscribes by sending `ModifyQuerySet`; a `QueryUpdated` transition for that
 * query id is the whole protocol `Terminal.svelte` needs. Only `devices:list` is answered.
 */
async function pairDevice(page: Page, endpoint: string): Promise<void> {
	await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (ws) => {
		ws.onMessage((raw) => {
			const message = JSON.parse(raw.toString()) as {
				type: string;
				baseVersion?: number;
				newVersion?: number;
				modifications?: Array<{ type: string; queryId: number; udfPath: string }>;
			};
			const version = (querySet: number) => ({ querySet, ts: TS, identity: 0 });
			if (message.type === 'Connect') {
				ws.send(
					JSON.stringify({
						type: 'Transition',
						startVersion: version(0),
						endVersion: version(0),
						modifications: []
					})
				);
				return;
			}
			if (message.type !== 'ModifyQuerySet') return;
			ws.send(
				JSON.stringify({
					type: 'Transition',
					startVersion: version(message.baseVersion ?? 0),
					endVersion: version(message.newVersion ?? 0),
					modifications: (message.modifications ?? [])
						.filter((entry) => entry.type === 'Add')
						.map((entry) => ({
							type: 'QueryUpdated',
							queryId: entry.queryId,
							value:
								entry.udfPath === 'devices:list'
									? [
											{
												_id: 'device-1',
												name: 'Paired laptop',
												kind: 'terminal',
												lastSeenAt: 1_700_000_000_000,
												endpoint
											}
										]
									: null,
							logLines: []
						}))
				})
			);
		});
	});
}

const output = (page: Page) => page.getByLabel('Terminal output');
const input = (page: Page) => page.getByLabel('Terminal input');
const connectButton = (page: Page) => page.getByRole('button', { name: /^(Connect|Reconnect)$/ });
/**
 * The panel's own state line: the status word, then the detail it was given. Selected by its
 * accessible name, because `#workspace` also contains the surface badge, which is a `role="status"`
 * of its own ("Stub · no runtime") and would otherwise win the `first()` race.
 */
const statusLine = (page: Page) => page.getByRole('status', { name: 'Terminal status' });

/** Reach the panel through the control a user has: View ▸ Tools ▸ Open tools ▸ Terminal. */
async function openTerminal(page: Page): Promise<void> {
	await page.getByRole('menuitem', { name: 'View' }).click();
	await page.getByRole('menuitem', { name: 'Tools', exact: true }).hover();
	await page.getByRole('menuitem', { name: 'Open tools' }).click();
	await page.getByRole('searchbox', { name: 'Find a local tool' }).fill('Terminal');
	await page.locator('.launcher-list button', { hasText: 'Terminal' }).click();
	await expect(output(page)).toBeVisible();
}

/**
 * Load the app with both preconditions met — the Tools switch and a paired device — pick the
 * device, paste the token, and press Connect.
 */
async function attach(page: Page, endpoint: string, token = TOKEN): Promise<void> {
	await page.addInitScript(() => {
		localStorage.setItem('workspace-template:device-tools-v1', JSON.stringify(['terminal']));
	});
	await pairDevice(page, endpoint);
	await page.goto(`${await app()}/#terminal`);
	await openTerminal(page);
	await page.locator('#workspace select').selectOption('device-1');
	await expect(page.getByLabel('Bridge endpoint')).toHaveValue(endpoint);
	await page.getByLabel('Pairing token').fill(token);
	await connectButton(page).click();
}

/** The panel is usable only when its own input says so. */
async function waitForOpen(page: Page): Promise<void> {
	await expect(statusLine(page)).toContainText('open', { timeout: 15_000 });
	await expect(input(page)).toBeEnabled();
}

async function run(page: Page, command: string): Promise<void> {
	await input(page).fill(command);
	await input(page).press('Enter');
}

/** A handshake the browser cannot perform on demand: custom Origin, forged Host, no protocol. */
function handshake(
	url: string,
	protocols: string[] | null,
	headers: Record<string, string>
): Promise<string> {
	return new Promise((resolve) => {
		const ws = protocols
			? new WebSocket(url, protocols, { headers })
			: new WebSocket(url, { headers });
		ws.on('open', () => {
			ws.close();
			resolve('101');
		});
		ws.on('unexpected-response', (_request, response) => resolve(String(response.statusCode)));
		ws.on('error', () => resolve('error'));
	});
}

test.afterAll(async () => {
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null) child.kill();
	}
	children.clear();
	for (const directory of scratch) await rm(directory, { recursive: true, force: true });
});

test.beforeEach(() => {
	// The panel markup is width-independent and each case starts real processes, so one project
	// runs the file and the other two skip instead of tripling the cost.
	test.skip(
		test.info().project.name !== 'desktop',
		'one pass; the panel markup is width-independent'
	);
});

// ── 1. Full round trip ──────────────────────────────────────────────────────────────────────

test('a command typed in the panel runs in a real shell and comes back rendered', async ({
	page
}) => {
	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		await attach(page, bridge.origin);
		await waitForOpen(page);

		const marker = `MARKER-${Math.random().toString(36).slice(2, 10)}`;
		await run(page, `echo ${marker}`);
		await expect(output(page)).toContainText(marker, { timeout: 15_000 });
		// The marker is in the <pre> the user reads, not only in a frame.
		expect(await output(page).innerText()).toContain(marker);

		// Same socket, same shell: state set by one line is read back by the next.
		const state = `STATE-${Math.random().toString(36).slice(2, 8)}`;
		await run(page, `GREETING=${state}`);
		await run(page, 'echo "carried=$GREETING"');
		await expect(output(page)).toContainText(`carried=${state}`, { timeout: 15_000 });
		await expect(statusLine(page)).toContainText('open');
	} finally {
		await stopBridge(bridge);
	}
});

test('the panel is usable on the first keystroke after the resize frame it sends on open', async ({
	page
}) => {
	// Regression: `resize` reached the pty as `child.kill('SIGWINCH')`, and any `kill()` sets
	// `child.killed` forever. The panel resizes the moment it opens, so its first frame disabled
	// input for the rest of the session while the status still read `open`.
	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		// The frame is debounced, so waiting for the panel to open is not enough: without waiting
		// for the frame itself, a fast typist races the debounce and the test passes for the wrong
		// reason. This waits until the resize has actually been sent.
		const resized = new Promise<void>((resolve) => {
			page.on('websocket', (socket) => {
				if (!socket.url().includes('/v1/terminal')) return;
				socket.on('framesent', (frame) => {
					if (String(frame.payload).includes('"type":"resize"')) resolve();
				});
			});
		});
		await attach(page, bridge.origin);
		await waitForOpen(page);
		await resized;

		const marker = `AFTER-RESIZE-${Math.random().toString(36).slice(2, 8)}`;
		await run(page, `echo ${marker}`);
		await expect(output(page)).toContainText(marker, { timeout: 15_000 });
	} finally {
		await stopBridge(bridge);
	}
});

// ── 2. Token enforcement ────────────────────────────────────────────────────────────────────

test('a wrong token is refused and the panel states why', async ({ page }) => {
	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		await attach(page, bridge.origin, 'wrong-token-0123456789');
		await expect(statusLine(page)).toContainText(/error|closed/, { timeout: 15_000 });
		await expect(statusLine(page)).not.toContainText('open');
		// The stated reason names the things the user can act on. A bare "closed (code 1006)"
		// names nothing.
		await expect(statusLine(page)).toContainText(/token|origin|endpoint/i);
		await expect(input(page)).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
	} finally {
		await stopBridge(bridge);
	}
});

test('a missing token is refused before a socket is attempted', async ({ page }) => {
	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		await page.addInitScript(() => {
			localStorage.setItem('workspace-template:device-tools-v1', JSON.stringify(['terminal']));
		});
		await pairDevice(page, bridge.origin);
		await page.goto(`${await app()}/#terminal`);
		await openTerminal(page);
		await page.locator('#workspace select').selectOption('device-1');
		await connectButton(page).click();

		await expect(statusLine(page)).toContainText('error');
		await expect(statusLine(page)).toContainText(/pairing token/i);
		await expect(input(page)).toBeDisabled();
	} finally {
		await stopBridge(bridge);
	}
});

test('the token travels only as the bearer subprotocol, never in the URL', async ({ page }) => {
	const bridge = await startBridge({ allowOrigin: await app() });
	const seen: string[] = [];
	try {
		page.on('websocket', (socket) => seen.push(socket.url()));
		await attach(page, bridge.origin);
		await waitForOpen(page);
		await run(page, 'echo URL-CHECK');
		await expect(output(page)).toContainText('URL-CHECK', { timeout: 15_000 });

		const terminalSocket = seen.find((url) => url.includes('/v1/terminal'));
		expect(terminalSocket, `no terminal socket among ${JSON.stringify(seen)}`).toBeTruthy();
		// The token is only in the subprotocol, which Playwright does not put in `url()`.
		expect(terminalSocket).not.toContain(TOKEN);
		expect(terminalSocket).not.toContain('token=');
		expect(terminalSocket).not.toContain('/v1/terminal/');
	} finally {
		await stopBridge(bridge);
	}
});

test('a token offered in the query string is refused by the bridge', async () => {
	// The panel never builds such a URL. This is the bridge refusing the shape anyway, so a
	// hand-rolled client cannot move the credential somewhere a proxy log would keep it.
	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		const base = `${bridge.origin.replace('http:', 'ws:')}/v1/terminal`;
		// Query string only: no subprotocol, so nothing to authenticate with.
		expect(await handshake(`${base}?token=${TOKEN}`, null, { origin: await app() })).toBe('401');
		// Even with a valid subprotocol the query copy is not an alternative credential path:
		// the handshake succeeds on the protocol, and the URL is never what authorised it.
		expect(
			await handshake(`${base}?token=${ROTATED}`, [`bearer.${TOKEN}`], { origin: await app() })
		).toBe('101');
	} finally {
		await stopBridge(bridge);
	}
});

test('a token the bridge no longer honours is refused, and a fresh one is accepted', async ({
	page
}) => {
	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		await attach(page, bridge.origin);
		await waitForOpen(page);

		// The tab now remembers `TOKEN`. Rotate the bridge's credential on the same port.
		const port = bridge.port;
		await stopBridge(bridge);
		const rotated = await startBridge({ allowOrigin: await app(), port, token: ROTATED });
		try {
			await page.getByRole('button', { name: 'Reconnect' }).click();
			await expect(statusLine(page)).toContainText(/error|closed/, { timeout: 15_000 });
			await expect(statusLine(page)).not.toContainText('open');
			await expect(statusLine(page)).toContainText(/token|origin|endpoint/i);

			// Reuse of a still-valid token is by design: the token is a shared secret for as long
			// as the bridge runs it. A *replaced* token is what has to stop working.
			await page.getByRole('button', { name: 'Use another token' }).click();
			await page.getByLabel('Pairing token').fill(ROTATED);
			await connectButton(page).click();
			await waitForOpen(page);
			const marker = `ROTATED-${Math.random().toString(36).slice(2, 8)}`;
			await run(page, `echo ${marker}`);
			await expect(output(page)).toContainText(marker, { timeout: 15_000 });
		} finally {
			await stopBridge(rotated);
		}
	} finally {
		await stopBridge(null);
	}
});

// ── 3. Origin enforcement ──────────────────────────────────────────────────────────────────

test('the page can read the health answer, which is what Test connection needs', async ({
	page
}) => {
	// Regression: `/v1/health` sent no CORS headers and answered `OPTIONS` with 404, so the
	// browser refused to hand the response to the page. `Devices`'s own "Test connection" then
	// reported `TypeError: Failed to fetch` for a bridge that answered 200 to curl. The fetch
	// below is made from the app's origin, exactly as that button makes it.
	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		await page.goto(await app());
		const result = await page.evaluate(
			async ([origin, token]) => {
				try {
					const response = await fetch(`${origin}/v1/health`, {
						headers: { Authorization: `Bearer ${token}` }
					});
					return { status: response.status, body: await response.json() };
				} catch (error) {
					return { threw: String(error) };
				}
			},
			[bridge.origin, TOKEN] as const
		);
		expect(result.threw, `the page could not read the answer: ${result.threw}`).toBeUndefined();
		expect(result.status).toBe(200);
		expect(result.body).toMatchObject({ ok: true });

		// A foreign origin is not granted CORS, so it cannot read the answer even with a token.
		const preflight = await page.request.fetch(`${bridge.origin}/v1/health`, {
			method: 'OPTIONS',
			headers: { origin: 'https://evil.example' }
		});
		expect(preflight.status()).toBe(403);
		expect(preflight.headers()['access-control-allow-origin']).toBeUndefined();
	} finally {
		await stopBridge(bridge);
	}
});

test('a foreign origin is refused during the handshake', async () => {
	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		const url = `${bridge.origin.replace('http:', 'ws:')}/v1/terminal`;
		expect(await handshake(url, [`bearer.${TOKEN}`], { origin: 'https://evil.example' })).toBe(
			'403'
		);
		// Control: the same handshake from the allowlisted origin is accepted, so the 403 above
		// is the origin rule and not a broken bridge.
		expect(await handshake(url, [`bearer.${TOKEN}`], { origin: await app() })).toBe('101');
	} finally {
		await stopBridge(bridge);
	}
});

test('an Origin forged to agree with a forged Host is refused', async () => {
	// The same-host rule used to compare Origin against the request's own Host. A client sets
	// both, so agreement proved nothing and this exact request was accepted. Same-host mode is
	// the SSH-tunnel default, so the bridge here has no allowlist.
	const bridge = await startBridge({ allowOrigin: '' });
	try {
		const { port, origin } = bridge;
		const url = `ws://127.0.0.1:${port}/v1/terminal`;
		expect(
			await handshake(url, [`bearer.${TOKEN}`], {
				origin: `http://evil.example:${port}`,
				host: `evil.example:${port}`
			})
		).toBe('403');
		// And the bridge's own origin in same-host mode is still accepted.
		expect(await handshake(url, [`bearer.${TOKEN}`], { origin })).toBe('101');
	} finally {
		await stopBridge(bridge);
	}
});

test('a null origin is refused, and a trailing dot does not become a bypass', async () => {
	const bridge = await startBridge({ allowOrigin: '' });
	try {
		const { port, origin } = bridge;
		const url = `ws://127.0.0.1:${port}/v1/terminal`;

		// `Origin: null` is what a sandboxed frame and a `file://` page send. It must never be
		// treated as "a non-browser client, so nothing to confuse".
		expect(await handshake(url, [`bearer.${TOKEN}`], { origin: 'null' })).toBe('403');

		// `127.0.0.1.` is the same name to the resolver, and `new URL` normalises it onto the
		// origin this bridge answers to. Accepting it is correct; refusing it would be a false
		// negative for a browser that sent it.
		expect(await handshake(url, [`bearer.${TOKEN}`], { origin: `http://127.0.0.1.:${port}` })).toBe(
			'101'
		);

		// The same trailing dot on a foreign host must not inherit that normalisation.
		expect(
			await handshake(url, [`bearer.${TOKEN}`], { origin: `http://evil.example.:${port}` })
		).toBe('403');

		// The bridge's own origin, stated plainly, still works.
		expect(await handshake(url, [`bearer.${TOKEN}`], { origin })).toBe('101');
	} finally {
		await stopBridge(bridge);
	}
});

// ── 4. Lifecycle ──────────────────────────────────────────────────────────────────────────

test('killing the shell while attached is reported instead of hanging', async ({ page }) => {
	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		await attach(page, bridge.origin);
		await waitForOpen(page);

		await run(page, 'echo BEFORE-KILL; kill -9 $$');
		// The last line the shell wrote survives: the socket closes on `close`, which fires after
		// the child's stdio has drained, not on `exit`.
		await expect(output(page)).toContainText('BEFORE-KILL', { timeout: 15_000 });
		await expect(statusLine(page)).toContainText('closed', { timeout: 15_000 });
		await expect(statusLine(page)).toContainText(/shell exited/i);
		// A signal death is not success: `code 0` for a `kill -9` reads as a clean exit.
		await expect(statusLine(page)).toContainText(/signal SIGKILL/i);
		await expect(input(page)).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
	} finally {
		await stopBridge(bridge);
	}
});

test('the panel reconnects after the bridge restarts', async ({ page }) => {
	const bridge = await startBridge({ allowOrigin: await app() });
	const port = bridge.port;
	try {
		await attach(page, bridge.origin);
		await waitForOpen(page);
		await run(page, 'echo FIRST-LIFE');
		await expect(output(page)).toContainText('FIRST-LIFE', { timeout: 15_000 });

		await stopBridge(bridge);
		await expect(statusLine(page)).toContainText(/error|closed/, { timeout: 15_000 });

		const revived = await startBridge({ allowOrigin: await app(), port });
		try {
			await page.getByRole('button', { name: 'Reconnect' }).click();
			await waitForOpen(page);
			const marker = `SECOND-LIFE-${Math.random().toString(36).slice(2, 8)}`;
			await run(page, `echo ${marker}`);
			await expect(output(page)).toContainText(marker, { timeout: 15_000 });
		} finally {
			await stopBridge(revived);
		}
	} finally {
		await stopBridge(bridge);
	}
});

test('two tabs at once: the connection cap admits one and the second is told', async ({
	page,
	context
}) => {
	const bridge = await startBridge({ allowOrigin: await app(), maxConnections: 1 });
	try {
		const url = `${bridge.origin.replace('http:', 'ws:')}/v1/terminal`;
		await attach(page, bridge.origin);
		await waitForOpen(page);
		await run(page, 'echo FIRST-TAB');
		await expect(output(page)).toContainText('FIRST-TAB', { timeout: 15_000 });

		// The cap is real on the wire, not just a number in a config file.
		expect(await handshake(url, [`bearer.${TOKEN}`], { origin: await app() })).toBe('503');

		// And a second tab shows a stated failure instead of a spinner forever.
		const second = await context.newPage();
		await attach(second, bridge.origin);
		await expect(statusLine(second)).toContainText(/error|closed/, { timeout: 15_000 });
		await expect(statusLine(second)).not.toContainText('open');
		await expect(input(second)).toBeDisabled();

		// The refused tab does not disturb the one that holds the pty.
		await run(page, 'echo FIRST-TAB-SURVIVES');
		await expect(output(page)).toContainText('FIRST-TAB-SURVIVES', { timeout: 15_000 });
		await second.close();
	} finally {
		await stopBridge(bridge);
	}
});

// ── 5. Output integrity ───────────────────────────────────────────────────────────────────

test('1 MB of output keeps its tail and says the head was dropped', async ({ page }) => {
	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		await attach(page, bridge.origin);
		await waitForOpen(page);

		const marker = `TAIL-${Math.random().toString(36).slice(2, 8)}`;
		await run(page, `head -c 1048576 /dev/zero | tr "\\0" x; echo ""; echo ${marker}`);
		await expect(output(page)).toContainText(marker, { timeout: 40_000 });

		const rendered = await output(page).innerText();
		// The newest output is intact, not a prefix cut off at the bridge. `innerText` keeps the
		// shell's trailing newline, so compare after trimming the end only.
		expect(rendered.trimEnd().endsWith(marker)).toBe(true);
		// The panel caps at 200 000 characters and keeps the newest.
		expect(rendered.length).toBeLessThanOrEqual(MAX_OUTPUT);
		expect(rendered.length).toBeGreaterThan(MAX_OUTPUT - 100);
		// A cap that is reached says so; silently dropping the head would look like a bug.
		await expect(page.getByText(/Older output was dropped/)).toBeVisible();
	} finally {
		await stopBridge(bridge);
	}
});

test('a UTF-8 character split across two chunks arrives whole', async ({ page }) => {
	// 40 000 three-byte characters: chunk boundaries land mid-character many times over.
	// Decoding each chunk on its own turned those splits into U+FFFD replacement characters.
	const directory = await mkdtemp(path.join(tmpdir(), 'bridge-e2e-'));
	scratch.push(directory);
	const script = path.join(directory, 'multibyte.mjs');
	await writeFile(script, "process.stdout.write('\\u3042'.repeat(40000));\n", 'utf8');

	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		await attach(page, bridge.origin);
		await waitForOpen(page);

		await run(page, `node ${JSON.stringify(script)}`);
		await expect
			.poll(async () => (await output(page).innerText()).length, { timeout: 30_000 })
			.toBeGreaterThanOrEqual(40_000);

		const rendered = await output(page).innerText();
		expect(rendered).not.toContain('\uFFFD');
		expect(rendered).toContain('\u3042');
		expect(rendered.length).toBe(40_000);
	} finally {
		await stopBridge(bridge);
	}
});

test('a command that produces no newline still renders', async ({ page }) => {
	const bridge = await startBridge({ allowOrigin: await app() });
	try {
		await attach(page, bridge.origin);
		await waitForOpen(page);

		await run(page, 'printf NO-NEWLINE-TAIL');
		// Nothing waits for a newline that never arrives.
		await expect(output(page)).toContainText('NO-NEWLINE-TAIL', { timeout: 15_000 });
		expect(await output(page).innerText()).toMatch(/NO-NEWLINE-TAIL$/);

		// The shell is still there afterwards: no newline did not wedge the pipe.
		await run(page, 'echo STILL-ALIVE');
		await expect(output(page)).toContainText('STILL-ALIVE', { timeout: 15_000 });
	} finally {
		await stopBridge(bridge);
	}
});

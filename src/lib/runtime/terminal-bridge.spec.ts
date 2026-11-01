/**
 * The bridge is a separate process, so this exercises the real thing: spawn it on a random
 * port, then speak its own protocol over HTTP and WebSocket. No mocks, because the contract
 * in docs/terminal.md is about wire behaviour and a mock would only test the mock.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import WebSocket from 'ws';

const SCRIPT = 'bridge/terminal-bridge.mjs';
// Base64url only: a WebSocket subprotocol name cannot carry +, / or =.
const TOKEN = 'test-token-0123456789-abcdefghijklmnop';

let child: ChildProcess;
let port: number;
let base: string;

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port: assigned } = server.address() as AddressInfo;
			server.close(() => resolve(assigned));
		});
	});
}

function waitForLine(stream: NodeJS.ReadableStream, needle: string): Promise<string> {
	return new Promise((resolve, reject) => {
		let buffer = '';
		const timer = setTimeout(() => reject(new Error(`timeout waiting for: ${needle}`)), 10_000);
		stream.on('data', (chunk: Buffer) => {
			buffer += chunk.toString();
			if (buffer.includes(needle)) {
				clearTimeout(timer);
				resolve(buffer);
			}
		});
	});
}

beforeAll(async () => {
	port = await freePort();
	base = `http://127.0.0.1:${port}`;
	child = spawn(process.execPath, [SCRIPT], {
		env: {
			...process.env,
			BRIDGE_TOKEN: TOKEN,
			BRIDGE_PORT: String(port),
			BRIDGE_HOST: '127.0.0.1',
			BRIDGE_ALLOW_ORIGIN: 'https://app.example'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	await waitForLine(child.stdout!, 'terminal bridge on');
}, 20_000);

afterAll(() => {
	child?.kill();
});

describe('health endpoint', () => {
	test('accepts the bearer token', async () => {
		const response = await fetch(`${base}/v1/health`, {
			headers: { authorization: `Bearer ${TOKEN}` }
		});
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ ok: true });
	});

	test('rejects a wrong token and a missing one', async () => {
		const wrong = await fetch(`${base}/v1/health`, {
			headers: { authorization: 'Bearer not-the-token-at-all' }
		});
		expect(wrong.status).toBe(401);

		const none = await fetch(`${base}/v1/health`);
		expect(none.status).toBe(401);
	});
});

describe('terminal socket', () => {
	test('runs a shell and keeps state between frames', async () => {
		const transcript = await new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/terminal`, [`bearer.${TOKEN}`]);
			let out = '';
			const timer = setTimeout(() => reject(new Error(`timeout: ${JSON.stringify(out)}`)), 10_000);
			ws.on('open', () => ws.send('X=BRIDGE-STATE; echo "got=$X"\n'));
			ws.on('message', (data) => {
				out += data.toString();
				if (out.includes('got=BRIDGE-STATE')) {
					clearTimeout(timer);
					ws.close();
					resolve(out);
				}
			});
			ws.on('error', reject);
		});
		expect(transcript).toContain('got=BRIDGE-STATE');
	});

	test('refuses a handshake without the bearer subprotocol', async () => {
		const status = await new Promise((resolve) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/terminal`);
			ws.on('open', () => {
				ws.close();
				resolve(101);
			});
			ws.on('unexpected-response', (_request, response) => resolve(response.statusCode));
			ws.on('error', () => resolve(-1));
		});
		expect(status).toBe(401);
	});

	test('refuses an origin that is not on the allowlist', async () => {
		const status = await new Promise((resolve) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/terminal`, [`bearer.${TOKEN}`], {
				headers: { origin: 'https://evil.example' }
			});
			ws.on('open', () => {
				ws.close();
				resolve(101);
			});
			ws.on('unexpected-response', (_request, response) => resolve(response.statusCode));
			ws.on('error', () => resolve(-1));
		});
		expect(status).toBe(403);
	});

	test('closes a binary frame with 1003', async () => {
		const code = await new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/terminal`, [`bearer.${TOKEN}`], {
				headers: { origin: 'https://app.example' }
			});
			ws.on('open', () => ws.send(Buffer.from([0, 1, 2])));
			ws.on('close', (closed) => resolve(closed));
			ws.on('error', reject);
			setTimeout(() => reject(new Error('timeout')), 10_000);
		});
		expect(code).toBe(1003);
	});

	test('the shell it hands out does not carry the token that opened it', async () => {
		// BRIDGE_TOKEN is the credential for this shell. Inheriting `process.env` put it in
		// every transcript and every `env` a command printed.
		const line = await new Promise<string>((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/terminal`, [`bearer.${TOKEN}`], {
				headers: { origin: 'https://app.example' }
			});
			let out = '';
			ws.on('open', () => ws.send('printf "tok=[%s]\\n" "$BRIDGE_TOKEN"\n'));
			ws.on('message', (data) => {
				out += data.toString();
				const match = /tok=\[([^\]]*)\]/.exec(out);
				if (match) {
					ws.close();
					resolve(match[1]);
				}
			});
			ws.on('error', reject);
			setTimeout(() => reject(new Error(`timeout: ${JSON.stringify(out)}`)), 10_000);
		});
		expect(line).not.toContain(TOKEN);
	});
});

/**
 * Same-host mode, with no `BRIDGE_ALLOW_ORIGIN`, is the documented default for a tunnel.
 * It used to compare `Origin` against the request's own `Host`, which the client controls:
 * set both to the same attacker host and the check passes. This instance proves the fix.
 */
describe('same-host origin check', () => {
	let own: ChildProcess;
	let ownPort: number;

	beforeAll(async () => {
		ownPort = await freePort();
		own = spawn(process.execPath, [SCRIPT], {
			env: {
				...process.env,
				BRIDGE_TOKEN: TOKEN,
				BRIDGE_PORT: String(ownPort),
				BRIDGE_HOST: '127.0.0.1',
				BRIDGE_ALLOW_ORIGIN: ''
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});
		await waitForLine(own.stdout!, 'terminal bridge on');
	}, 20_000);

	afterAll(() => own?.kill());

	function handshake(headers: Record<string, string>) {
		return new Promise<number>((resolve) => {
			const ws = new WebSocket(`ws://127.0.0.1:${ownPort}/v1/terminal`, [`bearer.${TOKEN}`], {
				headers
			});
			ws.on('open', () => {
				ws.close();
				resolve(101);
			});
			ws.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? -1));
			ws.on('error', () => resolve(-1));
		});
	}

	test('accepts the bridge origin itself', async () => {
		expect(await handshake({ origin: `http://127.0.0.1:${ownPort}` })).toBe(101);
	});

	test('refuses an origin that merely agrees with a forged Host header', async () => {
		const forged = `http://evil.example:${ownPort}`;
		expect(await handshake({ origin: forged, host: `evil.example:${ownPort}` })).toBe(403);
	});
});

test('a non-numeric connection cap refuses to start instead of removing the limit', async () => {
	const port = await freePort();
	const child = spawn(process.execPath, [SCRIPT], {
		env: {
			...process.env,
			BRIDGE_TOKEN: TOKEN,
			BRIDGE_PORT: String(port),
			BRIDGE_MAX_CONNECTIONS: 'not-a-number'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const [code, stderr] = await new Promise<[number | null, string]>((resolve) => {
		let err = '';
		child.stderr!.on('data', (chunk: Buffer) => (err += chunk.toString()));
		child.on('exit', (exit) => resolve([exit, err]));
	});
	expect(code).toBe(1);
	expect(stderr).toContain('BRIDGE_MAX_CONNECTIONS');
});

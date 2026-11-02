/**
 * Tests for the terminal bridge process.
 *
 * Spawns the bridge on an ephemeral loopback port with a temporary
 * root directory for BRIDGE_FS_ROOTS and verifies the HTTP contract:
 * - 401 without a token
 * - 200 exec ['echo','ok'] returns code 0 and stdout ok\n
 * - exec refuses an empty argv and an oversized argv
 * - fs/write then fs/read round-trips inside the root
 * - a write outside the root is 403
 * - a symlink inside the root that points outside is 403 for read and write
 * - a body over 64 KB is 413
 * - an unknown path is 404
 * - a foreign Origin is 403
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TOKEN = 'test-bridge-token-0123456789-abcdef';
let child;
let port;
let base;
let tempDir;

function freePort() {
	return new Promise((resolvePort, rejectPort) => {
		const server = createServer();
		server.on('error', rejectPort);
		server.listen(0, '127.0.0.1', () => {
			const { port: assigned } = server.address();
			server.close(() => resolvePort(assigned));
		});
	});
}

function waitForLine(stream, needle) {
	return new Promise((resolveWait, rejectWait) => {
		let buffer = '';
		const timer = setTimeout(() => rejectWait(new Error(`timeout waiting for: ${needle}`)), 10000);
		stream.on('data', (chunk) => {
			buffer += chunk.toString();
			if (buffer.includes(needle)) {
				clearTimeout(timer);
				resolveWait(buffer);
			}
		});
		stream.on('error', rejectWait);
	});
}

before(async () => {
	port = await freePort();
	base = `http://127.0.0.1:${port}`;
	tempDir = await mkdtemp(join(tmpdir(), 'bridge-test-'));

	child = spawn(process.execPath, ['bridge/terminal-bridge.mjs'], {
		env: {
			...process.env,
			BRIDGE_TOKEN: TOKEN,
			BRIDGE_PORT: String(port),
			BRIDGE_HOST: '127.0.0.1',
			BRIDGE_FS_ROOTS: tempDir,
			BRIDGE_ALLOW_ORIGIN: 'https://app.example'
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});

	await waitForLine(child.stdout, 'terminal bridge on');
});

after(async () => {
	if (child && !child.killed) {
		child.kill();
	}
	try {
		await rm(tempDir, { recursive: true, force: true });
	} catch {
		// Ignore cleanup errors
	}
});

describe('terminal bridge contract', () => {
	test('401 without a token', async () => {
		const resExec = await fetch(`${base}/v1/exec`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ argv: ['echo', 'ok'] })
		});
		assert.equal(resExec.status, 401);
		assert.equal(resExec.headers.get('cache-control'), 'no-store');
		const dataExec = await resExec.json();
		assert.deepEqual(dataExec, { error: 'unauthorized' });

		const resRead = await fetch(`${base}/v1/fs/read`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ path: join(tempDir, 'file.txt') })
		});
		assert.equal(resRead.status, 401);
		assert.equal(resRead.headers.get('cache-control'), 'no-store');
		const dataRead = await resRead.json();
		assert.deepEqual(dataRead, { error: 'unauthorized' });

		const resWrite = await fetch(`${base}/v1/fs/write`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ path: join(tempDir, 'file.txt'), text: 'test' })
		});
		assert.equal(resWrite.status, 401);
		assert.equal(resWrite.headers.get('cache-control'), 'no-store');
		const dataWrite = await resWrite.json();
		assert.deepEqual(dataWrite, { error: 'unauthorized' });
	});

	test("200 exec ['echo','ok'] returns code 0 and stdout ok\\n", async () => {
		const res = await fetch(`${base}/v1/exec`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`
			},
			body: JSON.stringify({ argv: ['echo', 'ok'] })
		});
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('content-type'), 'application/json');
		assert.equal(res.headers.get('cache-control'), 'no-store');
		const data = await res.json();
		assert.deepEqual(data, { code: 0, stdout: 'ok\n' });
	});

	test('exec refuses an empty argv and an oversized argv', async () => {
		const emptyRes = await fetch(`${base}/v1/exec`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`
			},
			body: JSON.stringify({ argv: [] })
		});
		assert.equal(emptyRes.status, 400);
		assert.equal(emptyRes.headers.get('cache-control'), 'no-store');
		const emptyData = await emptyRes.json();
		assert.deepEqual(emptyData, { error: 'invalid argv' });

		const tooManyRes = await fetch(`${base}/v1/exec`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`
			},
			body: JSON.stringify({ argv: Array.from({ length: 33 }, () => 'echo') })
		});
		assert.equal(tooManyRes.status, 400);
		const tooManyData = await tooManyRes.json();
		assert.deepEqual(tooManyData, { error: 'invalid argv' });

		const tooLongArgRes = await fetch(`${base}/v1/exec`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`
			},
			body: JSON.stringify({ argv: ['echo', 'a'.repeat(201)] })
		});
		assert.equal(tooLongArgRes.status, 400);
		const tooLongData = await tooLongArgRes.json();
		assert.deepEqual(tooLongData, { error: 'invalid argv' });

		const nulArgRes = await fetch(`${base}/v1/exec`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`
			},
			body: JSON.stringify({ argv: ['echo', 'bad\0arg'] })
		});
		assert.equal(nulArgRes.status, 400);
		const nulData = await nulArgRes.json();
		assert.deepEqual(nulData, { error: 'invalid argv' });
	});

	test('fs/write then fs/read round-trips inside the root', async () => {
		const filePath = join(tempDir, 'roundtrip.txt');
		const fileText = 'hello world from bridge\nround-trip verified';

		const writeRes = await fetch(`${base}/v1/fs/write`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`
			},
			body: JSON.stringify({ path: filePath, text: fileText })
		});
		assert.equal(writeRes.status, 200);
		assert.equal(writeRes.headers.get('content-type'), 'application/json');
		assert.equal(writeRes.headers.get('cache-control'), 'no-store');
		const writeData = await writeRes.json();
		assert.deepEqual(writeData, { ok: true });

		const readRes = await fetch(`${base}/v1/fs/read`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`
			},
			body: JSON.stringify({ path: filePath })
		});
		assert.equal(readRes.status, 200);
		assert.equal(readRes.headers.get('content-type'), 'application/json');
		assert.equal(readRes.headers.get('cache-control'), 'no-store');
		const readData = await readRes.json();
		assert.deepEqual(readData, { text: fileText });
	});

	test('a write outside the root is 403', async () => {
		const outsidePath = resolve(tempDir, '../outside-root.txt');
		const writeRes = await fetch(`${base}/v1/fs/write`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`
			},
			body: JSON.stringify({ path: outsidePath, text: 'unauthorized write' })
		});
		assert.equal(writeRes.status, 403);
		assert.equal(writeRes.headers.get('content-type'), 'application/json');
		assert.equal(writeRes.headers.get('cache-control'), 'no-store');
		const writeData = await writeRes.json();
		assert.deepEqual(writeData, { error: 'forbidden' });

		const readRes = await fetch(`${base}/v1/fs/read`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`
			},
			body: JSON.stringify({ path: outsidePath })
		});
		assert.equal(readRes.status, 403);
		assert.equal(readRes.headers.get('cache-control'), 'no-store');
		const readData = await readRes.json();
		assert.deepEqual(readData, { error: 'forbidden' });
	});

	test('a body over 64 KB is 413', async () => {
		const bigPayload = JSON.stringify({
			path: join(tempDir, 'big.txt'),
			text: 'x'.repeat(66000)
		});
		assert.ok(Buffer.byteLength(bigPayload) > 65536);

		const res = await fetch(`${base}/v1/fs/write`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`
			},
			body: bigPayload
		});
		assert.equal(res.status, 413);
		assert.equal(res.headers.get('content-type'), 'application/json');
		assert.equal(res.headers.get('cache-control'), 'no-store');
		const data = await res.json();
		assert.deepEqual(data, { error: 'payload too large' });
	});

	test('an unknown path is 404', async () => {
		const res = await fetch(`${base}/v1/unknown-endpoint`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`
			},
			body: JSON.stringify({ argv: ['echo', 'hi'] })
		});
		assert.equal(res.status, 404);
		assert.equal(res.headers.get('content-type'), 'application/json');
		assert.equal(res.headers.get('cache-control'), 'no-store');
		const data = await res.json();
		assert.deepEqual(data, { error: 'not found' });
	});

	test('a symlink inside the root cannot escape it', async () => {
		const outside = await mkdtemp(join(tmpdir(), 'bridge-outside-'));
		const secret = join(outside, 'secret.txt');
		await writeFile(secret, 'outside the root\n', 'utf8');
		const link = join(tempDir, 'escape.txt');
		try {
			await symlink(secret, link);
		} catch {
			// Windows without developer mode cannot create symlinks; the escape is POSIX-shaped.
			await rm(outside, { recursive: true, force: true });
			return;
		}

		const readRes = await fetch(`${base}/v1/fs/read`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
			body: JSON.stringify({ path: link })
		});
		assert.equal(readRes.status, 403);
		assert.deepEqual(await readRes.json(), { error: 'forbidden' });

		const writeRes = await fetch(`${base}/v1/fs/write`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
			body: JSON.stringify({ path: link, text: 'overwritten' })
		});
		assert.equal(writeRes.status, 403);
		assert.deepEqual(await writeRes.json(), { error: 'forbidden' });

		await rm(outside, { recursive: true, force: true });
	});

	test('a foreign Origin is 403', async () => {
		const res = await fetch(`${base}/v1/exec`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`,
				origin: 'https://evil.example'
			},
			body: JSON.stringify({ argv: ['echo', 'forbidden'] })
		});
		assert.equal(res.status, 403);
		assert.equal(res.headers.get('content-type'), 'application/json');
		assert.equal(res.headers.get('cache-control'), 'no-store');
		const data = await res.json();
		assert.deepEqual(data, { error: 'forbidden' });
	});
});

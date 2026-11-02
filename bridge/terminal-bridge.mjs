/**
 * Terminal bridge — the service the browser panel talks to.
 *
 * The web app never executes anything. A shell only exists on a machine the user owns, and
 * this process is that machine's half of the contract in `docs/terminal.md`:
 *
 *   GET /v1/health           Authorization: Bearer <token>  -> 200 or 401
 *   POST /v1/exec            { argv: string[] }             -> { code: number, stdout: string }
 *   POST /v1/fs/read         { path: string }               -> { text: string }
 *   POST /v1/fs/write        { path: string, text: string } -> { ok: true }
 *   WebSocket /v1/terminal   subprotocol `bearer.<token>`   -> one pty
 *   frames                   text only, both directions
 *   resize                   {"type":"resize","cols":N,"rows":N} inbound
 *
 * Two deliberate limits: the token is compared in constant time and never logged, and every
 * connection is checked against an origin allowlist so another site cannot open a socket
 * with a token the user pasted here. Run it on loopback and expose it with `tailscale serve`;
 * binding it to a public interface is the user's decision, not a default.
 *
 * Usage:
 *   BRIDGE_TOKEN=$(openssl rand -base64 32) node bridge/terminal-bridge.mjs
 *   BRIDGE_TOKEN=... BRIDGE_ALLOW_ORIGIN=https://app.example node bridge/terminal-bridge.mjs
 */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.BRIDGE_PORT ?? 8649);
const HOST = process.env.BRIDGE_HOST ?? '127.0.0.1';
const TOKEN = process.env.BRIDGE_TOKEN ?? '';
const SHELL =
	process.env.BRIDGE_SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : 'bash');

// Comma-separated exact origins. Empty means "this loopback bridge only", which is right for
// the SSH-tunnel case. A proxy (tailscale serve/funnel) sees the browser's real origin and needs
// it listed here, or every handshake is refused with 403 — say so at startup instead of failing
// later.
const ALLOWED = (process.env.BRIDGE_ALLOW_ORIGIN ?? '')
	.split(',')
	.map((value) => value.trim())
	.filter(Boolean);

const TERMINAL_PATH = '/v1/terminal';
const HEALTH_PATH = '/v1/health';
const EXEC_PATH = '/v1/exec';
const FS_READ_PATH = '/v1/fs/read';
const FS_WRITE_PATH = '/v1/fs/write';
const MAX_FRAME_BYTES = 65536;
const MAX_BODY_BYTES = 65536;
const MAX_STDOUT_BYTES = 65536;
const MAX_FILE_BYTES = 1000000;
const MAX_WRITE_CHARS = 200000;
const MAX_ARGV_ENTRIES = 32;
const MAX_ARG_CHARS = 200;
const MAX_PATH_CHARS = 500;
const EXEC_TIMEOUT_MS = 10000;
const MAX_CONNECTIONS = Number(process.env.BRIDGE_MAX_CONNECTIONS ?? 8);
const SELF_ORIGINS = selfOrigins(HOST, PORT);

if (!TOKEN) {
	console.error(
		'BRIDGE_TOKEN is required. Generate one with: openssl rand -base64 32 | tr "+/" "-_" | tr -d "="'
	);
	process.exit(1);
}
if (TOKEN.length < 16) {
	console.error('BRIDGE_TOKEN must be at least 16 characters.');
	process.exit(1);
}
// The token rides in a WebSocket subprotocol name, and RFC 6455 restricts those to
// tchar: A-Z a-z 0-9 and !#$%&'*+-.^_`|~ — plus `bearer.` in front. Base64url is the
// safe alphabet; plain base64 emits +, / and = and every handshake dies with
// "An invalid or duplicated subprotocol was specified". Refuse it here, loudly.
if (!/^[A-Za-z0-9._~-]+$/.test(TOKEN)) {
	console.error(
		'BRIDGE_TOKEN must contain only A-Z a-z 0-9 . _ ~ - characters.\n' +
			'Plain base64 emits +, / and =, which cannot appear in a WebSocket subprotocol.\n' +
			'Generate one with: openssl rand -base64 32 | tr "+/" "-_" | tr -d "="'
	);
	process.exit(1);
}
// `Number('abc')` is NaN, and `live.size >= NaN` is false forever: a typo silently removed the
// connection cap. Refuse to start instead of running without a limit nobody knows is gone.
if (!Number.isInteger(MAX_CONNECTIONS) || MAX_CONNECTIONS < 1) {
	console.error('BRIDGE_MAX_CONNECTIONS must be a positive whole number.');
	process.exit(1);
}

/** Constant-time compare that does not leak the token length through an early return. */
function tokenMatches(candidate) {
	if (typeof candidate !== 'string' || candidate.length !== TOKEN.length) return false;
	const a = Buffer.from(candidate);
	const b = Buffer.from(TOKEN);
	return a.length === b.length && timingSafeEqual(a, b);
}

function bearerFrom(header) {
	if (typeof header !== 'string') return null;
	const match = /^Bearer (.+)$/.exec(header);
	return match ? match[1] : null;
}

/** The browser cannot set headers on a socket, so the token rides in the subprotocol. */
function tokenFromProtocols(protocols) {
	for (const protocol of protocols) {
		if (protocol.startsWith('bearer.')) return protocol.slice('bearer.'.length);
	}
	return null;
}

/** Empty allowlist means the request must be same-origin as the bridge itself. */
function originAllowed(origin) {
	if (!origin) return true; // Non-browser client: nothing to confuse, the token is the gate.
	let parsed;
	try {
		parsed = new URL(origin);
	} catch {
		return false;
	}
	if (ALLOWED.includes(parsed.origin)) return true;
	if (ALLOWED.length) return false;
	// No allowlist configured: accept only when the origin points at this very bridge.
	//
	// The comparison must not read `Host`. A WebSocket handshake lets the client set both
	// `Origin` and `Host`, so trusting the request's own host means the check only proves the
	// two headers agree with each other — an attacker sets both to `evil.example:PORT` and is
	// accepted. Compare against the port this process actually listens on instead, so the
	// same-host rule cannot be satisfied by a name the bridge does not answer to.
	return SELF_ORIGINS.has(parsed.origin);
}

/** The origins this bridge answers to, from configuration rather than from a request header. */
function selfOrigins(host, port) {
	const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
	const literal = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
	if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1')
		origins.add(`http://${literal}:${port}`);
	return origins;
}

/** Child environment: never hand the pairing token to the shell the token unlocks. */
function shellEnv() {
	const env = { ...process.env, TERM: 'xterm-256color' };
	for (const key of Object.keys(env)) if (key.startsWith('BRIDGE_')) delete env[key];
	return env;
}

function sendJson(response, statusCode, payload) {
	if (response.headersSent) return;
	response.writeHead(statusCode, {
		'content-type': 'application/json',
		'cache-control': 'no-store'
	});
	response.end(JSON.stringify(payload));
}

function getFsRoots() {
	const raw = process.env.BRIDGE_FS_ROOTS ?? '';
	const entries = raw
		.split(':')
		.map((part) => part.trim())
		.filter(Boolean);
	if (entries.length === 0) {
		return [resolve(process.cwd())];
	}
	return entries.map((part) => resolve(process.cwd(), part));
}

function resolveSafePath(filePath) {
	if (
		typeof filePath !== 'string' ||
		filePath.length < 1 ||
		filePath.length > MAX_PATH_CHARS ||
		filePath.includes('\0')
	) {
		return { status: 400, path: null };
	}
	const candidate = resolve(process.cwd(), filePath);
	const roots = getFsRoots();
	for (const root of roots) {
		const rel = relative(root, candidate);
		if (!rel.startsWith('..') && !isAbsolute(rel)) {
			return { status: 200, path: candidate };
		}
	}
	return { status: 403, path: null };
}

function isValidArgv(argv) {
	if (!Array.isArray(argv) || argv.length < 1 || argv.length > MAX_ARGV_ENTRIES) return false;
	for (const arg of argv) {
		if (typeof arg !== 'string' || arg.length > MAX_ARG_CHARS || arg.includes('\0')) {
			return false;
		}
	}
	return true;
}

function readJsonBody(request, response) {
	return new Promise((resolveBody) => {
		const contentLength = Number(request.headers['content-length']);
		if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
			request.resume();
			sendJson(response, 413, { error: 'payload too large' });
			resolveBody(null);
			return;
		}

		let bytes = 0;
		const chunks = [];
		let exceeded = false;

		request.on('data', (chunk) => {
			if (exceeded) return;
			bytes += chunk.length;
			if (bytes > MAX_BODY_BYTES) {
				exceeded = true;
				request.resume();
				sendJson(response, 413, { error: 'payload too large' });
				resolveBody(null);
				return;
			}
			chunks.push(chunk);
		});

		request.on('end', () => {
			if (exceeded) return;
			const raw = Buffer.concat(chunks).toString('utf8');
			try {
				const parsed = JSON.parse(raw);
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
					sendJson(response, 400, { error: 'invalid json' });
					resolveBody(null);
					return;
				}
				resolveBody(parsed);
			} catch {
				sendJson(response, 400, { error: 'invalid json' });
				resolveBody(null);
			}
		});

		request.on('error', () => {
			if (!exceeded && !response.headersSent) {
				sendJson(response, 400, { error: 'bad request' });
			}
			resolveBody(null);
		});
	});
}

async function handleExec(request, response) {
	if (!originAllowed(request.headers.origin)) {
		sendJson(response, 403, { error: 'forbidden' });
		return;
	}
	if (!tokenMatches(bearerFrom(request.headers.authorization))) {
		sendJson(response, 401, { error: 'unauthorized' });
		return;
	}
	const body = await readJsonBody(request, response);
	if (!body) return;

	if (!isValidArgv(body.argv)) {
		sendJson(response, 400, { error: 'invalid argv' });
		return;
	}

	const [command, ...args] = body.argv;
	let child;
	try {
		child = spawn(command, args, {
			shell: false,
			timeout: EXEC_TIMEOUT_MS,
			env: shellEnv(),
			stdio: ['ignore', 'pipe', 'pipe']
		});
	} catch {
		sendJson(response, 200, { code: 1, stdout: '' });
		return;
	}

	const stdoutChunks = [];
	let stdoutBytes = 0;
	let truncated = false;

	child.stdout.on('data', (chunk) => {
		if (truncated) return;
		if (stdoutBytes + chunk.length > MAX_STDOUT_BYTES) {
			const allowed = Math.max(0, MAX_STDOUT_BYTES - stdoutBytes);
			if (allowed > 0) {
				stdoutChunks.push(chunk.subarray(0, allowed));
				stdoutBytes += allowed;
			}
			truncated = true;
			return;
		}
		stdoutChunks.push(chunk);
		stdoutBytes += chunk.length;
	});

	child.stderr.resume();

	let finished = false;
	const finish = (code) => {
		if (finished) return;
		finished = true;
		let stdout = Buffer.concat(stdoutChunks).toString('utf8');
		if (truncated) {
			stdout += (stdout.endsWith('\n') ? '' : '\n') + '[truncated]';
		}
		sendJson(response, 200, { code, stdout });
	};

	child.on('error', (err) => {
		const code = err.code === 'ENOENT' ? 127 : 1;
		finish(code);
	});

	child.on('close', (code) => {
		const exitCode = typeof code === 'number' ? code : 1;
		finish(exitCode);
	});

	request.on('close', () => {
		if (!finished && !child.killed) {
			child.kill();
		}
	});
}

async function handleFsRead(request, response) {
	if (!originAllowed(request.headers.origin)) {
		sendJson(response, 403, { error: 'forbidden' });
		return;
	}
	if (!tokenMatches(bearerFrom(request.headers.authorization))) {
		sendJson(response, 401, { error: 'unauthorized' });
		return;
	}
	const body = await readJsonBody(request, response);
	if (!body) return;

	const resolved = resolveSafePath(body.path);
	if (resolved.status !== 200) {
		sendJson(response, resolved.status, {
			error: resolved.status === 400 ? 'invalid path' : 'forbidden'
		});
		return;
	}

	try {
		const info = await stat(resolved.path);
		if (info.isDirectory()) {
			sendJson(response, 400, { error: 'cannot read directory' });
			return;
		}
		if (info.size > MAX_FILE_BYTES) {
			sendJson(response, 413, { error: 'file too large' });
			return;
		}
		const text = await readFile(resolved.path, 'utf8');
		if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
			sendJson(response, 413, { error: 'file too large' });
			return;
		}
		sendJson(response, 200, { text });
	} catch (err) {
		if (err && err.code === 'ENOENT') {
			sendJson(response, 404, { error: 'not found' });
			return;
		}
		sendJson(response, 500, { error: 'read failed' });
	}
}

async function handleFsWrite(request, response) {
	if (!originAllowed(request.headers.origin)) {
		sendJson(response, 403, { error: 'forbidden' });
		return;
	}
	if (!tokenMatches(bearerFrom(request.headers.authorization))) {
		sendJson(response, 401, { error: 'unauthorized' });
		return;
	}
	const body = await readJsonBody(request, response);
	if (!body) return;

	const resolved = resolveSafePath(body.path);
	if (resolved.status !== 200) {
		sendJson(response, resolved.status, {
			error: resolved.status === 400 ? 'invalid path' : 'forbidden'
		});
		return;
	}

	if (typeof body.text !== 'string' || body.text.length > MAX_WRITE_CHARS) {
		sendJson(response, 400, { error: 'invalid text' });
		return;
	}

	try {
		await writeFile(resolved.path, body.text, 'utf8');
		sendJson(response, 200, { ok: true });
	} catch (err) {
		if (err && (err.code === 'ENOENT' || err.code === 'EISDIR')) {
			sendJson(response, 404, { error: 'parent directory does not exist' });
			return;
		}
		sendJson(response, 500, { error: 'write failed' });
	}
}

const server = createServer((request, response) => {
	const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
	// `/v1/health` is fetched by the app's own "Test connection" from a different origin, so the
	// browser needs CORS. The preflight carries no token (it must not), and it grants nothing:
	// the real request still has to present the bearer token. Origin is the same allowlist the
	// WebSocket uses, so a foreign page learns nothing by asking.
	const origin = request.headers.origin;
	const cors =
		origin && originAllowed(origin)
			? { 'access-control-allow-origin': origin, vary: 'origin' }
			: {};

	if (request.method === 'OPTIONS' && url.pathname === HEALTH_PATH) {
		response.writeHead(origin && originAllowed(origin) ? 204 : 403, {
			...cors,
			'access-control-allow-methods': 'GET',
			'access-control-allow-headers': 'authorization',
			// A preflight is cached for 10 minutes, so "Test connection" does not double its RTTs.
			'access-control-max-age': '600',
			'cache-control': 'no-store'
		});
		response.end();
		return;
	}

	if (url.pathname === HEALTH_PATH && request.method === 'GET') {
		if (!tokenMatches(bearerFrom(request.headers.authorization))) {
			response.writeHead(401, { ...cors, 'content-type': 'application/json' });
			response.end('{"error":"unauthorized"}');
			return;
		}
		response.writeHead(200, { ...cors, 'content-type': 'application/json' });
		response.end(JSON.stringify({ ok: true, shell: SHELL, connections: live.size }));
		return;
	}

	if (url.pathname === EXEC_PATH && request.method === 'POST') {
		handleExec(request, response);
		return;
	}

	if (url.pathname === FS_READ_PATH && request.method === 'POST') {
		handleFsRead(request, response);
		return;
	}

	if (url.pathname === FS_WRITE_PATH && request.method === 'POST') {
		handleFsWrite(request, response);
		return;
	}

	response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	response.end('{"error":"not found"}');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
const live = new Set();

server.on('upgrade', (request, socket, head) => {
	const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
	const reject = (code, reason) => {
		socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`);
		socket.destroy();
	};

	if (url.pathname !== TERMINAL_PATH) return reject(404, 'Not Found');
	if (!originAllowed(request.headers.origin)) return reject(403, 'Forbidden');
	if (live.size >= MAX_CONNECTIONS) return reject(503, 'Too Many Connections');

	const protocols = (request.headers['sec-websocket-protocol'] ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	const token = tokenFromProtocols(protocols);
	if (!tokenMatches(token)) return reject(401, 'Unauthorized');

	// Echo back only the bearer subprotocol, never a client-supplied one, so a page cannot
	// claim an arbitrary protocol on the accepted socket. `handleUpgrade` sets
	// `ws.protocol` itself, so the chosen value is passed and read back, not assigned.
	wss.handleUpgrade(
		request,
		socket,
		head,
		(ws) => {
			wss.emit('connection', ws, request);
		},
		`bearer.${TOKEN}`
	);
});

wss.on('connection', (ws) => {
	const pty = spawn(SHELL, [], {
		cwd: process.env.BRIDGE_CWD ?? process.env.HOME ?? process.cwd(),
		env: shellEnv(),
		stdio: ['pipe', 'pipe', 'pipe']
	});

	live.add(ws);
	// `pty.killed` is set by any `kill()` call, including a signal that does not end the
	// process. `resize` sends SIGWINCH through `kill()`, so after the first resize frame
	// `pty.killed` stayed true and every keystroke was dropped while the socket still looked
	// open. Track the exit ourselves and leave `killed` out of the liveness question.
	let exited = false;

	const closePty = () => {
		live.delete(ws);
		if (!exited) {
			exited = true;
			pty.kill();
		}
	};
	ws.on('close', closePty);
	ws.on('error', closePty);

	// Two streams, two decoders: a sequence split across a chunk boundary is held back
	// instead of becoming U+FFFD, and stdout/stderr never share a partial sequence.
	const stdoutDecoder = new StringDecoder('utf8');
	const stderrDecoder = new StringDecoder('utf8');
	const forward = (decoder) => (chunk) => {
		if (ws.readyState !== ws.OPEN) return;
		// Text frames only: the client refuses binary.
		const text = decoder.write(chunk);
		if (text) ws.send(text);
	};
	pty.stdout.on('data', forward(stdoutDecoder));
	pty.stderr.on('data', forward(stderrDecoder));
	// `close` fires after the child's stdio has drained; `exit` fires before buffered output is
	// delivered, so closing on `exit` threw away the last lines a dying shell wrote.
	pty.on('close', (code, signal) => {
		exited = true;
		live.delete(ws);
		// A signal death has `code === null`. Saying "code 0" for a `kill -9` reads as success.
		const how = code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`;
		try {
			ws.close(1000, `shell exited with ${how}`);
		} catch {
			// Already gone.
		}
	});

	ws.on('message', (data, isBinary) => {
		if (isBinary) {
			ws.close(1003, 'Binary frames are not supported');
			return;
		}
		const text = data.toString('utf8');
		if (text.length > MAX_FRAME_BYTES) {
			ws.close(1009, 'Frame too large');
			return;
		}
		// One control frame exists; everything else is raw shell input.
		if (text.startsWith('{"type":"resize"')) {
			try {
				const message = JSON.parse(text);
				if (message.type === 'resize') {
					const cols = clampInt(message.cols, 1, 500);
					const rows = clampInt(message.rows, 1, 300);
					// node-pty is not a dependency here; resize is applied through the shell's
					// own signal when the child supports SIGWINCH, otherwise it is a no-op.
					// `kill()` sets `child.killed`, so liveness is tracked separately.
					if (cols && rows && !exited) pty.kill('SIGWINCH');
					return;
				}
			} catch {
				// Fall through and treat it as input: never drop what the user typed.
			}
		}
		if (!exited) pty.stdin.write(text);
	});

	ws.on('error', () => closePty());
});

function clampInt(value, min, max) {
	const number = Number(value);
	if (!Number.isFinite(number)) return null;
	const rounded = Math.round(number);
	return rounded < min || rounded > max ? null : rounded;
}

server.listen(PORT, HOST, () => {
	console.log(`terminal bridge on http://${HOST}:${PORT}`);
	console.log(`  health   GET ${HEALTH_PATH} (Bearer token)`);
	console.log(`  exec     POST ${EXEC_PATH} (Bearer token)`);
	console.log(`  fs/read  POST ${FS_READ_PATH} (Bearer token)`);
	console.log(`  fs/write POST ${FS_WRITE_PATH} (Bearer token)`);
	console.log(`  terminal WS  ${TERMINAL_PATH} (subprotocol bearer.<token>)`);
	console.log(`  shell    ${SHELL}`);
	console.log(
		ALLOWED.length
			? `  origins  ${ALLOWED.join(', ')}`
			: `  origins  ${[...SELF_ORIGINS].join(', ')} only (set BRIDGE_ALLOW_ORIGIN behind a proxy)`
	);
});

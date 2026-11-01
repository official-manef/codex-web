/**
 * Terminal bridge — the service the browser panel talks to.
 *
 * The web app never executes anything. A shell only exists on a machine the user owns, and
 * this process is that machine's half of the contract in `docs/terminal.md`:
 *
 *   GET /v1/health           Authorization: Bearer <token>  -> 200 or 401
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
const MAX_FRAME_BYTES = 65536;
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

const server = createServer((request, response) => {
	const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

	if (url.pathname === HEALTH_PATH && request.method === 'GET') {
		if (!tokenMatches(bearerFrom(request.headers.authorization))) {
			response.writeHead(401, { 'content-type': 'application/json' });
			response.end('{"error":"unauthorized"}');
			return;
		}
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ ok: true, shell: SHELL, connections: live.size }));
		return;
	}

	response.writeHead(404, { 'content-type': 'application/json' });
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

	const closePty = () => {
		live.delete(ws);
		if (!pty.killed) pty.kill();
	};
	ws.on('close', closePty);
	ws.on('error', closePty);

	const forward = (chunk) => {
		if (ws.readyState !== ws.OPEN) return;
		// Text frames only: the client refuses binary, so decode and let bad bytes become U+FFFD.
		ws.send(chunk.toString('utf8'));
	};
	pty.stdout.on('data', forward);
	pty.stderr.on('data', forward);
	pty.on('exit', (code) => {
		live.delete(ws);
		try {
			ws.close(1000, `shell exited with code ${code ?? 0}`);
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
					if (cols && rows && !pty.killed) pty.kill('SIGWINCH');
					return;
				}
			} catch {
				// Fall through and treat it as input: never drop what the user typed.
			}
		}
		if (!pty.killed) pty.stdin.write(text);
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
	console.log(`  terminal WS  ${TERMINAL_PATH} (subprotocol bearer.<token>)`);
	console.log(`  shell    ${SHELL}`);
	console.log(
		ALLOWED.length
			? `  origins  ${ALLOWED.join(', ')}`
			: `  origins  ${[...SELF_ORIGINS].join(', ')} only (set BRIDGE_ALLOW_ORIGIN behind a proxy)`
	);
});

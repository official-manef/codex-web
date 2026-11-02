#!/usr/bin/env node
/**
 * codex-cli — a terminal client for this workspace.
 *
 * It speaks to the app you installed, not to Convex directly: every command below maps to an
 * HTTP or WebSocket route that already enforces the same access checks as the browser. That
 * keeps one authorization path instead of two, and means a stolen CLI token can do exactly what
 * a stolen browser session could — nothing more.
 *
 * Config comes from the environment so it works in CI and on a VPS:
 *   CODEX_CLI_URL    https://your-app.example      (required)
 *   CODEX_CLI_TOKEN  the CAPABILITY_ACCESS_TOKEN   (required for chat and tools)
 *   CODEX_CLI_BRIDGE http://127.0.0.1:8649          (optional, for `shell`)
 *   CODEX_CLI_BRIDGE_TOKEN                         (optional, pairs with the bridge)
 *
 * Usage:
 *   codex-cli config                     what providers, models and MCP servers are enabled
 *   codex-cli ask "summarise this repo"  one turn, streamed to stdout
 *   codex-cli tools <alias>            list remote MCP tools
 *   codex-cli run <alias> <tool> [json] prepare, then call one allowlisted tool
 *   codex-cli shell                     interactive shell on your bridge
 *   codex-cli doctor                    check every endpoint before you rely on it
 */
import { stdin, stdout } from 'node:process';

const URL_BASE = (process.env.CODEX_CLI_URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.CODEX_CLI_TOKEN ?? '';
const BRIDGE = (process.env.CODEX_CLI_BRIDGE ?? '').replace(/\/+$/, '');
const BRIDGE_TOKEN = process.env.CODEX_CLI_BRIDGE_TOKEN ?? '';

const [command, ...rest] = process.argv.slice(2);

function die(message, code = 1) {
	console.error(`error: ${message}`);
	process.exit(code);
}

function needApp() {
	if (!URL_BASE) die('CODEX_CLI_URL is not set. Example: export CODEX_CLI_URL=https://app.example');
}

function needToken() {
	needApp();
	if (!TOKEN) die('CODEX_CLI_TOKEN is not set (use CAPABILITY_ACCESS_TOKEN).');
}

const auth = () => (TOKEN ? { authorization: `Bearer ${TOKEN}` } : {});

async function json(path, init = {}) {
	const response = await fetch(`${URL_BASE}${path}`, {
		...init,
		headers: { 'content-type': 'application/json', ...auth(), ...(init.headers ?? {}) },
		signal: AbortSignal.timeout(60_000)
	});
	const text = await response.text();
	if (!response.ok) die(`${path} -> HTTP ${response.status} ${text.slice(0, 300)}`);
	try {
		return JSON.parse(text);
	} catch {
		die(`${path} -> response was not JSON`);
	}
}

/* ── commands ─────────────────────────────────────────────────────────────────────────── */

async function cmdConfig() {
	needApp();
	const body = await json('/api/ai/config');
	if (!body.ai?.enabled) {
		console.log('AI is disabled on this deployment (AI_ENABLED is not true).');
	} else {
		for (const provider of body.ai.providers) {
			console.log(`${provider.id}  (${provider.label})`);
			for (const model of provider.models) console.log(`  ${model}`);
		}
	}
	console.log(
		body.mcp?.enabled
			? `\nmcp enabled · ${body.mcp.servers.length} server(s): ${body.mcp.servers.map((s) => s.alias).join(', ')}`
			: '\nmcp disabled (MCP_CLIENT_ENABLED is not true)'
	);
}

/**
 * One streamed turn. The server sends SSE-ish `data: {...}` lines with `text`, `error` and
 * `done`; this prints text as it arrives so a long answer is readable before it ends.
 */
async function cmdAsk(prompt) {
	needToken();
	if (!prompt) die('usage: codex-cli ask "<prompt>"');

	const config = await json('/api/ai/config');
	const provider = config.ai?.providers?.[0];
	if (!provider) die('no approved provider/model is configured (AI_MODELS_JSON).');
	const model = provider.models[0];

	const response = await fetch(`${URL_BASE}/api/ai/chat`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...auth() },
		body: JSON.stringify({
			provider: provider.id,
			model,
			apiKey: '',
			messages: [{ role: 'user', content: prompt }]
		}),
		signal: AbortSignal.timeout(120_000)
	});
	if (!response.ok)
		die(`/api/ai/chat -> HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);

	const reader = response.body?.getReader();
	if (!reader) die('the server sent no body');
	const decoder = new TextDecoder();
	let buffer = '';
	let wrote = false;

	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		let index;
		// Frames are separated by a blank line; keep the tail for the next read.
		while ((index = buffer.indexOf('\n\n')) >= 0) {
			const frame = buffer.slice(0, index);
			buffer = buffer.slice(index + 2);
			for (const line of frame.split('\n')) {
				if (!line.startsWith('data:')) continue;
				const payload = line.slice(5).trim();
				if (!payload || payload === '[DONE]') continue;
				let event;
				try {
					event = JSON.parse(payload);
				} catch {
					continue;
				}
				if (event.type === 'text') {
					stdout.write(event.text);
					wrote = true;
				} else if (event.type === 'error') die(event.message ?? 'provider error');
			}
		}
	}
	if (wrote) stdout.write('\n');
}

async function cmdTools(alias) {
	needToken();
	if (!alias) die('usage: codex-cli tools <alias>');
	const body = await json('/api/mcp/tools', {
		method: 'POST',
		body: JSON.stringify({ action: 'list', alias, token: TOKEN })
	});
	const tools = body.tools ?? body;
	console.log(JSON.stringify(tools, null, 2));
}

async function cmdRun(alias, tool, argsJson) {
	needToken();
	if (!alias || !tool) die('usage: codex-cli run <alias> <tool> ["{json args}"]');
	let args = {};
	if (argsJson) {
		try {
			args = JSON.parse(argsJson);
		} catch {
			die('arguments must be valid JSON');
		}
	}
	// Two steps, because the route refuses a caller-asserted "confirmed: true": prepare freezes the
	// exact arguments and returns a 120-second one-shot approval, execute spends it.
	const prepared = await json('/api/mcp/tools', {
		method: 'POST',
		body: JSON.stringify({ action: 'prepare', alias, tool, arguments: args, token: TOKEN })
	});
	const body = await json('/api/mcp/tools', {
		method: 'POST',
		body: JSON.stringify({
			action: 'execute',
			alias,
			tool,
			arguments: args,
			approval: prepared.approval,
			token: TOKEN
		})
	});
	console.log(JSON.stringify(body, null, 2));
}

/**
 * Interactive shell on the user's own bridge. Raw text frames, exactly like the browser panel,
 * so the bridge contract in docs/terminal.md is the only thing either side needs to know.
 */
async function cmdShell() {
	if (!BRIDGE || !BRIDGE_TOKEN) die('set CODEX_CLI_BRIDGE and CODEX_CLI_BRIDGE_TOKEN to use shell');
	if (!/^[A-Za-z0-9._~-]+$/.test(BRIDGE_TOKEN))
		die('the bridge token may only contain A-Z a-z 0-9 . _ ~ - (a subprotocol cannot carry more)');

	const socket = new WebSocket(`${BRIDGE.replace(/^http/, 'ws')}/v1/terminal`, [
		`bearer.${BRIDGE_TOKEN}`
	]);
	socket.onopen = () => {
		stdin.setRawMode?.(true);
		stdin.resume();
	};
	socket.onmessage = (event) => stdout.write(typeof event.data === 'string' ? event.data : '');
	socket.onclose = (event) => {
		stdin.setRawMode?.(false);
		console.error(`\n[bridge closed ${event.code}]`);
		process.exit(0);
	};
	socket.onerror = () => die('the bridge refused the connection; check the endpoint and token');

	stdin.on('data', (chunk) => {
		// Ctrl-C twice in a raw terminal would otherwise kill the client, not the remote shell.
		if (chunk.length === 1 && chunk[0] === 3) return socket.close();
		if (socket.readyState === 1) socket.send(chunk.toString());
	});
}

async function cmdDoctor() {
	needApp();
	const rows = [];
	const check = async (label, run) => {
		const started = Date.now();
		try {
			const detail = await run();
			rows.push([label, 'ok', `${Date.now() - started}ms`, detail ?? '']);
		} catch (error) {
			rows.push([label, 'FAIL', `${Date.now() - started}ms`, error.message.slice(0, 120)]);
		}
	};

	await check('app /api/ai/config', async () => {
		const body = await json('/api/ai/config');
		return body.ai?.enabled ? `${body.ai.providers.length} provider(s)` : 'AI disabled';
	});
	await check('app /api/mcp/server', async () => {
		const response = await fetch(`${URL_BASE}/api/mcp/server`, {
			signal: AbortSignal.timeout(10_000)
		});
		return `HTTP ${response.status}`;
	});
	if (BRIDGE) {
		await check('bridge /v1/health', async () => {
			const response = await fetch(`${BRIDGE}/v1/health`, {
				headers: { authorization: `Bearer ${BRIDGE_TOKEN}` },
				signal: AbortSignal.timeout(10_000)
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return 'reachable';
		});
	}

	const width = Math.max(...rows.map((r) => r[0].length)) + 2;
	for (const [label, state, time, detail] of rows)
		console.log(
			`${state === 'ok' ? 'ok  ' : 'FAIL'}  ${label.padEnd(width)}${time.padEnd(8)}${detail}`
		);
	if (rows.some((r) => r[1] !== 'ok')) process.exit(1);
}

/* ── dispatch ─────────────────────────────────────────────────────────────────────────── */

const COMMANDS = {
	config: () => cmdConfig(),
	ask: () => cmdAsk(rest.join(' ').trim()),
	tools: () => cmdTools(rest[0]),
	run: () => cmdRun(rest[0], rest[1], rest[2]),
	shell: () => cmdShell(),
	doctor: () => cmdDoctor()
};

if (!command || command === '--help' || command === 'help') {
	console.log(
		[
			'codex-cli — terminal client for this workspace',
			'',
			'  config                 show enabled providers, models and MCP servers',
			'  ask "<prompt>"         one streamed turn',
			'  tools                  list remote MCP tools',
			'  run <alias> <tool> []  call one allowlisted tool',
			'  shell                  interactive shell on your bridge',
			'  doctor                 check every endpoint',
			'',
			'Environment:',
			'  CODEX_CLI_URL          the app origin (required)',
			'  CODEX_CLI_TOKEN        CAPABILITY_ACCESS_TOKEN (chat and tools)',
			'  CODEX_CLI_BRIDGE       bridge origin, e.g. http://127.0.0.1:8649',
			'  CODEX_CLI_BRIDGE_TOKEN the bridge pairing token'
		].join('\n')
	);
	process.exit(0);
}

const handler = COMMANDS[command];
if (!handler) die(`unknown command "${command}". Run: codex-cli --help`);
await handler();

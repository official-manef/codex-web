#!/usr/bin/env node
/**
 * Install this workspace on a Linux host: VPS, container, or a laptop.
 *
 * Everything here is answerable from a terminal, which is why it is a CLI and not a setup screen.
 * `PUBLIC_CONVEX_URL` and `PUBLIC_SITE_URL` are read at BUILD time by Vite and baked into the
 * bundle — the app cannot render a form to collect a value that it needed before it started. A
 * frontend wizard can only ever change runtime variables, and those are the wrong ones.
 *
 * The script is deliberately boring: check tools, ask for the few values that have no safe
 * default, write `.env`, build, and print the exact command to start. It never writes a secret to
 * stdout, never guesses a domain, and never talks to Convex on your behalf unless you asked for
 * `--deploy-convex`.
 *
 * Usage:
 *   node scripts/install.mjs                      # interactive
 *   node scripts/install.mjs --dry-run            # print the plan, write nothing
 *   node scripts/install.mjs --site https://app.example --convex https://xyz.convex.cloud
 *   node scripts/install.mjs --generate-secrets   # fill AUTH_SESSION_SECRET / BRIDGE_TOKEN
 *
 * Non-interactive (a real install on a fresh VPS):
 *   node scripts/install.mjs --yes \
 *     --site https://app.example --convex https://xyz.convex.cloud \
 *     --generate-secrets
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
	const index = argv.indexOf(`--${name}`);
	return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : '';
};

const DRY = flag('dry-run');
const YES = flag('yes') || flag('non-interactive');
const GEN = flag('generate-secrets');

const ENV_PATH = value('env') || '.env';
const MIN_NODE = 22;
const SUPPORTED_MAJORS = new Set([22, 24]);

function fail(message) {
	console.error(`\n  error  ${message}\n`);
	process.exit(1);
}

function note(message) {
	console.log(`  ${message}`);
}

function heading(text) {
	console.log(`\n${text}`);
	console.log('─'.repeat(text.length));
}

/* ── preconditions ─────────────────────────────────────────────────────────────────────── */

function nodeMajor() {
	return Number(process.versions.node.split('.')[0]);
}

function checkNode() {
	const major = nodeMajor();
	if (major < MIN_NODE) fail(`Node ${MIN_NODE}+ is required; this is ${process.versions.node}.`);
	if (!SUPPORTED_MAJORS.has(major))
		note(
			`warning  Node ${major} is newer than Convex supports for 'use node' actions ` +
				`(it needs ${MIN_NODE} or 24). Deploying will fail until you switch.`
		);
}

function checkTool(name, args, hint) {
	if (DRY) {
		note(`skip    ${name} (dry run)`);
		return true;
	}
	const result = spawnSync(name, args, { stdio: 'pipe', encoding: 'utf8' });
	if (result.error || result.status !== 0) {
		note(`missing ${name}${hint ? ` — ${hint}` : ''}`);
		return false;
	}
	note(`ok      ${name} ${result.stdout.trim().split('\n')[0]}`);
	return true;
}

/* ── values ───────────────────────────────────────────────────────────────────────────── */

/** A bare origin, no path, no credentials. Matches what the app enforces at runtime. */
function normaliseOrigin(raw, name) {
	const text = (raw ?? '').trim().replace(/\/+$/, '');
	if (!text) return '';
	let url;
	try {
		url = new URL(text);
	} catch {
		fail(`${name} is not a valid URL: ${text}`);
	}
	if (!['http:', 'https:'].includes(url.protocol)) fail(`${name} must be http: or https:.`);
	if (url.username || url.password) fail(`${name} must not embed credentials.`);
	if (url.pathname !== '/' || url.search || url.hash)
		fail(`${name} must be an origin, with no path.`);
	return url.origin;
}

function readExistingEnv() {
	if (!existsSync(ENV_PATH)) return {};
	const out = {};
	for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (match) out[match[1]] = match[2];
	}
	return out;
}

async function ask(question, fallback) {
	if (YES) return fallback;
	const rl = createInterface({ input: stdin, output: stdout });
	try {
		const answer = (await rl.question(`  ${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
		return answer || fallback;
	} finally {
		rl.close();
	}
}

/* ── main ──────────────────────────────────────────────────────────────────────────────── */

heading('Workspace installer');

checkNode();
const haveBun = checkTool('bun', ['--version'], 'https://bun.sh');
checkTool('git', ['--version']);

if (!haveBun) fail('Bun is required to install dependencies and build this project.');

const existing = readExistingEnv();

const site = normaliseOrigin(
	value('site') ||
		existing.PUBLIC_SITE_URL ||
		(await ask('Public origin of this app', 'http://127.0.0.1:3000')),
	'PUBLIC_SITE_URL'
);

// Convex is required, not optional. This project stores user rows and provider keys, so a
// throwaway local backend is the wrong default; there is no empty fallback.
const convexRaw =
	value('convex') ||
	existing.PUBLIC_CONVEX_URL ||
	(await ask('Convex deployment URL (required)', ''));
if (!convexRaw)
	fail(
		'PUBLIC_CONVEX_URL is required. Create a deployment with `npx convex login && npx convex dev` ' +
			'on a machine with a browser, then pass --convex https://<deployment>.convex.cloud'
	);
const convex = normaliseOrigin(convexRaw, 'PUBLIC_CONVEX_URL');

const enableAuth =
	flag('auth') || (await ask('Enable Google sign-in? (y/N)', 'n')).toLowerCase().startsWith('y');

let clientId = value('client-id') || existing.AUTH_CLIENT_ID || '';
let clientSecret = value('client-secret') || existing.AUTH_CLIENT_SECRET || '';
let sessionSecret = existing.AUTH_SESSION_SECRET || '';
if (enableAuth && !clientId) clientId = await ask('Google OAuth client ID', '');
if (enableAuth && !clientSecret) clientSecret = await ask('Google OAuth client secret', '');

if (enableAuth && GEN && !sessionSecret) sessionSecret = randomBytes(32).toString('base64url');
if (enableAuth && !sessionSecret) {
	const typed = await ask('AUTH_SESSION_SECRET (blank = generate one now)', '');
	sessionSecret = typed || randomBytes(32).toString('base64url');
}
if (enableAuth && sessionSecret.length !== 43)
	fail('AUTH_SESSION_SECRET must be exactly 43 characters (32 bytes, base64url).');

const deployTarget = value('target') || 'node';
if (!['node', 'vercel'].includes(deployTarget)) fail('--target must be node or vercel.');

/* ── write ──────────────────────────────────────────────────────────────────────────────── */

const lines = [
	`# Written by scripts/install.mjs on ${new Date().toISOString().slice(0, 10)}.`,
	`# Read at build time by Vite. Editing PUBLIC_* here requires a rebuild.`,
	'',
	`PUBLIC_SITE_URL=${site}`,
	`PUBLIC_CONVEX_URL=${convex}`,
	'',
	`AUTH_ENABLED=${enableAuth ? 'true' : 'false'}`,
	'AUTH_PROVIDER=google',
	`AUTH_CLIENT_ID=${clientId}`,
	`AUTH_CLIENT_SECRET=${clientSecret}`,
	`AUTH_SESSION_SECRET=${sessionSecret}`,
	'',
	'# Convex reads this on the deployment itself, not here:',
	'#   npx convex env set MODELS_ENC_KEY "$(openssl rand -base64 32)"',
	''
].join('\n');

heading('Plan');
note(`site          ${site}`);
note(`convex        ${convex}`);
note(`auth          ${enableAuth ? 'Google OIDC' : 'disabled'}`);
note(`target        ${deployTarget}`);
note(`env file      ${ENV_PATH}`);
if (enableAuth)
	note(`redirect      ${site}/auth/callback   <- register this in Google Cloud Console`);

if (DRY) {
	heading('Dry run: nothing written');
	// Mask anything that would be a credential in the real file. A dry run must be safe to
	// paste into a ticket; printing a fresh session secret into a terminal scrollback is not.
	const masked = lines.replace(
		/^(AUTH_CLIENT_SECRET|AUTH_SESSION_SECRET)=(.+)$/gm,
		(_match, key, secret) =>
			`${key}=${'*'.repeat(Math.min(secret.length, 12))} (${secret.length} chars)`
	);
	console.log(masked);
	process.exit(0);
}

writeFileSync(ENV_PATH, lines, { mode: 0o600 });
note(`wrote ${ENV_PATH} (mode 600, secrets not printed)`);
if (enableAuth && !value('client-secret') && !existing.AUTH_CLIENT_SECRET && !YES)
	note('AUTH_SESSION_SECRET was generated; read it from the file when you need it.');

/* ── build ──────────────────────────────────────────────────────────────────────────────── */

function run(command, args, env = {}) {
	console.log(`\n$ ${command} ${args.join(' ')}`);
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		env: { ...process.env, DEPLOY_TARGET: deployTarget, ...env }
	});
	if (result.status !== 0) fail(`${command} ${args[0] ?? ''} failed.`);
}

run('bun', ['install', '--frozen-lockfile']);
run('bun', ['run', 'verify']);

if (flag('deploy-convex')) {
	// Only when asked: this pushes schema and functions to the deployment named in .env.
	if (!convex)
		fail('--deploy-convex needs --convex <url> (or CONVEX_DEPLOY_KEY in the environment).');
	run('bunx', ['convex', 'deploy']);
	note('Convex functions deployed. Set MODELS_ENC_KEY on the deployment if you have not.');
}

heading('Installed');
note('Start the server:');
console.log(`
  DEPLOY_TARGET=${deployTarget} HOST=127.0.0.1 PORT=3000 ORIGIN=${site} node build

  Put a TLS proxy in front of it before exposing it to anyone else, and set
  PUBLIC_SITE_URL to that https origin, then rebuild.

  Google sign-in needs ${site}/auth/callback registered as a redirect URI,
  and the same AUTH_CLIENT_ID set on the Convex deployment:
    npx convex env set AUTH_CLIENT_ID <id>
`);

if (site.startsWith('http://') && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(site))
	note(
		'warning  PUBLIC_SITE_URL is plain http on a non-loopback host; sign-in will refuse to start.'
	);

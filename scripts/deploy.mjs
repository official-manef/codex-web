import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const key = process.env.CONVEX_DEPLOY_KEY;
assert(key, 'Set CONVEX_DEPLOY_KEY in the hosting environment before deploying.');
assert(
	process.env.VERCEL_ENV !== 'preview' || key.startsWith('preview:'),
	'Preview builds require a preview deploy key; refusing to touch another backend.'
);
assert(
	process.env.VERCEL_ENV !== 'production' || key.startsWith('prod:'),
	'Production builds require a production deploy key.'
);

// `bun run verify` is `check && lint && test && build`. It does NOT cover `bin/gate`:
// secret scan, bridge contract, playwright e2e, dev-server smoke, Node-adapter smoke and the
// skip accounting. Running it here and calling the result "verified" was a false claim: a
// deploy could ship with no browser proof at all. This runs the gate itself, so the deploy
// preflight and `bin/gate` are the same definition by construction.
//
// Cost: the gate builds the Vercel bundle, the Node bundle and the playwright preview, then
// `convex deploy` builds again. The deploying machine therefore needs bun, a chromium for
// `@playwright/test` (`npx playwright install --with-deps chromium`) and this repository's
// node_modules. Without them the gate exits 2 and the deploy stops — which is the point.
// See docs/deployment.md §"Web and Convex deployment".
const commands = [
	['bash', ['bin/gate']],
	[
		'bun',
		[
			'x',
			'--no-install',
			'convex',
			'deploy',
			'--cmd',
			'bun run build',
			'--cmd-url-env-var-name',
			'PUBLIC_CONVEX_URL'
		]
	]
];
for (const [command, args] of commands) {
	if (process.argv.includes('--dry-run')) console.log(`${command} ${args.join(' ')}`);
	else {
		const result = spawnSync(command, args, { stdio: 'inherit' });
		if (result.status !== 0) process.exit(result.status ?? 1);
	}
}

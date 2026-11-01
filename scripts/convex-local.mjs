/**
 * The local Convex deployment this checkout is actually talking to.
 *
 * Ports are per-project, not global. The CLI allocates the first free pair from 3210 upwards,
 * so a checkout whose own backend lands on 3212 says nothing about what is listening on 3210 —
 * on a machine with several Convex projects that port belongs to somebody else entirely. The
 * port in `.convex/local/default/config.json` is the only thing that knows which one is ours.
 *
 * The deployment *name* is recorded next to it for the same reason: two projects can both
 * answer on some port, and the name is what proves whose answer it is.
 *
 * Node built-ins live here rather than in `src/convex/`, because that directory is bundled by
 * Convex and a `node:fs` import there would demand a `'use node'` action module. Both the
 * vitest config and `bin/gate` read this, so there is exactly one opinion about the port.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const CONFIG_PATH = path.join('.convex', 'local', 'default', 'config.json');

/**
 * `{ port, url, deploymentName }` for this checkout, or `null` when no local deployment was
 * ever started here (`npx convex dev` has not run in this directory).
 */
export function readLocalDeployment(read = readFileSync, configPath = CONFIG_PATH) {
	let parsed;
	try {
		parsed = JSON.parse(read(configPath, 'utf8'));
	} catch {
		// Absent, unreadable or malformed: no local deployment to speak of. That is a fact the
		// probe reports as "absent" rather than an error worth throwing over.
		return null;
	}
	const port = parsed?.ports?.cloud;
	const deploymentName = parsed?.deploymentName;
	if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
	if (typeof deploymentName !== 'string' || deploymentName === '') return null;
	return { port, url: `http://127.0.0.1:${port}`, deploymentName };
}

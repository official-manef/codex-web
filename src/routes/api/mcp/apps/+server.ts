import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { requireCapabilityAccess } from '$lib/server/access';
import { parseAppList } from '$lib/server/mcp_app_manifest';
import { logEvent } from '$lib/server/log';
import { defaultPolicy, parsePolicy } from '$lib/server/policy';
import { appAllowed, appAllowlist } from '$lib/server/mcp_app_gate';
import type { RequestHandler } from './$types';

/**
 * MCP_APPS_POLICY_JSON specifies per-verb policy for MCP apps, primarily `mcp_app`.
 * Malformed JSON falls back to `defaultPolicy()` (deny every verb).
 */
function appPolicy(source: { MCP_APPS_POLICY_JSON?: string }) {
	if (!source.MCP_APPS_POLICY_JSON) return defaultPolicy();
	try {
		return parsePolicy(JSON.parse(source.MCP_APPS_POLICY_JSON));
	} catch {
		return defaultPolicy();
	}
}

/**
 * The operator's app allowlist, and nothing else.
 *
 * `MCP_APPS_JSON` is a closed list: an app appears here only because an operator wrote it.
 * A malformed entry is dropped by `parseAppList` rather than failing the whole request —
 * one bad row must not hide the working ones, and it must not be silently repaired either,
 * so the log records how many entries survived.
 *
 * Apps are additionally gated through `appAllowed`, checking both `mcp_app` policy verb
 * permissions and `MCP_APPS_ALLOW` membership.
 *
 * Only the fields a frame needs are returned. Anything that could carry a credential in the
 * configured JSON (a token, a query string) is dropped by the parser before it reaches here.
 */
export const GET: RequestHandler = async (event) => {
	if (env.MCP_APPS_ENABLED !== 'true') error(404, 'MCP apps are disabled.');
	await requireCapabilityAccess(event);

	let raw: unknown = [];
	let configured = 0;
	if (env.MCP_APPS_JSON) {
		try {
			const parsed: unknown = JSON.parse(env.MCP_APPS_JSON);
			configured = Array.isArray(parsed) ? parsed.length : 0;
			raw = parsed;
		} catch {
			await logEvent('warn', 'mcp.apps', { outcome: 'invalid-json' });
			error(503, 'MCP_APPS_JSON is not valid JSON.');
		}
	}

	const apps = parseAppList(raw);
	const envSource = env as Record<string, string | undefined>;
	const policy = appPolicy(envSource);
	const allowlist = appAllowlist(envSource);

	const allowed = [];
	let blocked = 0;
	for (const app of apps) {
		const verdict = appAllowed(app.id, policy, allowlist);
		if (verdict.ok) {
			allowed.push(app);
		} else {
			blocked++;
		}
	}

	await logEvent('info', 'mcp.apps', {
		configured,
		accepted: allowed.length,
		blocked,
		outcome: 'ok'
	});
	return json({ apps: allowed, blocked }, { headers: { 'Cache-Control': 'no-store' } });
};

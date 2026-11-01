import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { requireCapabilityAccess } from '$lib/server/access';
import { parseAppList } from '$lib/server/mcp_app_manifest';
import { logEvent } from '$lib/server/log';
import type { RequestHandler } from './$types';

/**
 * The operator's app allowlist, and nothing else.
 *
 * `MCP_APPS_JSON` is a closed list: an app appears here only because an operator wrote it.
 * A malformed entry is dropped by `parseAppList` rather than failing the whole request —
 * one bad row must not hide the working ones, and it must not be silently repaired either,
 * so the log records how many entries survived.
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
	await logEvent('info', 'mcp.apps', {
		configured,
		accepted: apps.length,
		outcome: 'ok'
	});
	return json({ apps }, { headers: { 'Cache-Control': 'no-store' } });
};

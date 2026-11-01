import type { PolicyVerb, PolicyDecision } from './policy';

export type GateInput = {
	appId: string;
	policy: Record<PolicyVerb, PolicyDecision>;
	allowlist: string[];
};

export type GateVerdict = { ok: true } | { ok: false; reason: 'policy' | 'not-allowed' };

const APP_ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const MAX_ALLOWLIST = 20;

export function appAllowed(
	appId: string,
	policy: Record<PolicyVerb, PolicyDecision>,
	allowlist: string[]
): GateVerdict {
	if (!policy || policy.mcp_app !== 'allow') {
		return { ok: false, reason: 'policy' };
	}
	if (!allowlist || !allowlist.includes(appId)) {
		return { ok: false, reason: 'not-allowed' };
	}
	return { ok: true };
}

export function appAllowlist(env: { MCP_APPS_ALLOW?: string }): string[] {
	if (!env || typeof env.MCP_APPS_ALLOW !== 'string') {
		return [];
	}

	const raw = env.MCP_APPS_ALLOW.trim();
	if (!raw) {
		return [];
	}

	const result: string[] = [];
	const seen = new Set<string>();

	for (const chunk of env.MCP_APPS_ALLOW.split(',')) {
		const trimmed = chunk.trim();
		if (APP_ID_RE.test(trimmed) && !seen.has(trimmed)) {
			seen.add(trimmed);
			result.push(trimmed);
			if (result.length === MAX_ALLOWLIST) {
				break;
			}
		}
	}

	return result;
}

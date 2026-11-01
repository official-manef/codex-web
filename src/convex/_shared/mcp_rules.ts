/**
 * Validation rules for a user-owned MCP server, shared by the Convex actions and the tests.
 *
 * These mirror the operator allowlist in `src/lib/server/mcp/config.ts`, but Convex cannot
 * import SvelteKit server modules, so the rules live here instead of being duplicated inline.
 * Pure functions only: no network, no crypto, no environment.
 */

export const MAX_ALIAS = 40;
export const MAX_URL = 2048;
export const MAX_TOOLS = 128;
export const MAX_SECRET_CHARS = 16_384;
export const MAX_ARGUMENT_CHARS = 16_000;
export const MAX_RESULT_CHARS = 64_000;

const ALIAS = /^[a-z][a-z0-9-]{0,39}$/;
const TOOL = /^[A-Za-z0-9_.:-]{1,128}$/;
/** Query parameters that would carry a credential in the URL instead of a request header. */
const CREDENTIAL_PARAM = /token|secret|key|password|auth/i;
const IP_LITERAL = /^\d+(?:\.\d+){3}$/;
const LOCAL_HOST = /^(?:localhost|.*\.localhost|.*\.local)$/i;

/** Normalised alias, or null. Matches the operator config exactly. */
export function validAlias(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const alias = input.trim();
	return alias.length <= MAX_ALIAS && ALIAS.test(alias) ? alias : null;
}

/**
 * Normalised public HTTPS endpoint, or null.
 *
 * `new URL` normalises the host, so `https://0x7f.1`, `https://2130706433` and
 * `https://127.0.0.1` all reduce to an IPv4 literal before the check below.
 */
export function validPublicMcpUrl(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const text = input.trim();
	if (!text || text.length > MAX_URL) return null;
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:') return null;
	if (url.username || url.password) return null;
	if (url.hash) return null;
	// A trailing dot is the same DNS name: `localhost.` resolves to loopback exactly like
	// `localhost`. Strip it before the denylist runs, or the check is decorative.
	const host = url.hostname.replace(/\.$/, '');
	if (!host) return null;
	if (host.startsWith('[') || IP_LITERAL.test(host)) return null;
	if (LOCAL_HOST.test(host)) return null;
	for (const key of url.searchParams.keys()) if (CREDENTIAL_PARAM.test(key)) return null;
	return url.href;
}

/** Deduplicated allowlist, or null when it is empty, oversized or contains a bad name. */
export function validTools(input: unknown): string[] | null {
	if (!Array.isArray(input) || input.length < 1 || input.length > MAX_TOOLS) return null;
	const tools: string[] = [];
	for (const item of input) {
		if (typeof item !== 'string') return null;
		const name = item.trim();
		if (!TOOL.test(name)) return null;
		// A generic executor/router metatool would bypass the direct-tool allowlist.
		if (name.startsWith('COMPOSIO_')) return null;
		if (!tools.includes(name)) tools.push(name);
	}
	return tools.length ? tools : null;
}

/** A credential header value: non-empty printable ASCII, at most 16 KiB. */
export function validSecret(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	if (!input || input.length > MAX_SECRET_CHARS) return null;
	if (input !== input.trim()) return null;
	for (const char of input) {
		const code = char.codePointAt(0)!;
		if (code < 0x20 || code > 0x7e) return null;
	}
	return input;
}

/**
 * The exact JSON snapshot shown at confirmation and sent verbatim on the call.
 * Null when the value is not a plain object or exceeds 16 000 serialized characters.
 */
export function snapshotArguments(input: unknown): string | null {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
	let text: string;
	try {
		text = JSON.stringify(input);
	} catch {
		return null;
	}
	if (typeof text !== 'string' || text.length > MAX_ARGUMENT_CHARS) return null;
	return text;
}

/** Remove the credential and endpoint from text that came from a remote server. */
export function redactSecrets(text: string, secrets: string[]): string {
	return secrets
		.filter((secret) => secret.length > 0)
		.reduce((acc, secret) => acc.split(secret).join('[redacted]'), text);
}

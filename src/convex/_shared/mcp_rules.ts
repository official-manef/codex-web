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
/**
 * A dotted quad anywhere in the name is the address the resolver will hand back:
 * `127.0.0.1.nip.io` and `10-0-0-1.sslip.io` are loopback/RFC1918 by construction.
 */
const EMBEDDED_IPV4 = /(?:^|\.)\d{1,3}(?:\.\d{1,3}){3}(?:\.|$)/;
/** Wildcard resolvers that encode an arbitrary address in the name itself. */
const WILDCARD_RESOLVER =
	/^(?:.*\.)?(?:nip\.io|sslip\.io|xip\.io|traefik\.me|lvh\.me|vcap\.me|localtest\.me|local\.gd)$/i;

/**
 * True when an IPv4/IPv6 literal is routable on the public internet.
 *
 * Pure arithmetic on the text: no network, no `node:net`, so it runs in every Convex runtime.
 */
export function isPublicAddress(input: string): boolean {
	const address = input
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, '');
	const quad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
	if (quad) {
		const bytes = quad.slice(1, 5).map(Number);
		if (bytes.some((byte) => byte > 255)) return false;
		const [a, b] = bytes;
		return !(
			a === 0 ||
			a === 10 ||
			a === 127 ||
			a >= 224 ||
			(a === 100 && b >= 64 && b <= 127) || // carrier NAT
			(a === 169 && b === 254) || // link-local, includes 169.254.169.254 metadata
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 192 && b === 0) ||
			(a === 192 && b === 88) ||
			(a === 198 && (b === 18 || b === 19)) ||
			(a === 198 && b === 51) ||
			(a === 203 && b === 0)
		);
	}
	// IPv4 embedded in IPv6: mapped (`::ffff:7f00:1`) and NAT64 (`64:ff9b::7f00:1`).
	const trailing = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
	if (trailing) return isPublicAddress(trailing[1]);
	const mapped = /^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
	if (mapped) {
		const high = parseInt(mapped[1], 16);
		const low = parseInt(mapped[2], 16);
		return isPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
	}
	if (address === '::' || address === '::1') return false;
	if (/^f[cd]/.test(address)) return false; // fc00::/7 unique local
	if (/^fe[89ab]/.test(address)) return false; // fe80::/10 link-local
	if (/^ff/.test(address)) return false; // multicast
	if (/^2001:0?db8:/.test(address)) return false; // documentation
	return /^[0-9a-f:.]+$/.test(address) && address.includes(':');
}

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
 *
 * ponytail: shape-only, deliberately. This module must stay pure so the Convex runtime can run
 * it from mutations, and that runtime has no resolver (DNS lives behind `'use node'`, which
 * would make `mcp.ts` a Node module and drop its queries/mutations). So the deterministic
 * classes are refused here — literals, names with an embedded dotted quad, wildcard-resolver
 * suffixes — and the ceiling is a name that *does* resolve to a private address: only real
 * resolution can see it. Upgrade path: resolve in a `'use node'` action before `connect`, or
 * enforce outbound network policy at the deployment.
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
	// `127.0.0.1.nip.io` is loopback and `10.0.0.1.sslip.io` is RFC1918: the name *is* the
	// address. No DNS lookup is needed to know that, so this class is closed here.
	if (EMBEDDED_IPV4.test(host) || WILDCARD_RESOLVER.test(host)) return null;
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

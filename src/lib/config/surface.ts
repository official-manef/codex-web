/**
 * Which runtime this build runs on.
 *
 * `local` means the app is served from the user's own machine (or a private network), so a
 * feature can reach a local runtime. `cloud` means a hosted build, where machine-bound
 * tools only work once a device is paired. Pure: no runes, no DOM at import time.
 */
export type Surface = 'local' | 'cloud';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isPrivateIpv4(host: string): boolean {
	const parts = host.split('.');
	if (parts.length !== 4) return false;
	const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
	if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
	const [a, b] = octets;
	return (
		a === 10 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 169 && b === 254)
	);
}

/** Expand an IPv6 literal (brackets stripped) to eight 16-bit groups; null when malformed. */
function expandIpv6(input: string): number[] | null {
	let text = input.split('%')[0]?.toLowerCase() ?? '';
	const embedded = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
	if (embedded) {
		const octets = embedded[2].split('.').map(Number);
		if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
		text = `${embedded[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
	}
	const halves = text.split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	if (halves.length === 1 && head.length !== 8) return null;
	const missing = 8 - head.length - tail.length;
	if (missing < 0 || (halves.length === 2 && missing === 0)) return null;
	const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
	if (groups.length !== 8) return null;
	const parsed = groups.map((group) =>
		/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN
	);
	return parsed.some((group) => Number.isNaN(group)) ? null : parsed;
}

function isPrivateIpv6(host: string): boolean {
	const groups = expandIpv6(host);
	if (!groups) return false;
	// fc00::/7 unique-local, fe80::/10 link-local.
	return (groups[0] & 0xfe00) === 0xfc00 || (groups[0] & 0xffc0) === 0xfe80;
}

function isLocalHostname(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (!host) return false;
	if (LOOPBACK_HOSTS.has(host)) return true;
	if (host.endsWith('.local') || host.endsWith('.ts.net')) return true;
	if (host.startsWith('[') && host.endsWith(']')) {
		const inner = host.slice(1, -1);
		return inner === '::1' || isPrivateIpv6(inner);
	}
	return isPrivateIpv4(host);
}

/**
 * Resolve the surface from an explicit override or the page URL.
 * A null or unparsable URL is treated as `cloud`; this never throws.
 */
export function detectSurface(input: { url: string | null; override?: string | null }): Surface {
	if (input.override === 'local' || input.override === 'cloud') return input.override;
	if (!input.url) return 'cloud';
	try {
		return isLocalHostname(new URL(input.url).hostname) ? 'local' : 'cloud';
	} catch {
		return 'cloud';
	}
}

/** User-facing reason for the current surface, shown above the Tools toggles. */
export function surfaceReason(surface: Surface): string {
	return surface === 'cloud'
		? 'This build is served from a public host, so tools that need your own machine or a paired device stay hidden until you turn them on here.'
		: 'This build is served from a local address. A tool that needs a runtime still has none until one is configured; the switch only decides whether the tool appears.';
}

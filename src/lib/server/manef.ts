import { env } from '$env/dynamic/private';

/**
 * Server-side bridge to the MANEF AI local hub (`manef-ai/apps/hub`).
 *
 * The hub only answers loopback `Host` and same-origin `Origin`. A browser on the console
 * origin cannot satisfy that, so every call goes through this module and the SvelteKit
 * server connects to 127.0.0.1 itself. The incoming `Origin` is never forwarded.
 *
 * Loopback is enforced here, not just documented: this route must never become a general
 * fetcher. The hub owns product authority; this bridge adds no principal, scope or secret.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5_000;

export type HubResult = { ok: true; value: unknown } | { ok: false; status: number; code: string };

/** Parse `MANEF_HUB_URL`. Returns null for unset, non-HTTP or any non-loopback host. */
export function hubBase(value: string | undefined): URL | null {
	if (!value) return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) return null;
	if (url.username || url.password || url.search || url.hash) return null;
	if (url.pathname !== '/' && url.pathname !== '') return null;
	return url;
}

export function hubConfigured(value: string | undefined): boolean {
	return hubBase(value) !== null;
}

/**
 * Forward one path to the hub. `path` is chosen by a route handler, never by the caller, so an
 * absolute URL or authority cannot be smuggled in.
 */
/** Paths the bridge may request. Everything else is refused before a socket is opened. */
const FORWARDABLE = new Set(['/api/modules', '/api/plan', '/ready', '/health', '/api/example']);
export { FORWARDABLE };

export async function hubRequest(
	path: string,
	init: {
		method?: 'GET' | 'POST';
		body?: string;
		signal?: AbortSignal;
		/** Statuses that are a real answer, not a failure. `/ready` uses 503 by design. */
		accept?: readonly number[];
	} = {}
): Promise<HubResult> {
	const baseUrl = hubBase(env.MANEF_HUB_URL);
	if (!baseUrl) return { ok: false, status: 503, code: 'hub_unconfigured' };
	if (!FORWARDABLE.has(path) || path.includes('..') || path.includes('\\'))
		return { ok: false, status: 500, code: 'invalid_hub_path' };

	const signal = init.signal
		? AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT_MS)])
		: AbortSignal.timeout(TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetch(new URL(path, baseUrl), {
			method: init.method ?? 'GET',
			headers: init.body ? { 'content-type': 'application/json' } : {},
			body: init.body,
			redirect: 'error',
			cache: 'no-store',
			signal
		});
	} catch {
		return { ok: false, status: 503, code: 'hub_unreachable' };
	}

	// Bounded read: the hub never sends more, and a foreign listener must not be believed.
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_BYTES)
		return { ok: false, status: 502, code: 'hub_response_too_large' };
	let text: string;
	try {
		text = await response.text();
	} catch {
		return { ok: false, status: 502, code: 'hub_response_unreadable' };
	}
	if (new TextEncoder().encode(text).byteLength > MAX_BYTES)
		return { ok: false, status: 502, code: 'hub_response_too_large' };

	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { ok: false, status: 502, code: 'hub_response_invalid' };
	}
	if (!response.ok && !(init.accept ?? []).includes(response.status)) {
		const code =
			typeof value === 'object' && value !== null && 'error' in value
				? String((value as { error?: { code?: unknown } }).error?.code ?? 'hub_error')
				: 'hub_error';
		return { ok: false, status: response.status === 503 ? 503 : 502, code };
	}
	return { ok: true, value };
}

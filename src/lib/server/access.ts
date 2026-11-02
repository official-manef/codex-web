import { createHash, timingSafeEqual } from 'node:crypto';
import { error, isHttpError, type RequestEvent } from '@sveltejs/kit';
import { siteOrigin } from '$lib/config/metadata';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { readSession } from '$lib/server/auth/session';

export function matchesSecret(actual: string, expected: string): boolean {
	if (!actual || !expected) return false;
	return timingSafeEqual(
		createHash('sha256').update(actual).digest(),
		createHash('sha256').update(expected).digest()
	);
}

export function requireAppOrigin(request: Request, origin: string | undefined): void {
	if (!origin) error(503, 'Set the application origin before enabling this feature.');
	let expected: string;
	try {
		expected = siteOrigin(origin)!;
	} catch {
		error(503, 'The application origin is invalid.');
	}
	if (request.headers.get('origin') !== expected)
		error(403, 'This request must come from this application.');
}

// ponytail: per-process burst protection; use an edge/distributed limiter before scaling replicas.
const BURST_BUCKETS = 1024;
const buckets = new Map<string, { count: number; expires: number }>();
export function consumeBurst(key: string, now = Date.now()): void {
	for (const [id, bucket] of buckets) if (bucket.expires <= now) buckets.delete(id);
	const id = createHash('sha256').update(key).digest('hex');
	const bucket = buckets.get(id);
	if (bucket) {
		if (bucket.count >= 20) error(429, 'Too many requests. Try again in a minute.');
		bucket.count++;
		return;
	}
	// Evict the oldest bucket rather than refusing everyone: a full table once answered 503 for
	// every new caller, so one attacker filling it took the whole deployment down.
	if (buckets.size >= BURST_BUCKETS) {
		const oldest = buckets.keys().next().value;
		if (oldest !== undefined) buckets.delete(oldest);
	}
	buckets.set(id, { count: 1, expires: now + 60_000 });
}

/**
 * Which capability a route is asking about.
 *
 * `byok` is the AI surface (chat, BYOK config): on a deployment without sign-in it may be used
 * anonymously from this application's own origin, because the caller brings their own provider
 * key and there is no account to protect. Every other surface — git, MCP apps, the MANEF bridge,
 * remote tools, automations — reveals or mutates this machine, so it always needs an identity:
 * an operator bearer token or a signed-in session. There is deliberately no global
 * `ALLOW_ANONYMOUS_CAPABILITIES` switch: a deployment-wide flag is exactly the shape of the bug
 * it would reintroduce, where one surface's allowance covered routes that never asked for it.
 */
export type CapabilitySurface = 'byok';

/** `AUTH_ENABLED` is parsed once and strictly: anything else is operator error, not "off". */
function authEnabled(value: string | undefined): boolean {
	if (value === undefined || value === '' || value === 'false') return false;
	if (value === 'true') return true;
	error(503, 'AUTH_ENABLED must be true or false.');
}

export async function requireCapabilityAccess(
	event: RequestEvent,
	options: { surface?: CapabilitySurface } = {}
): Promise<void> {
	const enabled = authEnabled(env.AUTH_ENABLED);
	if (event.request.method !== 'GET') requireAppOrigin(event.request, publicEnv.PUBLIC_SITE_URL);
	const authorization = event.request.headers.get('authorization') ?? '';
	const configured = env.CAPABILITY_ACCESS_TOKEN;
	if (
		configured &&
		configured.length >= 32 &&
		matchesSecret(authorization, `Bearer ${configured}`)
	) {
		consumeBurst(`operator:${configured}`);
		return;
	}
	if (!enabled && !configured && options.surface === 'byok') {
		// No sign-in and no operator token: the BYOK surface is open to this application's own
		// origin only, burst-protected by client address. See `CapabilitySurface` above.
		//
		// A GET is the catalogue read (`/api/ai/config`), which costs a few hundred bytes and no
		// upstream call, and the shell asks for it on every surface it opens. Counting it against
		// the same 20/minute budget as a chat turn answered 429 after twenty screen switches.
		if (event.request.method !== 'GET') {
			const ip = (event.getClientAddress?.() ?? 'anonymous') || 'anonymous';
			consumeBurst(`anon:${ip}`);
		}
		return;
	}
	const session = await readSession(event);
	if (!session) error(401, 'Sign in or provide the application access token.');
	consumeBurst(`session:${session.tokenIdentifier}`);
}

export async function readJsonBody(request: Request, maxBytes = 65_536): Promise<unknown> {
	if (
		request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
	)
		error(415, 'Send application/json.');
	const length = request.headers.get('content-length');
	if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
		error(413, 'The request is too large.');
	if (!request.body) error(400, 'A JSON body is required.');
	const reader = request.body.getReader();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let size = 0;
	let text = '';
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		void reader.cancel().catch(() => undefined);
	}, 10_000);
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (timedOut) error(408, 'The request took too long.');
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel();
				error(413, 'The request is too large.');
			}
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		error(400, 'The request contains invalid JSON.');
	} finally {
		clearTimeout(timeout);
		reader.releaseLock();
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		error(400, 'The request contains invalid JSON.');
	}
}

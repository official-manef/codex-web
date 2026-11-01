/**
 * MCP App host pure protocol core and security boundary.
 *
 * This host runs untrusted third-party JS inside the app's page; the sandbox attribute plus the origin check are the containment, and a compromised guest can still cost CPU.
 * A per-app approval gate (`mcp_app` in `src/lib/server/policy.ts`) is the intended next fence and is not implemented here.
 */

export type HostToGuest =
	| { type: 'host:init'; appId: string; theme: 'light' | 'dark' }
	| { type: 'host:result'; requestId: string; ok: true; data: unknown }
	| { type: 'host:result'; requestId: string; ok: false; error: string };

export type GuestToHost =
	| { type: 'guest:ready'; appId: string }
	| { type: 'guest:call'; requestId: string; tool: string; args: Record<string, unknown> }
	| { type: 'guest:resize'; height: number };

export const MAX_MESSAGE_BYTES = 64_000;
export const MAX_REQUEST_ID_CHARS = 64;

/** Parse an untrusted inbound message. Returns null on anything unexpected. Never throws. */
export function parseGuestMessage(value: unknown): GuestToHost | null {
	if (value === null || value === undefined) return null;

	let raw: unknown = value;
	if (typeof value === 'string') {
		if (new TextEncoder().encode(value).length > MAX_MESSAGE_BYTES) {
			return null;
		}
		try {
			raw = JSON.parse(value);
		} catch {
			return null;
		}
	}

	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return null;
	}

	try {
		const serialized = JSON.stringify(raw);
		if (!serialized || new TextEncoder().encode(serialized).length > MAX_MESSAGE_BYTES) {
			return null;
		}
	} catch {
		return null;
	}

	const candidate = raw as Record<string, unknown>;
	if (typeof candidate.type !== 'string') {
		return null;
	}

	if (candidate.type === 'guest:ready') {
		if (
			typeof candidate.appId !== 'string' ||
			candidate.appId.length === 0 ||
			candidate.appId.length > 256
		) {
			return null;
		}
		return {
			type: 'guest:ready',
			appId: candidate.appId
		};
	}

	if (candidate.type === 'guest:call') {
		if (
			typeof candidate.requestId !== 'string' ||
			candidate.requestId.length < 1 ||
			candidate.requestId.length > MAX_REQUEST_ID_CHARS ||
			!/^[A-Za-z0-9_-]+$/.test(candidate.requestId)
		) {
			return null;
		}

		if (typeof candidate.tool !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/i.test(candidate.tool)) {
			return null;
		}

		if (
			!candidate.args ||
			typeof candidate.args !== 'object' ||
			Array.isArray(candidate.args) ||
			Object.prototype.toString.call(candidate.args) !== '[object Object]'
		) {
			return null;
		}

		if (Object.keys(candidate.args).length > 32) {
			return null;
		}

		return {
			type: 'guest:call',
			requestId: candidate.requestId,
			tool: candidate.tool,
			args: candidate.args as Record<string, unknown>
		};
	}

	if (candidate.type === 'guest:resize') {
		if (
			typeof candidate.height !== 'number' ||
			!Number.isFinite(candidate.height) ||
			candidate.height < 40 ||
			candidate.height > 2000
		) {
			return null;
		}

		return {
			type: 'guest:resize',
			height: candidate.height
		};
	}

	return null;
}

/** Build an outbound message; returns null when it would exceed the byte cap. */
export function hostMessage(message: HostToGuest): string | null {
	try {
		const serialized = JSON.stringify(message);
		if (!serialized) return null;
		if (new TextEncoder().encode(serialized).length > MAX_MESSAGE_BYTES) {
			return null;
		}
		return serialized;
	} catch {
		return null;
	}
}

/** Frame attributes for a given app origin — one place, so no component invents its own. */
export function framePolicy(appOrigin: string): {
	sandbox: string;
	allow: string;
	referrerPolicy: string;
} {
	if (typeof appOrigin !== 'string' || !appOrigin) {
		throw new Error('appOrigin must be a non-empty string');
	}

	let url: URL;
	try {
		url = new URL(appOrigin);
	} catch {
		throw new Error(`Invalid app origin: ${appOrigin}`);
	}

	if (url.protocol !== 'https:') {
		throw new Error(`appOrigin must use https: protocol, got ${url.protocol}`);
	}

	if (url.username || url.password) {
		throw new Error('appOrigin must not contain credentials');
	}

	if (url.pathname !== '' && url.pathname !== '/') {
		throw new Error('appOrigin must not contain a path');
	}

	if (url.search || url.hash) {
		throw new Error('appOrigin must not contain search or hash');
	}

	if (appOrigin.endsWith('/')) {
		throw new Error('appOrigin must not have a trailing slash');
	}

	if (url.origin !== appOrigin) {
		throw new Error(
			`appOrigin must be an exact origin, expected ${url.origin} but got ${appOrigin}`
		);
	}

	return {
		sandbox: 'allow-scripts',
		allow:
			"camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'",
		referrerPolicy: 'no-referrer'
	};
}

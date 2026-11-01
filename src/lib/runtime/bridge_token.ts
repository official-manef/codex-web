/**
 * Per-device bridge tokens, kept in this tab only.
 *
 * A pairing token is the user's own credential for a bridge they run; the app never receives
 * it. Losing it on every reload makes the flow unusable, so it is remembered per device — but
 * in `sessionStorage`, not `localStorage`. That survives a reload, dies when the tab closes,
 * and is never shared across tabs. It is a deliberate ceiling: anything persisted in a browser
 * is reachable by an XSS bug, so the exposure window is kept as small as the feature allows.
 *
 * Contract (all failures are silent and return "no token"):
 *   read(deviceId, storage?)   -> string  (empty when absent, foreign, oversized or corrupt)
 *   save(deviceId, token, storage?) -> boolean
 *   clear(deviceId, storage?)  -> void
 */
export type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIX = 'bridge-token:v1:';
const MAX_TOKEN_CHARS = 512;
// Same alphabet the WebSocket subprotocol allows (RFC 6455 tchar). Anything else would build a
// socket that `new WebSocket` throws on, so it is refused before it is stored.
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{8,512}$/;

function keyFor(deviceId: string): string | null {
	return /^[A-Za-z0-9_-]{1,128}$/.test(deviceId) ? PREFIX + deviceId : null;
}

function defaultStorage(): TokenStorage | undefined {
	try {
		return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
	} catch {
		// Storage can throw outright when blocked by policy or a partitioned context.
		return undefined;
	}
}

export function readBridgeToken(deviceId: string, storage?: TokenStorage): string {
	const key = keyFor(deviceId);
	if (!key) return '';
	try {
		const store = storage ?? defaultStorage();
		const raw = store?.getItem(key);
		if (!raw || raw.length > MAX_TOKEN_CHARS + 64) return '';
		const envelope = JSON.parse(raw);
		const value = envelope?.value;
		return envelope?.version === 1 && typeof value === 'string' && TOKEN_PATTERN.test(value)
			? value
			: '';
	} catch {
		return '';
	}
}

export function saveBridgeToken(deviceId: string, token: string, storage?: TokenStorage): boolean {
	const key = keyFor(deviceId);
	if (!key || !TOKEN_PATTERN.test(token)) return false;
	try {
		const store = storage ?? defaultStorage();
		if (!store) return false;
		store.setItem(key, JSON.stringify({ version: 1, value: token }));
		return true;
	} catch {
		return false;
	}
}

export function clearBridgeToken(deviceId: string, storage?: TokenStorage): void {
	const key = keyFor(deviceId);
	if (!key) return;
	try {
		(storage ?? defaultStorage())?.removeItem(key);
	} catch {
		// Nothing to restore; the row is already gone or the store is unreachable.
	}
}

/**
 * The SvelteKit BYOK route needs a provider key in the request body, so the key has to exist
 * in the tab while a turn is streaming. It is held here, in module scope, and nowhere else:
 *
 * - not `localStorage` — it would outlive the tab, and the docs promise it does not;
 * - not `sessionStorage` — a reload is not a reason to keep a credential around;
 * - never in a URL, never logged, never in a Convex write.
 *
 * The ceiling is honest: any script running in this tab can read a module variable. The
 * exposure window is bounded to the tab's lifetime and to the user pasting the key, which is
 * the smallest window this route allows. Users who want the key to leave the browser should
 * store it through the Convex path (`src/convex/credentials.ts`) instead.
 *
 * Contract (failures are silent and read as "no key"):
 *   read()        -> string  (empty when absent or not the shape the server accepts)
 *   save(value)   -> boolean (false when the value would be rejected by `parseChat`)
 *   clear()       -> void
 *   present()     -> boolean (never returns the value; for UI state only)
 */

// Same alphabet as `keySchema` in `src/lib/server/ai/config.ts`: printable, no spaces. Keeping
// the client check identical means the route is never called with a body it must reject.
const KEY_PATTERN = /^[!-~]{8,4096}$/;

let key = '';

export function readProviderKey(): string {
	return key;
}

export function saveProviderKey(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (!KEY_PATTERN.test(trimmed)) return false;
	key = trimmed;
	return true;
}

export function clearProviderKey(): void {
	key = '';
}

export function hasProviderKey(): boolean {
	return key.length > 0;
}

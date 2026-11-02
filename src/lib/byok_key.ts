/**
 * Where a provider key comes from on the SvelteKit chat path, and the only place that writes it.
 *
 * A key belongs to the tab that typed it. `sessionStorage` dies with the tab, is never shared with
 * another tab, and survives a reload — which the chat needs, because a reload mid-stream must keep
 * streaming with the same key rather than losing the credential and ending the turn as an error.
 * `localStorage` is not an option: a key left there survives the tab and the sign-out and is
 * readable by any script on this origin forever. The chat screen used to fall back to it, so a key
 * persisted by an older build was silently picked up and sent.
 *
 * There used to be two modules: this one held the key in a variable, `byok_input.ts` read a draft
 * from `sessionStorage`, and `Chat.svelte` saved through the first and read through the second.
 * Nothing ever wrote the draft, so the key a user pasted was never the key that got sent, and every
 * server turn failed with "holds no key for this tab". One module, one store, one direction.
 *
 * Contract: never reads `localStorage`, never puts the key in a URL, never logs it, returns "" when
 * absent. The storage ceiling is honest: any script in this tab can read it.
 */
import { readDraft, saveDraft } from '#lib/drafts.js';

export const PROVIDER_KEY_DRAFT = 'byok-key';

// Same alphabet as `keySchema` in `src/lib/server/ai/config.ts`: printable, no spaces. Keeping the
// client check identical means the route is never called with a body it must reject.
const KEY_PATTERN = /^[!-~]{8,4096}$/;

/** The key typed into this tab, or an empty string. Tab-scoped storage only. */
export function readProviderKey(): string {
	try {
		const value = readDraft<unknown>(PROVIDER_KEY_DRAFT, '');
		return typeof value === 'string' && KEY_PATTERN.test(value) ? value : '';
	} catch {
		return '';
	}
}

/** Stores the key for this tab. Returns false when the value would be rejected by `parseChat`. */
export function saveProviderKey(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (!KEY_PATTERN.test(trimmed)) return false;
	try {
		saveDraft(PROVIDER_KEY_DRAFT, trimmed);
	} catch {
		return false;
	}
	return true;
}

export function clearProviderKey(): void {
	try {
		saveDraft(PROVIDER_KEY_DRAFT, '');
	} catch {
		// Storage is unavailable; there is nothing held to clear.
	}
}

export function hasProviderKey(): boolean {
	return readProviderKey().length > 0;
}

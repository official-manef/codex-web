/**
 * Where a provider key comes from on the SvelteKit chat path.
 *
 * A key belongs to the tab that typed it. `sessionStorage` dies with the tab, is never shared
 * with another tab, and is the same ceiling the bridge token uses. `localStorage` is not an
 * option: a key left there survives the tab, survives the sign-out, and is readable by any
 * script on this origin forever. The chat screen used to fall back to it, so a key persisted by
 * an older build — or by anything else on the same origin — was silently picked up and sent.
 *
 * Contract: never reads `localStorage`, never puts the key in a URL, returns "" when absent.
 */
import { readDraft } from '#lib/drafts.js';

export const PROVIDER_KEY_DRAFT = 'byok-key';

/** The key typed into this tab, or an empty string. Tab-scoped storage only. */
export function readProviderKey(): string {
	try {
		const value = readDraft<unknown>(PROVIDER_KEY_DRAFT, '');
		return typeof value === 'string' ? value : '';
	} catch {
		return '';
	}
}

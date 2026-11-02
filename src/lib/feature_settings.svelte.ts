import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { detectSurface, type Surface } from '#lib/config/surface.js';
import {
	ALWAYS_ENABLED,
	FEATURE_ACCESS,
	defaultEnabled,
	isHiddenBySurface,
	resolveEnabled
} from '#lib/feature_access.js';
import {
	readVersioned,
	writeVersioned,
	type StorageLike,
	type VersionedSpec
} from '#lib/storage_version.js';

export const STORAGE_KEY = 'workspace-template:tools-v1';
export const MAX_STORED_BYTES = 8 * 1024;

/**
 * The build before the envelope wrote `{ version: 1, enabled: [...] }`. It is version 0 in the
 * shared scheme because it has no `value` field: reading it as an envelope would hand the view
 * `undefined` and silently reset every tool toggle. `writeVersioned` writes
 * `{ version: 1, value: [...] }` instead, so both readers and writers use one shape.
 */
function fromLegacy(parsed: unknown): unknown {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const shape = parsed as { enabled?: unknown };
	return Array.isArray(shape.enabled) ? shape.enabled : null;
}

function validate(value: unknown): { value: string[]; dropped: number } | null {
	if (!Array.isArray(value)) return null;
	const seen: string[] = [];
	const out: string[] = [];
	let dropped = 0;
	for (const id of value) {
		// An id this build no longer knows is not corruption: `resolveEnabled` decides what to do
		// with it, and dropping it here would rewrite the user's list on the next render.
		if (typeof id === 'string' && id && !seen.includes(id)) {
			seen.push(id);
			out.push(id);
		} else dropped += 1;
	}
	return { value: out, dropped };
}

const SPEC: VersionedSpec<string[]> = {
	key: STORAGE_KEY,
	current: 1,
	maxChars: MAX_STORED_BYTES,
	fromLegacy,
	validate
};

function storage(): StorageLike | undefined {
	if (!browser) return undefined;
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

function readStored(): string[] | null {
	const result = readVersioned(SPEC, storage);
	// A newer payload is left untouched and the defaults are used; the write path refuses the
	// same case, so an older build cannot erase a list it does not understand.
	if (result.status === 'newer') {
		quarantined = null;
		return null;
	}
	quarantined = result.quarantineKey;
	return result.value ?? null;
}

function writeStored(enabled: readonly string[]): void {
	writeVersioned(SPEC, [...enabled], storage);
}

/** Set when a payload this build could not read was copied aside. */
let quarantined: string | null = null;

/**
 * Per-feature tool visibility for this browser.
 *
 * Starts on the surface-neutral defaults so SSR and the first client render agree; the host
 * calls `start()` on mount, which resolves the real surface and the stored selection once. No
 * `window` access happens while the module is imported.
 */
export function createFeatureSettings() {
	let surface = $state<Surface>('cloud');
	let enabled = $state<string[]>(defaultEnabled('cloud'));
	let started = false;

	function commit(next: string[]): void {
		enabled = next;
		writeStored(next);
	}

	return {
		get surface(): Surface {
			return surface;
		},
		get enabled(): readonly string[] {
			return enabled;
		},
		/** Key holding a verbatim copy of a tools payload this build could not read, if any. */
		get quarantined(): string | null {
			return quarantined;
		},
		start(): void {
			if (started) return;
			started = true;
			surface = detectSurface({
				url: browser ? window.location.href : null,
				override: import.meta.env.PUBLIC_SURFACE ?? env.PUBLIC_SURFACE ?? null
			});
			commit(resolveEnabled(readStored(), surface));
		},
		isEnabled(id: string): boolean {
			return enabled.includes(id);
		},
		setEnabled(id: string, value: boolean): void {
			if (!Object.hasOwn(FEATURE_ACCESS, id)) return;
			if (!value && ALWAYS_ENABLED.includes(id)) return;
			if (enabled.includes(id) === value) return;
			commit(value ? [...enabled, id].sort() : enabled.filter((entry) => entry !== id));
		},
		reset(): void {
			commit(defaultEnabled(surface));
		},
		hidden(): readonly string[] {
			return Object.keys(FEATURE_ACCESS).filter(
				(id) => isHiddenBySurface(id, surface) && !enabled.includes(id)
			);
		}
	};
}

export const featureSettings = createFeatureSettings();

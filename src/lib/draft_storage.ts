/**
 * Minimal browser storage contract; callers may provide an in-memory adapter.
 */
import {
	QUARANTINE_SUFFIX,
	readVersioned,
	writeVersioned,
	type StorageLike,
	type VersionedSpec
} from '#lib/storage_version.js';

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Passive, versioned per-tab drafts. The owning product supplies a scope; a null scope disables
 * persistence until it has established the right context. Values are never interpreted as
 * instructions or automatically executed.
 *
 * Every key is one envelope (`{ version, value }`). A payload with no envelope is the version-0
 * value this store wrote before it had a version; a payload from a *newer* version is left
 * exactly as it is — a downgraded client reads its default and refuses to overwrite the newer
 * value. An unreadable payload is copied to `<key>:quarantine` instead of being replaced.
 */
export function createDraftStore(options: {
	prefix: () => string | null;
	defaultStorage: () => DraftStorage | undefined;
	maxChars: number;
	maxKeyChars: number;
}) {
	/** The version this store writes. */
	const CURRENT = 1;

	const status: { quarantined: string[]; newer: string[] } = { quarantined: [], newer: [] };

	function specFor(key: string): VersionedSpec<unknown> {
		return {
			key,
			current: CURRENT,
			maxChars: options.maxChars,
			// Version 0 is the bare value: no envelope, no wrapper, no migration needed. An object
			// that *looks* like a broken envelope is not a draft value, so it is quarantined rather
			// than handed to the view as `{ version: 1 }`.
			fromLegacy: (parsed) =>
				parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'version' in parsed
					? null
					: parsed,
			validate: (value) => ({ value, dropped: 0 })
		};
	}

	function target(storage?: DraftStorage): (() => StorageLike | undefined) {
		return () => storage ?? options.defaultStorage();
	}

	function scopeKey(key: string): string | null {
		try {
			const prefix = options.prefix();
			if (!prefix || key.length > options.maxKeyChars) return null;
			return prefix + key;
		} catch {
			return null;
		}
	}

	function read<T>(key: string, fallback: T, storage?: DraftStorage): T {
		try {
			const full = scopeKey(key);
			if (!full) return fallback;
			const result = readVersioned(specFor(full), target(storage));
			if (result.quarantineKey) status.quarantined = [...status.quarantined, result.quarantineKey];
			if (result.status === 'newer') {
				status.newer = [...status.newer, full];
				return fallback;
			}
			return result.status === 'ok' && result.value !== undefined ? (result.value as T) : fallback;
		} catch {
			return fallback;
		}
	}

	function save(key: string, value: unknown, storage?: DraftStorage): boolean {
		try {
			const full = scopeKey(key);
			if (!full) return false;
			const written = writeVersioned(specFor(full), value, target(storage));
			if (!written) status.newer = [...status.newer, full];
			return written;
		} catch {
			return false;
		}
	}

	function clear(key: string, storage?: DraftStorage): void {
		try {
			const full = scopeKey(key);
			if (full) (storage ?? options.defaultStorage())?.removeItem(full);
		} catch {
			// Unavailable storage cannot prevent clearing the visible draft.
		}
	}

	/** Which keys this tab found unreadable (`:quarantine` copy made) or too new to touch. */
	function report(): { quarantined: string[]; newer: string[] } {
		return { quarantined: [...status.quarantined], newer: [...status.newer] };
	}

	return { read, save, clear, report, quarantineSuffix: QUARANTINE_SUFFIX };
}

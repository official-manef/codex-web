/**
 * The remote-browser / desktop recording a panel reopens.
 *
 * Two scalars in `localStorage` (`laya-browser-rpa`, `laya-desktop-rpa`), because the run
 * outlives the tab. The previous build wrote the bare id with no JSON quoting, so a bare or
 * quoted id is read as version 0 and migrated once; a payload from a newer build is never
 * overwritten. An id is a pointer, not authority: the panel still asks the API whether the run
 * exists before showing anything.
 */
import {
	QUARANTINE_SUFFIX,
	readVersioned,
	writeVersioned,
	type StorageLike,
	type VersionedSpec
} from '#lib/storage_version.js';

/** Run ids are 24 hex characters; anything else is not one of ours. */
export const RUN_ID_PATTERN = /^[a-f0-9]{24}$/;

function storage(): StorageLike | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		// Private mode and blocked storage both throw on access.
		return undefined;
	}
}

function specFor(kind: 'browser' | 'desktop'): VersionedSpec<string> {
	return {
		key: `laya-${kind}-rpa`,
		current: 1,
		maxChars: 256,
		fromLegacy: (parsed) => (typeof parsed === 'string' ? parsed : null),
		// The old writer used `setItem(key, id)` with no quoting at all.
		fromLegacyText: (raw) => raw,
		validate: (value) =>
			typeof value === 'string' && RUN_ID_PATTERN.test(value) ? { value, dropped: 0 } : null
	};
}

export function storageKeyFor(kind: 'browser' | 'desktop'): string {
	return specFor(kind).key;
}

/** The remembered run id, or "" when there is none this build can use. */
export function readRunPointer(kind: 'browser' | 'desktop'): string {
	return readVersioned(specFor(kind), storage).value ?? '';
}

export function saveRunPointer(kind: 'browser' | 'desktop', id: string): boolean {
	if (!RUN_ID_PATTERN.test(id)) return false;
	return writeVersioned(specFor(kind), id, storage);
}

/** Forgets the pointer only when it still names `id`, so a newer run is never unpointed. */
export function clearRunPointer(kind: 'browser' | 'desktop', id: string): void {
	if (readRunPointer(kind) !== id) return;
	try {
		storage()?.removeItem(storageKeyFor(kind));
	} catch {
		// Deleting a recording does not require browser storage.
	}
}

export { QUARANTINE_SUFFIX };

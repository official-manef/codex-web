/**
 * The chat this browser reopens on load.
 *
 * One scalar, in `localStorage` because it is shared by every tab on this origin. It is the
 * only cross-tab pointer the app keeps, and a stale one used to open nothing (or throw), so it
 * carries the shared version envelope (`{ version, value }`, see `#lib/storage_version`) like
 * every other persisted key. A bare id — what every build before the envelope wrote, and what a
 * test seeds when it wants a specific chat opened — is read as version 0 and migrated once.
 *
 * An id is not a permission: the chat is opened only if the session store actually has it.
 */
import {
	readVersioned,
	writeVersioned,
	type StorageLike,
	type VersionedSpec
} from '#lib/storage_version.js';

export const ACTIVE_SESSION_KEY = 'laya-session';
/** Chat ids are short and bounded; anything else is not one of ours. */
const MAX_ID_CHARS = 128;

function storage(): StorageLike | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		// Private mode and blocked storage both throw on access.
		return undefined;
	}
}

function parseId(value: unknown): { value: string; dropped: number } | null {
	if (typeof value !== 'string' || value.length > MAX_ID_CHARS) return null;
	return { value, dropped: 0 };
}

const ACTIVE_SESSION_SPEC: VersionedSpec<string> = {
	key: ACTIVE_SESSION_KEY,
	current: 1,
	maxChars: 1024,
	// Older builds wrote the id bare, with no JSON quoting at all.
	fromLegacy: (parsed) => (typeof parsed === 'string' ? parsed : null),
	fromLegacyText: (raw) => raw,
	validate: parseId
};

/** The remembered chat id, or "" when there is none this build can use. */
export function readActiveSession(): string {
	return readVersioned(ACTIVE_SESSION_SPEC, storage).value ?? '';
}

export function saveActiveSession(id: string): boolean {
	return writeVersioned(ACTIVE_SESSION_SPEC, id, storage);
}

/**
 * One version field for the state this template keeps in browser storage.
 *
 * Every store here reads a key that any script, an older build, or a newer build can write.
 * Without a version the reader has to guess, and the next write replaces whatever it could not
 * recognise: the user's chats, notes or projects are gone with no message. The envelope is
 * `{ version, value }`; a payload with no envelope is legacy version 0.
 *
 * Policy, in order of what matters:
 *
 * - Nothing is deleted. A payload that cannot be read, or that loses rows to validation, is
 *   copied verbatim to `<key>:quarantine` (first copy wins, so an earlier rescue is never
 *   overwritten) and the read reports where it went.
 * - A payload from a *newer* version is reported as `newer` and is never written. A downgraded
 *   client keeps working from defaults and the newer data survives until the newer build reads
 *   it again. `writeVersioned` refuses the same case.
 * - An older payload is migrated forward once, then written back with a single `setItem` of the
 *   finished text. A failed write leaves the original bytes in place: nothing is half-written,
 *   and the next read retries the same migration from the same original.
 * - No function here throws into the UI. Every failure is a return value the caller can say
 *   out loud.
 */

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const QUARANTINE_SUFFIX = ':quarantine';

/** What validation makes of a payload: a usable value plus the rows it had to leave behind. */
export type Validated<T> = { value: T; dropped: number };

export type VersionedRead<T> = {
	status: 'ok' | 'empty' | 'newer' | 'quarantined';
	/** Present for `ok`, and for `quarantined` when part of the payload was still usable. */
	value?: T;
	/** Present for `newer`: the version the payload claims. */
	version?: number;
	/** True when this read wrote a migrated payload back. */
	migrated: boolean;
	/** Rows validation could not use. Above zero means a quarantine copy was made. */
	dropped: number;
	quarantineKey: string | null;
};

export type VersionedSpec<T> = {
	/** The key this store owns. Quarantine writes to `<key>:quarantine`. */
	key: string;
	/** The version this build writes. An envelope-less payload is legacy version 0. */
	current: number;
	/** Anything longer than this is not ours: quarantined rather than parsed. */
	maxChars?: number;
	/**
	 * Turns a legacy (version 0) payload into the *current* shape, or `null` when the payload is
	 * not ours at all. A build that bumps `current` extends this too, so a skipped upgrade never
	 * has to replay old steps: the legacy branch is always written against today's shape.
	 */
	fromLegacy: (parsed: unknown) => unknown;
	/**
	 * For legacy payloads that were never JSON — a bare id, a bare number. Called only when
	 * `JSON.parse` fails; returning `null` means the bytes are unreadable and get quarantined.
	 */
	fromLegacyText?: (raw: string) => unknown;
	/** `steps[n]` lifts a version-n *envelope* to version n+1. A missing step is a failure. */
	steps?: Record<number, (value: unknown) => unknown>;
	/** Accepts only what this build can render; runs after every migration. */
	validate: (value: unknown) => Validated<T> | null;
};

type StorageGetter = () => StorageLike | undefined;

function empty<T>(): VersionedRead<T> {
	return { status: 'empty', migrated: false, dropped: 0, quarantineKey: null };
}

function envelope(parsed: unknown): { version: number; value: unknown } | null {
	// Both fields are required. A pre-existing `{ version: 1, enabled: [...] }` payload is a
	// legacy shape of its own, not an envelope, and must not be read as `value: undefined`.
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	if (!Object.hasOwn(parsed, 'value')) return null;
	const row = parsed as { version?: unknown; value?: unknown };
	return typeof row.version === 'number' && Number.isFinite(row.version)
		? { version: row.version, value: row.value }
		: null;
}

/** Verbatim copy of unreadable bytes. Returns the key, or null when the copy failed. */
function quarantine(spec: { key: string }, raw: string, store: StorageLike): string | null {
	try {
		const key = spec.key + QUARANTINE_SUFFIX;
		if (store.getItem(key) === null) store.setItem(key, raw);
		return key;
	} catch {
		return null;
	}
}

function accepted<T>(spec: VersionedSpec<T>, value: unknown): Validated<T> | null {
	try {
		return spec.validate(value);
	} catch {
		return null;
	}
}

/** Runs the version steps, then validation. A throw or a missing step is a failure. */
function advance<T>(spec: VersionedSpec<T>, from: number, start: unknown): Validated<T> | null {
	if (!Number.isInteger(from) || from < 1 || from > spec.current) return null;
	if (from === spec.current) return accepted(spec, start);
	let value = start;
	for (let version = from; version < spec.current; version += 1) {
		const step = spec.steps?.[version];
		if (!step) return null;
		try {
			value = step(value);
		} catch {
			return null;
		}
	}
	return accepted(spec, value);
}

/** The version currently stored, or null when absent or unreadable. Used by write guards. */
export function storedVersion(spec: { key: string }, store?: StorageLike): number | null {
	try {
		const raw = store?.getItem(spec.key);
		if (!raw) return null;
		const found = envelope(JSON.parse(raw));
		return found ? found.version : 0;
	} catch {
		return null;
	}
}

/**
 * Read one key, migrating in place when the payload is older and refusing to touch it when it
 * is newer. Passing a getter keeps this module free of import-time `window` access.
 */
export function readVersioned<T>(
	spec: VersionedSpec<T>,
	getStorage: StorageGetter
): VersionedRead<T> {
	let store: StorageLike | undefined;
	let raw: string | null = null;
	try {
		store = getStorage();
		raw = store?.getItem(spec.key) ?? null;
	} catch {
		// Blocked or partitioned storage: nothing to read, nothing to protect.
		return empty();
	}
	if (!store || raw === null || raw === '') return empty();
	const target = store;

	const rescued = (): VersionedRead<T> => ({
		status: 'quarantined',
		migrated: false,
		dropped: 0,
		quarantineKey: quarantine(spec, raw ?? '', target)
	});

	if (spec.maxChars !== undefined && raw.length > spec.maxChars) return rescued();

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// A legacy payload was not always JSON: the chat pointer is a bare id. Only a spec that
		// declares `fromLegacyText` can read those bytes; every other store quarantines them.
		try {
			parsed = spec.fromLegacyText?.(raw) ?? null;
		} catch {
			parsed = null;
		}
		if (parsed === null) return rescued();
	}

	const found = envelope(parsed);
	if (found && found.version > spec.current)
		return {
			status: 'newer',
			version: found.version,
			migrated: false,
			dropped: 0,
			quarantineKey: null
		};

	let fromVersion: number;
	let result: Validated<T> | null;
	if (found) {
		fromVersion = found.version;
		result = advance(spec, found.version, found.value);
	} else {
		fromVersion = 0;
		let legacy: unknown;
		try {
			legacy = spec.fromLegacy(parsed);
		} catch {
			legacy = null;
		}
		// `null` from `fromLegacy` is the documented "this is not our payload" answer, so a
		// usable empty list has to come back as `[]` rather than as a missing value. The text
		// fallback already ran when `JSON.parse` failed.
		result = legacy === null ? null : accepted(spec, legacy);
	}

	if (!result) return rescued();

	// Rows validation could not use are preserved verbatim before anything is rewritten, so a
	// migration can carry forward the rows it understood without destroying the ones it did not.
	const quarantineKey = result.dropped > 0 ? quarantine(spec, raw, target) : null;
	const status = quarantineKey ? 'quarantined' : 'ok';
	if (fromVersion === spec.current)
		return { status, value: result.value, migrated: false, dropped: result.dropped, quarantineKey };

	// Older: one write of the finished text. A failure leaves `raw` untouched.
	const migrated = writeVersioned(spec, result.value, getStorage);
	return { status, value: result.value, migrated, dropped: result.dropped, quarantineKey };
}

/**
 * Write the current shape. Refuses, leaving the key untouched, when storage already holds a
 * newer version: a downgraded client must not overwrite what it cannot read.
 */
export function writeVersioned<T>(
	spec: VersionedSpec<T>,
	value: T,
	getStorage: StorageGetter
): boolean {
	try {
		const store = getStorage();
		if (!store) return false;
		const existing = storedVersion(spec, store);
		if (existing !== null && existing > spec.current) return false;
		const text = JSON.stringify({ version: spec.current, value });
		if (spec.maxChars !== undefined && text.length > spec.maxChars) return false;
		store.setItem(spec.key, text);
		return true;
	} catch {
		// Quota or private mode: the caller learns from the return value.
		return false;
	}
}

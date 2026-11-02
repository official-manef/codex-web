/**
 * Local-only memory notes for chat context.
 *
 * Storage is `localStorage` under `codex-web:memories:v1`, wrapped in the shared version
 * envelope (`{ version, value }`, see `#lib/storage_version`). The trailing `v1` in the key is
 * part of the key, not the schema version: renaming it would orphan every note already written,
 * so the envelope carries the version instead. A bare array — what every build before the
 * envelope wrote — is read as version 0 and migrated once.
 *
 * To protect storage quotas and prompt context bounds, memories are capped at MAX_MEMORIES
 * (50), each note is limited to MAX_TEXT_CHARS (400 characters), and prompt context blocks are
 * bounded by MAX_CONTEXT_CHARS (2000 characters).
 *
 * Shape validation on read drops corrupted or hand-edited rows from the view, but never from
 * the disk: the shared reader copies the original bytes to `<key>:quarantine` first. Storage
 * operations never throw.
 */

import {
	readVersioned,
	writeVersioned,
	type StorageLike,
	type VersionedSpec
} from '#lib/storage_version.js';

export type Memory = { id: string; text: string; createdAt: number };

export type MemoryStore = {
	all: () => Memory[];
	add: (text: string) => Memory | null;
	remove: (id: string) => boolean;
	clear: () => boolean;
	/** Bounded plain-text block for prompt context; empty when there is nothing to say. */
	context: (maxChars?: number) => string;
	/** What the last read found: an unreadable payload is preserved, and this says where. */
	status: () => MemoryStorageStatus;
};

export type MemoryStorageStatus = {
	newer: boolean;
	quarantined: string | null;
	dropped: number;
};

const MEMORIES_KEY = 'codex-web:memories:v1';

export const MAX_MEMORIES = 50;
export const MAX_TEXT_CHARS = 400;
export const MAX_CONTEXT_CHARS = 2000;

/** A note a person or agent can read back: trimmed, collapsed whitespace, bounded, never empty. */
export function cleanText(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const text = value.trim().replace(/\s+/g, ' ');
	if (!text || text.length > MAX_TEXT_CHARS) return null;
	return text;
}

function storage(): StorageLike | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		// Private mode and blocked storage both throw on access.
		return undefined;
	}
}

function newId(): string {
	return `memory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Shape validation on read. Storage is user-writable and may be stale from an older version,
 * so anything that does not match is left out of the view rather than trusted. The count of
 * those rows is what makes the reader preserve the original payload instead of overwriting it.
 */
export function parseMemories(value: unknown): { value: Memory[]; dropped: number } | null {
	if (!Array.isArray(value)) return null;
	const seen = new Set<string>();
	const out: Memory[] = [];
	let dropped = 0;
	for (const row of value) {
		if (!row || typeof row !== 'object') {
			dropped += 1;
			continue;
		}
		const { id, text, createdAt } = row as Partial<Memory>;
		const clean = cleanText(text);
		if (typeof id !== 'string' || !id || seen.has(id) || !clean) {
			dropped += 1;
			continue;
		}
		seen.add(id);
		out.push({
			id,
			text: clean,
			createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0
		});
		// Past the cap, the surplus rows are still valid notes, not corruption: they stay out of
		// the view but must not mark the payload as damaged.
		if (out.length === MAX_MEMORIES) break;
	}
	return { value: out, dropped };
}

/** `null` means "not a memory payload at all"; an empty list is a valid, empty payload. */
function fromLegacy(parsed: unknown): unknown {
	return Array.isArray(parsed) ? parsed : null;
}

export const MEMORIES_SPEC: VersionedSpec<Memory[]> = {
	key: MEMORIES_KEY,
	current: 1,
	maxChars: 200_000,
	fromLegacy,
	validate: parseMemories
};

export function createMemoryStore(
	options: { storage?: () => StorageLike | undefined } = {}
): MemoryStore {
	const store = options.storage ?? storage;
	const status: MemoryStorageStatus = { newer: false, quarantined: null, dropped: 0 };

	function read(): Memory[] {
		const result = readVersioned(MEMORIES_SPEC, store);
		status.newer = result.status === 'newer';
		status.quarantined = result.quarantineKey;
		status.dropped = result.dropped;
		return result.value ?? [];
	}

	function write(rows: Memory[]): boolean {
		return writeVersioned(MEMORIES_SPEC, rows, store);
	}

	return {
		all: read,
		status: () => ({ ...status }),
		add(text: string) {
			const clean = cleanText(text);
			if (!clean) return null;
			const rows = read();
			if (status.newer) return null;
			if (rows.length >= MAX_MEMORIES) return null;
			const memory: Memory = { id: newId(), text: clean, createdAt: Date.now() };
			return write([...rows, memory]) ? memory : null;
		},
		remove(id: string) {
			const rows = read();
			if (status.newer) return false;
			if (!rows.some((memory) => memory.id === id)) return false;
			return write(rows.filter((memory) => memory.id !== id));
		},
		clear() {
			read();
			if (status.newer) return false;
			return write([]);
		},
		context(maxChars = MAX_CONTEXT_CHARS) {
			if (typeof maxChars !== 'number' || Number.isNaN(maxChars) || maxChars <= 0) return '';
			const lines: string[] = [];
			let currentLen = 0;
			for (const memory of read()) {
				const clean = cleanText(memory?.text);
				if (!clean) continue;
				const line = `- ${clean}`;
				const addedLen = lines.length === 0 ? line.length : 1 + line.length;
				if (currentLen + addedLen > maxChars) break;
				lines.push(line);
				currentLen += addedLen;
			}
			return lines.join('\n');
		}
	};
}

export const memoryStore = createMemoryStore();

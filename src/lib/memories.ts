/**
 * Local-only memory notes for chat context.
 *
 * Storage is `localStorage` under `codex-web:memories:v1`. To protect storage quotas and
 * prompt context bounds, memories are capped at MAX_MEMORIES (50), each note is limited to
 * MAX_TEXT_CHARS (400 characters), and prompt context blocks are bounded by MAX_CONTEXT_CHARS
 * (2000 characters).
 *
 * Shape validation on read drops corrupted or hand-edited rows silently; storage operations
 * never throw.
 */

export type Memory = { id: string; text: string; createdAt: number };

export type MemoryStore = {
	all: () => Memory[];
	add: (text: string) => Memory | null;
	remove: (id: string) => boolean;
	clear: () => boolean;
	/** Bounded plain-text block for prompt context; empty when there is nothing to say. */
	context: (maxChars?: number) => string;
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

function storage(): Storage | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		// Private mode and blocked storage both throw on access.
		return undefined;
	}
}

function readJson<T>(key: string, fallback: T): T {
	try {
		const raw = storage()?.getItem(key);
		if (!raw || raw.length > 200_000) return fallback;
		const parsed: unknown = JSON.parse(raw);
		return parsed === null ? fallback : (parsed as T);
	} catch {
		return fallback;
	}
}

function writeJson(key: string, value: unknown): boolean {
	try {
		const target = storage();
		if (!target) return false;
		target.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		// Quota exhausted: the caller learns from the return value, nothing throws.
		return false;
	}
}

function newId(): string {
	return `memory-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Shape validation on read. Storage is user-writable and may be stale from an older version,
 * so anything that does not match is dropped rather than trusted.
 */
function parseMemories(value: unknown): Memory[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: Memory[] = [];
	for (const row of value) {
		if (!row || typeof row !== 'object') continue;
		const { id, text, createdAt } = row as Partial<Memory>;
		if (typeof id !== 'string' || !id || seen.has(id)) continue;
		const clean = cleanText(text);
		if (!clean) continue;
		seen.add(id);
		out.push({
			id,
			text: clean,
			createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0
		});
		if (out.length >= MAX_MEMORIES) break;
	}
	return out;
}

export function createMemoryStore(): MemoryStore {
	function all(): Memory[] {
		return parseMemories(readJson<unknown>(MEMORIES_KEY, []));
	}

	return {
		all,
		add(text) {
			const clean = cleanText(text);
			if (!clean) return null;
			const rows = all();
			if (rows.length >= MAX_MEMORIES) return null;
			const memory: Memory = { id: newId(), text: clean, createdAt: Date.now() };
			return writeJson(MEMORIES_KEY, [...rows, memory]) ? memory : null;
		},
		remove(id) {
			const rows = all();
			if (!rows.some((memory) => memory.id === id)) return false;
			const remaining = rows.filter((memory) => memory.id !== id);
			return writeJson(MEMORIES_KEY, remaining);
		},
		clear() {
			return writeJson(MEMORIES_KEY, []);
		},
		context(maxChars = MAX_CONTEXT_CHARS) {
			if (typeof maxChars !== 'number' || Number.isNaN(maxChars) || maxChars <= 0) return '';
			const rows = all();
			const lines: string[] = [];
			let currentLen = 0;
			for (const memory of rows) {
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

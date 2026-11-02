import { describe, expect, test } from 'vitest';
import { createMemoryStore, MAX_MEMORIES } from './memories';
import { createProjectStore } from './projects';
import { createDraftStore, type DraftStorage } from './draft_storage';
import {
	QUARANTINE_SUFFIX,
	readVersioned,
	writeVersioned,
	storedVersion,
	type VersionedSpec
} from './storage_version';
import { readActiveSession, saveActiveSession } from './active_session';
import { readRunPointer, saveRunPointer, RUN_ID_PATTERN } from './rpa_pointer';

/**
 * Every key this app persists is unversioned before this change, so an older or newer shape is
 * either dropped silently or bricks the screen. These cases pin the reader's answer down:
 * migrate forward once, refuse a newer payload without touching it, quarantine anything
 * unreadable, and never write a half-migrated value.
 */

class MapStorage implements DraftStorage {
	rows = new Map<string, string>();
	/** When set, every write throws exactly like a spent quota. */
	throwOnWrite = false;
	/** When set, the write that reaches this predicate throws. */
	failWhen: ((key: string, value: string) => boolean) | null = null;
	writes: Array<{ key: string; value: string }> = [];

	getItem(key: string) {
		return this.rows.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		if (this.throwOnWrite || this.failWhen?.(key, value))
			throw new DOMException('quota', 'QuotaExceededError');
		this.writes.push({ key, value });
		this.rows.set(key, value);
	}
	removeItem(key: string) {
		this.rows.delete(key);
	}
	seed(key: string, value: string) {
		this.rows.set(key, value);
	}
	raw(key: string) {
		return this.rows.get(key) ?? null;
	}
}

const PROJECTS_KEY = 'codex-web:projects:v1';
const MEMBERSHIP_KEY = 'codex-web:project-members:v1';
const MEMORIES_KEY = 'codex-web:memories:v1';

function memoryStoreOn(store: MapStorage) {
	return createMemoryStore({ storage: () => store });
}
function projectStoreOn(store: MapStorage) {
	return createProjectStore({ storage: () => store });
}
function draftStoreOn(store: MapStorage) {
	return createDraftStore({
		prefix: () => 'laya-draft-v1:',
		defaultStorage: () => store,
		maxChars: 500_000,
		maxKeyChars: 150
	});
}

describe('the version envelope', () => {
	const spec: VersionedSpec<{ n: number }> = {
		key: 'test:shape',
		current: 2,
		// Version 0 (no envelope) is the *current* shape; a v1 envelope used the old field name.
		fromLegacy: (parsed) =>
			parsed &&
			typeof parsed === 'object' &&
			!Array.isArray(parsed) &&
			typeof (parsed as { n?: unknown }).n === 'number'
				? { n: (parsed as { n: number }).n }
				: null,
		steps: { 1: (value) => ({ n: Number((value as { count?: unknown }).count ?? 0) }) },
		validate: (value) => {
			const row = value as { n?: unknown };
			return typeof row.n === 'number' && Number.isFinite(row.n)
				? { value: { n: row.n }, dropped: 0 }
				: null;
		}
	};

	test('a version-1 envelope is lifted by its step, not by the legacy branch', () => {
		const store = new MapStorage();
		store.seed(spec.key, JSON.stringify({ version: 1, value: { count: 12 } }));

		const read = readVersioned(spec, () => store);
		expect(read.status).toBe('ok');
		expect(read.migrated).toBe(true);
		expect(read.value).toEqual({ n: 12 });
		expect(JSON.parse(store.raw(spec.key)!)).toEqual({ version: 2, value: { n: 12 } });
	});

	test('a legacy payload is migrated once and written back as the current envelope', () => {
		const store = new MapStorage();
		store.seed(spec.key, JSON.stringify({ n: 7 }));

		const first = readVersioned(spec, () => store);
		expect(first.status).toBe('ok');
		expect(first.migrated).toBe(true);
		expect(first.value).toEqual({ n: 7 });
		expect(JSON.parse(store.raw(spec.key)!)).toEqual({ version: 2, value: { n: 7 } });

		// Reading again is a no-op: no second migration, no extra write.
		const writes = store.writes.length;
		const second = readVersioned(spec, () => store);
		expect(second.migrated).toBe(false);
		expect(second.value).toEqual({ n: 7 });
		expect(store.writes).toHaveLength(writes);
	});

	test('current → current is idempotent', () => {
		const store = new MapStorage();
		store.seed(spec.key, JSON.stringify({ version: 2, value: { n: 1 } }));
		const before = store.raw(spec.key);

		expect(readVersioned(spec, () => store).value).toEqual({ n: 1 });
		expect(store.raw(spec.key)).toBe(before);
		expect(store.writes).toHaveLength(0);
	});

	test('a newer payload is refused and left byte-identical', () => {
		const store = new MapStorage();
		const newer = JSON.stringify({ version: 99, value: { n: 1, future: 'field' } });
		store.seed(spec.key, newer);

		const read = readVersioned(spec, () => store);
		expect(read.status).toBe('newer');
		expect(read.version).toBe(99);
		expect(read.value).toBeUndefined();
		expect(store.raw(spec.key)).toBe(newer);

		// And the write path refuses too, so a downgraded client cannot erase it.
		expect(writeVersioned(spec, { n: 5 }, () => store)).toBe(false);
		expect(store.raw(spec.key)).toBe(newer);
	});

	test('unreadable bytes are copied to :quarantine and left in place', () => {
		const store = new MapStorage();
		store.seed(spec.key, 'not json at all');

		const read = readVersioned(spec, () => store);
		expect(read.status).toBe('quarantined');
		expect(read.quarantineKey).toBe(spec.key + QUARANTINE_SUFFIX);
		expect(store.raw(spec.key + QUARANTINE_SUFFIX)).toBe('not json at all');
		expect(store.raw(spec.key)).toBe('not json at all');
	});

	test('the first quarantine copy wins, so an earlier rescue is never overwritten', () => {
		const store = new MapStorage();
		store.seed(spec.key, 'first damage');
		readVersioned(spec, () => store);
		store.seed(spec.key, 'second damage');
		readVersioned(spec, () => store);
		expect(store.raw(spec.key + QUARANTINE_SUFFIX)).toBe('first damage');
	});

	test('a migration that fails partway leaves the original readable', () => {
		const store = new MapStorage();
		const original = JSON.stringify({ version: 1, value: { count: 3 } });
		store.seed(spec.key, original);
		// The migration itself succeeds; the *write* is what fails, exactly like a spent quota.
		store.failWhen = (key) => key === spec.key;

		const read = readVersioned(spec, () => store);
		expect(read.status).toBe('ok');
		expect(read.migrated).toBe(false);
		expect(read.value).toEqual({ n: 3 });
		// Nothing was half-written: the original bytes are still the whole payload.
		expect(store.raw(spec.key)).toBe(original);
		expect(JSON.parse(store.raw(spec.key)!)).toEqual({ version: 1, value: { count: 3 } });
	});

	test('a spec with no step for the stored version is a refusal, not a throw', () => {
		const store = new MapStorage();
		const stuck: VersionedSpec<{ n: number }> = { ...spec, steps: {} };
		store.seed(spec.key, JSON.stringify({ version: 1, value: { count: 1 } }));
		const read = readVersioned(stuck, () => store);
		expect(read.status).toBe('quarantined');
		expect(store.raw(spec.key + QUARANTINE_SUFFIX)).toBeTypeOf('string');
	});

	test('validation is a trust boundary: a throw inside it never reaches the caller', () => {
		const store = new MapStorage();
		store.seed(spec.key, JSON.stringify([1, 2, 3]));
		const hostile: VersionedSpec<{ n: number }> = {
			...spec,
			fromLegacy: () => ({ n: 1 }),
			validate: () => {
				throw new Error('boom');
			}
		};
		expect(() => readVersioned(hostile, () => store)).not.toThrow();
		expect(readVersioned(hostile, () => store).status).toBe('quarantined');
	});

	test('storage that throws on read or write is an empty, silent result', () => {
		const broken: DraftStorage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {}
		};
		expect(readVersioned(spec, () => broken).status).toBe('empty');
		expect(writeVersioned(spec, { n: 1 }, () => broken)).toBe(false);
		expect(storedVersion(spec, broken)).toBeNull();
	});
});

describe('memory notes (codex-web:memories:v1)', () => {
	test('a legacy bare array is migrated to the envelope and read back', () => {
		const store = new MapStorage();
		store.seed(MEMORIES_KEY, JSON.stringify([{ id: 'm1', text: 'keep me', createdAt: 1 }]));
		expect(memoryStoreOn(store).all()).toHaveLength(1);
		expect(JSON.parse(store.raw(MEMORIES_KEY)!)).toEqual({
			version: 1,
			value: [{ id: 'm1', text: 'keep me', createdAt: 1 }]
		});
	});

	test('the memory cap is still enforced and the surplus is not called corruption', () => {
		const store = new MapStorage();
		const rows = Array.from({ length: MAX_MEMORIES + 5 }, (_, index) => ({
			id: `m${index}`,
			text: `note ${index}`,
			createdAt: index
		}));
		store.seed(MEMORIES_KEY, JSON.stringify(rows));
		const read = memoryStoreOn(store).all();
		expect(read).toHaveLength(MAX_MEMORIES);
		// Past the cap the rows are valid, so no quarantine copy is made on their account.
		expect(store.raw(MEMORIES_KEY + QUARANTINE_SUFFIX)).toBeNull();
	});
});

describe('projects and membership', () => {
	test('legacy arrays and maps are migrated to the envelope', () => {
		const store = new MapStorage();
		store.seed(PROJECTS_KEY, JSON.stringify([{ id: 'p1', name: 'Work', createdAt: 2 }]));
		store.seed(MEMBERSHIP_KEY, JSON.stringify({ s1: 'p1' }));

		const projects = projectStoreOn(store);
		expect(projects.projects()).toEqual([{ id: 'p1', name: 'Work', createdAt: 2 }]);
		expect(projects.membership()).toEqual({ s1: 'p1' });
		expect(JSON.parse(store.raw(PROJECTS_KEY)!)).toEqual({
			version: 1,
			value: [{ id: 'p1', name: 'Work', createdAt: 2 }]
		});
		expect(JSON.parse(store.raw(MEMBERSHIP_KEY)!)).toEqual({ version: 1, value: { s1: 'p1' } });
	});

	test('a newer project payload is never overwritten by a create', () => {
		const store = new MapStorage();
		const newer = JSON.stringify({ version: 4, value: [{ id: 'future', name: 'From 4.x' }] });
		store.seed(PROJECTS_KEY, newer);

		const projects = projectStoreOn(store);
		expect(projects.projects()).toEqual([]);
		expect(projects.status().newer).toBe(true);
		expect(projects.create('Mine')).toBeNull();
		expect(store.raw(PROJECTS_KEY)).toBe(newer);
	});

	test('a hand-edited row is quarantined while the good rows still load', () => {
		const store = new MapStorage();
		const payload = JSON.stringify([
			{ id: 'p1', name: 'Good', createdAt: 1 },
			{ id: 'p2', name: '   ', createdAt: 2 }
		]);
		store.seed(PROJECTS_KEY, payload);

		const projects = projectStoreOn(store);
		expect(projects.projects()).toEqual([{ id: 'p1', name: 'Good', createdAt: 1 }]);
		expect(projects.status().quarantined).toContain(PROJECTS_KEY + QUARANTINE_SUFFIX);
		expect(store.raw(PROJECTS_KEY + QUARANTINE_SUFFIX)).toBe(payload);
	});
});

describe('per-tab drafts (laya-draft-v1:)', () => {
	test('a bare version-0 draft is migrated, then read without rewriting', () => {
		const store = new MapStorage();
		store.seed('laya-draft-v1:chat:s1', JSON.stringify({ content: 'draft', attachments: [] }));

		const drafts = draftStoreOn(store);
		expect(drafts.read('chat:s1', null)).toEqual({ content: 'draft', attachments: [] });
		expect(JSON.parse(store.raw('laya-draft-v1:chat:s1')!)).toEqual({
			version: 1,
			value: { content: 'draft', attachments: [] }
		});

		const writes = store.writes.length;
		drafts.read('chat:s1', null);
		expect(store.writes).toHaveLength(writes);
	});

	test('a newer draft is reported and never overwritten', () => {
		const store = new MapStorage();
		const newer = JSON.stringify({ version: 9, value: { content: 'from the future' } });
		store.seed('laya-draft-v1:chat:s1', newer);
		const drafts = draftStoreOn(store);

		expect(drafts.read('chat:s1', 'fallback')).toBe('fallback');
		expect(drafts.save('chat:s1', { content: 'mine' })).toBe(false);
		expect(store.raw('laya-draft-v1:chat:s1')).toBe(newer);
		expect(drafts.report().newer).toContain('laya-draft-v1:chat:s1');
	});

	test('a corrupt draft is quarantined and the tab still opens', () => {
		const store = new MapStorage();
		store.seed('laya-draft-v1:chat:s1', '{"version":1,"value":{');
		const drafts = draftStoreOn(store);
		expect(drafts.read('chat:s1', { content: '' })).toEqual({ content: '' });
		expect(store.raw('laya-draft-v1:chat:s1' + QUARANTINE_SUFFIX)).toBe('{"version":1,"value":{');
	});
});

describe('the remembered chat (laya-session)', () => {
	function withLocal(store: MapStorage): () => void {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
		return () => {
			if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
			else delete (globalThis as { localStorage?: unknown }).localStorage;
		};
	}

	test('a bare id written by an older build is migrated once', () => {
		const store = new MapStorage();
		store.seed('laya-session', 'session-abc-1');
		const restore = withLocal(store);
		try {
			expect(readActiveSession()).toBe('session-abc-1');
			expect(JSON.parse(store.raw('laya-session')!)).toEqual({
				version: 1,
				value: 'session-abc-1'
			});
		} finally {
			restore();
		}
	});

	test('a quoted id also reads, because JSON.stringify wrote one shape and not the other', () => {
		const store = new MapStorage();
		store.seed('laya-session', '"session-abc-2"');
		const restore = withLocal(store);
		try {
			expect(readActiveSession()).toBe('session-abc-2');
		} finally {
			restore();
		}
	});

	test('a newer pointer is not overwritten by this build', () => {
		const store = new MapStorage();
		const newer = JSON.stringify({ version: 7, value: 'session-from-7' });
		store.seed('laya-session', newer);
		const restore = withLocal(store);
		try {
			expect(readActiveSession()).toBe('');
			expect(saveActiveSession('session-mine')).toBe(false);
			expect(store.raw('laya-session')).toBe(newer);
		} finally {
			restore();
		}
	});
});

describe('the recording pointer (laya-browser-rpa / laya-desktop-rpa)', () => {
	function withLocal(store: MapStorage): () => void {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
		Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
		return () => {
			if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
			else delete (globalThis as { localStorage?: unknown }).localStorage;
		};
	}

	test('a bare run id is migrated and a non-id is quarantined', () => {
		const store = new MapStorage();
		const id = 'a'.repeat(24);
		store.seed('laya-browser-rpa', id);
		const restore = withLocal(store);
		try {
			expect(readRunPointer('browser')).toBe(id);
			expect(JSON.parse(store.raw('laya-browser-rpa')!)).toEqual({ version: 1, value: id });

			store.seed('laya-desktop-rpa', 'not-a-run-id');
			expect(readRunPointer('desktop')).toBe('');
			expect(store.raw('laya-desktop-rpa' + QUARANTINE_SUFFIX)).toBe('not-a-run-id');
		} finally {
			restore();
		}
	});

	test('a save refuses an id the socket could not use', () => {
		const store = new MapStorage();
		const restore = withLocal(store);
		try {
			expect(saveRunPointer('browser', 'short')).toBe(false);
			expect(store.raw('laya-browser-rpa')).toBeNull();
			expect(saveRunPointer('browser', 'b'.repeat(24))).toBe(true);
			expect(RUN_ID_PATTERN.test('b'.repeat(24))).toBe(true);
		} finally {
			restore();
		}
	});
});

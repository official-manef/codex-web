import { describe, expect, it } from 'vitest';
import { clearSessionDrafts, pruneSessionDrafts } from './drafts';

/**
 * The per-chat draft keys are the one thing in this app that grew without a bound: measured on
 * the built preview, 30 create/delete cycles left 30 `chat-mode:` keys and took the
 * sessionStorage key count from 6 to 36. These are the guards against it coming back.
 */

const PREFIX = 'laya-draft-v1:';

function fakeStorage(rows: Record<string, string>) {
	const map = new Map(Object.entries(rows));
	return {
		get length() {
			return map.size;
		},
		key: (i: number) => [...map.keys()][i] ?? null,
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		removeItem: (k: string) => void map.delete(k),
		keys: () => [...map.keys()].sort()
	};
}

/** Run `fn` with a fake `window.sessionStorage`; `drafts.ts` reads only those two things. */
function withFakeStorage<T>(
	rows: Record<string, string>,
	fn: (storage: ReturnType<typeof fakeStorage>) => T
): T {
	const storage = fakeStorage(rows);
	const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { sessionStorage: storage }
	});
	try {
		return fn(storage);
	} finally {
		if (original) Object.defineProperty(globalThis, 'window', original);
		else delete (globalThis as { window?: unknown }).window;
	}
}

describe('pruneSessionDrafts', () => {
	it('removes every per-chat key whose chat is gone, and nothing else', () => {
		const rows: Record<string, string> = {
			[`${PREFIX}chat:session-live`]: '{"version":1,"value":{"content":"keep"}}',
			[`${PREFIX}chat-mode:session-live`]: '{"version":1,"value":"chat"}',
			[`${PREFIX}chat-scroll:session-live`]: '{"version":1,"value":0}',
			[`${PREFIX}chat:session-gone`]: '{"version":1,"value":{"content":"drop"}}',
			[`${PREFIX}chat-mode:session-gone`]: '{"version":1,"value":"work"}',
			[`${PREFIX}chat-scroll:session-gone`]: '{"version":1,"value":120}',
			// Not keyed by chat id, so never swept.
			[`${PREFIX}pinned-sessions`]: '{"version":1,"value":[]}',
			[`${PREFIX}workspace-layout`]: '{"version":1,"value":{}}',
			'workspace-template:sessions': '[]'
		};
		const removed = withFakeStorage(rows, (storage) => {
			const n = pruneSessionDrafts(['session-live']);
			return { n, keys: storage.keys() };
		});
		expect(removed.n).toBe(3);
		expect(removed.keys).toEqual(
			[
				'workspace-template:sessions',
				`${PREFIX}chat-mode:session-live`,
				`${PREFIX}chat-scroll:session-live`,
				`${PREFIX}chat:session-live`,
				`${PREFIX}pinned-sessions`,
				`${PREFIX}workspace-layout`
			].sort()
		);
	});

	it('treats everything after the first colon as the id, not as a new prefix', () => {
		const rows: Record<string, string> = {
			[`${PREFIX}chat-mode:session-a:b`]: '{"version":1,"value":"chat"}'
		};
		// That key belongs to chat `session-a:b`, which is not live, so it is an orphan.
		const keys = withFakeStorage(rows, (storage) => {
			pruneSessionDrafts([]);
			return storage.keys();
		});
		expect(keys).toEqual([]);
	});

	it('reports nothing removed when every chat still exists', () => {
		const rows: Record<string, string> = {
			[`${PREFIX}chat:session-live`]: '{"version":1,"value":{}}',
			[`${PREFIX}chat-mode:session-live`]: '{"version":1,"value":"chat"}'
		};
		const out = withFakeStorage(rows, (storage) => {
			const n = pruneSessionDrafts(['session-live']);
			return { n, keys: storage.keys() };
		});
		expect(out.n).toBe(0);
		expect(out.keys).toHaveLength(2);
	});
});

describe('clearSessionDrafts', () => {
	it('drops all three per-chat keys, not just the draft body', () => {
		const rows: Record<string, string> = {
			[`${PREFIX}chat:x`]: 'a',
			[`${PREFIX}chat-mode:x`]: 'b',
			[`${PREFIX}chat-scroll:x`]: 'c',
			[`${PREFIX}pinned-sessions`]: 'd'
		};
		const keys = withFakeStorage(rows, (storage) => {
			clearSessionDrafts('x');
			return storage.keys();
		});
		expect(keys).toEqual([`${PREFIX}pinned-sessions`]);
	});
});

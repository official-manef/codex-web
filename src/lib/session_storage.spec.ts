import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * The in-browser session store is the only persistence the chat has, and it reads a key any
 * script (or an older build) can write. These cases pin down what happens when the stored value
 * is not what this build wrote.
 *
 * `src/lib/http.local.ts` captures `sessions` at import time, so each case installs a storage
 * stub and then imports a fresh module instance.
 */

type Store = Map<string, string>;

function stubStorage(
	initial: Record<string, string> = {},
	options: { throwOnWrite?: boolean } = {}
) {
	const map: Store = new Map(Object.entries(initial));
	const storage = {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => {
			if (options.throwOnWrite) throw new DOMException('quota', 'QuotaExceededError');
			map.set(key, value);
		},
		removeItem: (key: string) => void map.delete(key),
		clear: () => map.clear(),
		key: (index: number) => [...map.keys()][index] ?? null,
		get length() {
			return map.size;
		}
	};
	vi.stubGlobal('sessionStorage', storage);
	return map;
}

async function freshApi() {
	vi.resetModules();
	return await import('./http.local');
}

const SESSIONS_KEY = 'workspace-template:sessions';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('session storage that this build did not write', () => {
	test('a null row is dropped instead of poisoning initialize', async () => {
		stubStorage({ [SESSIONS_KEY]: '[null]' });
		const api = await freshApi();
		const listed = await api.api.sessions();
		expect(listed.sessions).toEqual([]);
		// Creating a chat must work: the defect was that `sessions[0].id` threw and left the
		// composer disabled with no route back.
		const created = await api.api.sessionCreate({});
		expect(created.session.id).toEqual(expect.any(String));
	});

	test('a row from an older schema is kept, with the missing fields defaulted', async () => {
		stubStorage({
			[SESSIONS_KEY]: JSON.stringify([{ id: 'legacy', title: 'old schema', created_at: 5 }])
		});
		const api = await freshApi();
		const { sessions } = await api.api.sessions();
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({ id: 'legacy', title: 'old schema', turns: 0 });
		const read = await api.api.sessionRead('legacy');
		expect(read.session.turns).toEqual([]);
		expect(read.session.settings).toEqual({});
		expect(read.session.updated_at).toBe(5);
	});

	test('turns: null and junk rows inside turns are dropped, the chat still opens', async () => {
		stubStorage({
			[SESSIONS_KEY]: JSON.stringify([
				{
					id: 'a',
					title: 't',
					turns: [null, 7, { id: 'keep', content: 'hi', replies: [] }],
					settings: {},
					tool_events: [],
					created_at: 1,
					updated_at: 1
				}
			])
		});
		const api = await freshApi();
		const read = await api.api.sessionRead('a');
		expect(read.session.turns).toHaveLength(1);
		expect(read.session.turns[0].id).toBe('keep');
	});

	test('corrupt JSON and a non-array root both fall back to an empty store', async () => {
		stubStorage({ [SESSIONS_KEY]: '{"not":' });
		let api = await freshApi();
		expect((await api.api.sessions()).sessions).toEqual([]);

		stubStorage({ [SESSIONS_KEY]: '{"sessions":[]}' });
		api = await freshApi();
		expect((await api.api.sessions()).sessions).toEqual([]);
	});

	test('a reply written through sessionUpdate survives a reload', async () => {
		stubStorage();
		let api = await freshApi();
		const created = await api.api.sessionCreate({});
		const id = created.session.id;
		const turn = {
			id: 'turn-1',
			content: 'hello',
			attachments: [],
			status: 'done',
			created_at: 1,
			replies: [{ text: 'world', model_id: 'm', model_label: 'm', device: 'BYOK', ms: 1 }]
		};
		await api.api.sessionUpdate(id, { title: 'hello', turns: [turn] });

		// `turns` used to be ignored here, so every BYOK and cloud reply lived only in memory.
		api = await freshApi();
		const read = await api.api.sessionRead(id);
		expect(read.session.title).toBe('hello');
		expect(read.session.turns).toHaveLength(1);
		expect(read.session.turns[0].replies[0].text).toBe('world');
	});
});

describe('a storage quota that is already spent', () => {
	test('a failed write is reported rather than silently dropped', async () => {
		const map = stubStorage({}, { throwOnWrite: true });
		const api = await freshApi();
		const created = await api.api.sessionCreate({});
		// The live chat works...
		expect(created.session.turns).toEqual([]);
		// ...and the list says it was not written.
		const listed = await api.api.sessions();
		expect(listed.storage).toEqual({ persisted: false, dropped: 0 });
		expect(map.has(SESSIONS_KEY)).toBe(false);
	});

	test('a successful write clears the warning', async () => {
		const map = stubStorage({});
		const api = await freshApi();
		await api.api.sessionCreate({});
		const listed = await api.api.sessions();
		expect(listed.storage).toEqual({ persisted: true, dropped: 0 });
		expect(map.has(SESSIONS_KEY)).toBe(true);
	});
});

describe('the 50-chat write cap', () => {
	test('past the cap the oldest chats are reported as dropped, not silently lost', async () => {
		stubStorage();
		const api = await freshApi();
		for (let index = 0; index < 53; index += 1) await api.api.sessionCreate({});
		const listed = await api.api.sessions();
		expect(listed.sessions).toHaveLength(53);
		expect(listed.storage.dropped).toBe(3);
		const stored = JSON.parse(globalThis.sessionStorage.getItem(SESSIONS_KEY) ?? '[]');
		expect(stored).toHaveLength(50);
	});
});

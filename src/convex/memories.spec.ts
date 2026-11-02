import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

const modules = import.meta.glob('./**/*.ts');

const ALICE = { subject: 'alice', tokenIdentifier: 'https://issuer|alice' };
const BOB = { subject: 'bob', tokenIdentifier: 'https://issuer|bob' };

describe('anonymous caller', () => {
	test('refused on every public memory and project function', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);

		const memoryId = await asAlice.mutation(api.memories.add, { text: 'test memory' });
		const projectId = await asAlice.mutation(api.projects.create, { name: 'test project' });

		await expect(t.query(api.memories.list, {})).rejects.toThrow();
		await expect(t.mutation(api.memories.add, { text: 'anonymous' })).rejects.toThrow();
		await expect(t.mutation(api.memories.remove, { id: memoryId })).rejects.toThrow();
		await expect(t.mutation(api.memories.clear, {})).rejects.toThrow();

		await expect(t.query(api.projects.list, {})).rejects.toThrow();
		await expect(t.mutation(api.projects.create, { name: 'anon project' })).rejects.toThrow();
		await expect(
			t.mutation(api.projects.rename, { id: projectId, name: 'new name' })
		).rejects.toThrow();
		await expect(t.mutation(api.projects.remove, { id: projectId })).rejects.toThrow();
		await expect(t.mutation(api.projects.assign, { projectId, sessionId: 's1' })).rejects.toThrow();
		await expect(t.query(api.projects.ofSession, { sessionId: 's1' })).rejects.toThrow();
	});
});

describe('owner isolation', () => {
	test("one owner cannot read or remove another owner's memories", async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const asBob = t.withIdentity(BOB);

		const aliceMemId = await asAlice.mutation(api.memories.add, { text: 'Alice note' });

		const bobList = await asBob.query(api.memories.list, {});
		expect(bobList).toHaveLength(0);

		await expect(asBob.mutation(api.memories.remove, { id: aliceMemId })).rejects.toThrow();

		const aliceList = await asAlice.query(api.memories.list, {});
		expect(aliceList).toHaveLength(1);
		expect(aliceList[0].text).toBe('Alice note');

		await asBob.mutation(api.memories.clear, {});
		const aliceListAfterClear = await asAlice.query(api.memories.list, {});
		expect(aliceListAfterClear).toHaveLength(1);
	});

	test("one owner cannot read, rename, remove or assign another owner's projects", async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const asBob = t.withIdentity(BOB);

		const aliceProjId = await asAlice.mutation(api.projects.create, { name: 'Alice project' });
		await asAlice.mutation(api.projects.assign, {
			projectId: aliceProjId,
			sessionId: 'shared-session'
		});

		const bobProjects = await asBob.query(api.projects.list, {});
		expect(bobProjects).toHaveLength(0);

		await expect(
			asBob.mutation(api.projects.rename, { id: aliceProjId, name: 'Hacked' })
		).rejects.toThrow();
		await expect(asBob.mutation(api.projects.remove, { id: aliceProjId })).rejects.toThrow();
		await expect(
			asBob.mutation(api.projects.assign, { projectId: aliceProjId, sessionId: 'bob-session' })
		).rejects.toThrow();

		const bobOfSession = await asBob.query(api.projects.ofSession, { sessionId: 'shared-session' });
		expect(bobOfSession).toBeNull();

		const aliceOfSession = await asAlice.query(api.projects.ofSession, {
			sessionId: 'shared-session'
		});
		expect(aliceOfSession?.name).toBe('Alice project');
	});
});

describe('limits and validation', () => {
	test('memory 400-char and empty text limits', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);

		await expect(asAlice.mutation(api.memories.add, { text: '' })).rejects.toThrow();
		await expect(asAlice.mutation(api.memories.add, { text: '   \n  ' })).rejects.toThrow();
		await expect(asAlice.mutation(api.memories.add, { text: 'a'.repeat(401) })).rejects.toThrow();

		const validId = await asAlice.mutation(api.memories.add, { text: 'a'.repeat(400) });
		expect(validId).toBeDefined();
	});

	test('memory 50-row limit is enforced per owner', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const asBob = t.withIdentity(BOB);

		for (let i = 0; i < 50; i++) {
			await asAlice.mutation(api.memories.add, { text: `Memory ${i}` });
		}

		await expect(
			asAlice.mutation(api.memories.add, { text: 'Memory 50 overflow' })
		).rejects.toThrow();

		const bobMemId = await asBob.mutation(api.memories.add, { text: 'Bob note' });
		expect(bobMemId).toBeDefined();
	});

	test('project 50-row limit is enforced per owner', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);

		for (let i = 0; i < 50; i++) {
			await asAlice.mutation(api.projects.create, { name: `Project ${i}` });
		}

		await expect(
			asAlice.mutation(api.projects.create, { name: 'Overflow project' })
		).rejects.toThrow();
	});

	test('project rename and create name rules (1-60 chars, trimmed and collapsed)', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);

		await expect(asAlice.mutation(api.projects.create, { name: '' })).rejects.toThrow();
		await expect(asAlice.mutation(api.projects.create, { name: '   ' })).rejects.toThrow();
		await expect(asAlice.mutation(api.projects.create, { name: 'p'.repeat(61) })).rejects.toThrow();

		const projId = await asAlice.mutation(api.projects.create, { name: 'Valid Project' });

		await expect(asAlice.mutation(api.projects.rename, { id: projId, name: '' })).rejects.toThrow();
		await expect(
			asAlice.mutation(api.projects.rename, { id: projId, name: '    ' })
		).rejects.toThrow();
		await expect(
			asAlice.mutation(api.projects.rename, { id: projId, name: 'x'.repeat(61) })
		).rejects.toThrow();

		await asAlice.mutation(api.projects.rename, { id: projId, name: 'Renamed   With   Spaces' });
		const list = await asAlice.query(api.projects.list, {});
		expect(list[0].name).toBe('Renamed With Spaces');
	});
});

describe('project assignment and deletion', () => {
	test('remove drops its projectChats rows', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);

		const projId = await asAlice.mutation(api.projects.create, { name: 'Target Project' });
		await asAlice.mutation(api.projects.assign, { projectId: projId, sessionId: 'session-1' });
		await asAlice.mutation(api.projects.assign, { projectId: projId, sessionId: 'session-2' });

		const check1 = await asAlice.query(api.projects.ofSession, { sessionId: 'session-1' });
		expect(check1?._id).toBe(projId);

		await asAlice.mutation(api.projects.remove, { id: projId });

		const list = await asAlice.query(api.projects.list, {});
		expect(list).toHaveLength(0);

		const after1 = await asAlice.query(api.projects.ofSession, { sessionId: 'session-1' });
		expect(after1).toBeNull();
		const after2 = await asAlice.query(api.projects.ofSession, { sessionId: 'session-2' });
		expect(after2).toBeNull();
	});

	test('assign with a foreign project id is refused and unassigning works', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const asBob = t.withIdentity(BOB);

		const aliceProjId = await asAlice.mutation(api.projects.create, { name: 'Alice Proj' });

		await expect(
			asBob.mutation(api.projects.assign, { projectId: aliceProjId, sessionId: 's1' })
		).rejects.toThrow();

		await asAlice.mutation(api.projects.assign, { projectId: aliceProjId, sessionId: 's1' });
		const assigned = await asAlice.query(api.projects.ofSession, { sessionId: 's1' });
		expect(assigned?._id).toBe(aliceProjId);

		await asAlice.mutation(api.projects.assign, { projectId: null, sessionId: 's1' });
		const unassigned = await asAlice.query(api.projects.ofSession, { sessionId: 's1' });
		expect(unassigned).toBeNull();
	});
});

describe('project detail round-trip', () => {
	test('create -> setDetail({files}) -> list returns the file labels', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);

		const id = await asAlice.mutation(api.projects.create, {
			name: 'Docs',
			instructions: 'Be brief.'
		});
		const files = [
			{ path: 'src/index.ts', bytes: 120 },
			{ path: 'docs/README.md', bytes: 40 }
		];
		await asAlice.mutation(api.projects.setDetail, { id, instructions: 'Be brief.', files });

		// The view reads `p.files` off the list row and never issues a second query, so a list
		// that drops the field shows an empty file list forever.
		const [project] = await asAlice.query(api.projects.list, {});
		expect(project.files).toEqual(files);
		expect(project.instructions).toBe('Be brief.');

		// ofSession is the other projection of the same row and must agree with list.
		await asAlice.mutation(api.projects.assign, { projectId: id, sessionId: 's-1' });
		expect((await asAlice.query(api.projects.ofSession, { sessionId: 's-1' }))?.files).toEqual(
			files
		);
	});

	test('a project with no detail omits files rather than returning null', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.mutation(api.projects.create, { name: 'Bare' });
		const [project] = await asAlice.query(api.projects.list, {});
		expect(project).not.toHaveProperty('files');
	});

	test('sessionId is bounded, so an oversized reference is refused', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const id = await asAlice.mutation(api.projects.create, { name: 'P' });
		await expect(
			asAlice.mutation(api.projects.assign, { projectId: id, sessionId: 's'.repeat(201) })
		).rejects.toThrow('200');
		expect(await t.run(async (ctx) => await ctx.db.query('projectChats').collect())).toEqual([]);
	});
});

describe('touch internal mutation', () => {
	test('touch caps at 50 ids', async () => {
		const t = convexTest(schema, modules);
		const ids: Array<Id<'memories'>> = [];

		await t.run(async (ctx) => {
			for (let i = 0; i < 55; i++) {
				const id = await ctx.db.insert('memories', {
					owner: ALICE.tokenIdentifier,
					text: `Note ${i}`,
					createdAt: Date.now() - (55 - i) * 1000
				});
				ids.push(id);
			}
		});

		expect(ids).toHaveLength(55);

		await t.mutation(internal.memories.touch, { owner: ALICE.tokenIdentifier, ids });

		await t.run(async (ctx) => {
			for (let i = 0; i < 50; i++) {
				const row = await ctx.db.get('memories', ids[i]);
				expect(row?.usedAt).toBeDefined();
				expect(typeof row?.usedAt).toBe('number');
			}
			for (let i = 50; i < 55; i++) {
				const row = await ctx.db.get('memories', ids[i]);
				expect(row?.usedAt).toBeUndefined();
			}
		});
	});

	test("touch never marks another owner's memory as used", async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const asBob = t.withIdentity(BOB);
		const aliceId = await asAlice.mutation(api.memories.add, { text: 'Alice note' });
		const bobId = await asBob.mutation(api.memories.add, { text: 'Bob note' });

		// A raw id is not authority: before the owner check, whoever held the id could stamp
		// usedAt on a stranger's note, which is a write across the tenant boundary.
		await t.mutation(internal.memories.touch, {
			owner: BOB.tokenIdentifier,
			ids: [aliceId, bobId]
		});

		const rows = await t.run(async (ctx) => await ctx.db.query('memories').collect());
		expect(rows.find((row) => row._id === aliceId)?.usedAt).toBeUndefined();
		expect(rows.find((row) => row._id === bobId)?.usedAt).toEqual(expect.any(Number));
	});
});

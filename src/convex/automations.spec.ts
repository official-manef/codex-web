import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');

const ALICE = { subject: 'alice', tokenIdentifier: 'https://issuer|alice' };
const BOB = { subject: 'bob', tokenIdentifier: 'https://issuer|bob' };

describe('automations: auth and permissions', () => {
	test('anonymous caller is refused across all public endpoints', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const id = await asAlice.mutation(api.automations.create, {
			prompt: 'Sample task',
			intervalMinutes: 15
		});

		await expect(t.query(api.automations.list, {})).rejects.toThrow();
		await expect(
			t.mutation(api.automations.create, {
				prompt: 'Anon task',
				intervalMinutes: 15
			})
		).rejects.toThrow();
		await expect(
			t.mutation(api.automations.setEnabled, {
				id,
				enabled: false
			})
		).rejects.toThrow();
		await expect(t.mutation(api.automations.remove, { id })).rejects.toThrow();
	});

	test('cross-owner read and remove are refused', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const asBob = t.withIdentity(BOB);

		const aliceId = await asAlice.mutation(api.automations.create, {
			prompt: "Alice's secret automation",
			intervalMinutes: 30
		});

		// Bob cannot see Alice's automation in list
		const bobList = await asBob.query(api.automations.list, {});
		expect(bobList).toHaveLength(0);

		// Bob cannot remove Alice's automation
		await expect(asBob.mutation(api.automations.remove, { id: aliceId })).rejects.toThrow();

		// Bob cannot toggle Alice's automation
		await expect(
			asBob.mutation(api.automations.setEnabled, { id: aliceId, enabled: false })
		).rejects.toThrow();

		// Alice still owns and sees it
		const aliceList = await asAlice.query(api.automations.list, {});
		expect(aliceList).toHaveLength(1);
		expect(aliceList[0]._id).toBe(aliceId);
	});
});

describe('automations: limits and validation', () => {
	test('21st automation is refused by quota enforcement', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);

		for (let i = 0; i < 20; i++) {
			await asAlice.mutation(api.automations.create, {
				prompt: `Task #${i + 1}`,
				intervalMinutes: 15
			});
		}

		const list = await asAlice.query(api.automations.list, {});
		expect(list).toHaveLength(20);

		await expect(
			asAlice.mutation(api.automations.create, {
				prompt: 'Task #21',
				intervalMinutes: 15
			})
		).rejects.toThrow();
	});

	test('invalid interval is refused', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);

		await expect(
			asAlice.mutation(api.automations.create, {
				prompt: 'Valid prompt',
				intervalMinutes: 10
			})
		).rejects.toThrow();

		await expect(
			asAlice.mutation(api.automations.create, {
				prompt: 'Valid prompt',
				intervalMinutes: 20
			})
		).rejects.toThrow();

		await expect(
			asAlice.mutation(api.automations.create, {
				prompt: 'Valid prompt',
				intervalMinutes: 0
			})
		).rejects.toThrow();
	});

	test('invalid prompt length is refused', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);

		await expect(
			asAlice.mutation(api.automations.create, {
				prompt: '   ',
				intervalMinutes: 15
			})
		).rejects.toThrow();

		await expect(
			asAlice.mutation(api.automations.create, {
				prompt: 'a'.repeat(4001),
				intervalMinutes: 15
			})
		).rejects.toThrow();
	});
});

describe('automations: run recording and circuit breaker', () => {
	test('recordRun with failures disables at 3', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);

		const id = await asAlice.mutation(api.automations.create, {
			prompt: 'Fragile job',
			intervalMinutes: 15
		});

		// First failure
		await t.mutation(internal.automations.recordRun, {
			id,
			success: false,
			ranAt: 10_000
		});
		let row = await t.run(async (ctx) => ctx.db.get('automations', id));
		expect(row?.failureCount).toBe(1);
		expect(row?.enabled).toBe(true);
		expect(row?.lastRunAt).toBe(10_000);
		expect(row?.nextRunAt).toBe(10_000 + 15 * 60_000);

		// Second failure
		await t.mutation(internal.automations.recordRun, {
			id,
			success: false,
			ranAt: 20_000
		});
		row = await t.run(async (ctx) => ctx.db.get('automations', id));
		expect(row?.failureCount).toBe(2);
		expect(row?.enabled).toBe(true);
		expect(row?.lastRunAt).toBe(20_000);

		// Third failure -> should disable at 3
		await t.mutation(internal.automations.recordRun, {
			id,
			success: false,
			ranAt: 30_000
		});
		row = await t.run(async (ctx) => ctx.db.get('automations', id));
		expect(row?.failureCount).toBe(3);
		expect(row?.enabled).toBe(false);
		expect(row?.lastRunAt).toBe(30_000);

		// Enabling resets failureCount to 0
		await asAlice.mutation(api.automations.setEnabled, { id, enabled: true });
		row = await t.run(async (ctx) => ctx.db.get('automations', id));
		expect(row?.failureCount).toBe(0);
		expect(row?.enabled).toBe(true);

		// Successful run keeps failureCount at 0 and advances nextRunAt
		await t.mutation(internal.automations.recordRun, {
			id,
			success: true,
			ranAt: 40_000
		});
		row = await t.run(async (ctx) => ctx.db.get('automations', id));
		expect(row?.failureCount).toBe(0);
		expect(row?.enabled).toBe(true);
		expect(row?.lastRunAt).toBe(40_000);
		expect(row?.nextRunAt).toBe(40_000 + 15 * 60_000);
	});
});

describe('automations: due query', () => {
	test('due only returns enabled rows past their time', async () => {
		const t = convexTest(schema, modules);

		// Seed directly with distinct timestamps and states
		const idPast = await t.run(async (ctx) =>
			ctx.db.insert('automations', {
				owner: ALICE.tokenIdentifier,
				prompt: 'Due job',
				intervalMinutes: 15,
				nextRunAt: 1000,
				enabled: true,
				failureCount: 0
			})
		);

		const idFuture = await t.run(async (ctx) =>
			ctx.db.insert('automations', {
				owner: ALICE.tokenIdentifier,
				prompt: 'Future job',
				intervalMinutes: 30,
				nextRunAt: 5000,
				enabled: true,
				failureCount: 0
			})
		);

		const idDisabled = await t.run(async (ctx) =>
			ctx.db.insert('automations', {
				owner: ALICE.tokenIdentifier,
				prompt: 'Disabled past job',
				intervalMinutes: 60,
				nextRunAt: 800,
				enabled: false,
				failureCount: 3
			})
		);

		// At t = 2000: only idPast is due (1000 <= 2000, enabled)
		const dueAt2000 = await t.query(internal.automations.due, { now: 2000 });
		expect(dueAt2000.map((d) => d._id)).toEqual([idPast]);

		// At t = 6000: idPast (1000 <= 6000) and idFuture (5000 <= 6000) are due; idDisabled is excluded
		const dueAt6000 = await t.query(internal.automations.due, { now: 6000 });
		const idsAt6000 = dueAt6000.map((d) => d._id);
		expect(idsAt6000).toContain(idPast);
		expect(idsAt6000).toContain(idFuture);
		expect(idsAt6000).not.toContain(idDisabled);
	});
});

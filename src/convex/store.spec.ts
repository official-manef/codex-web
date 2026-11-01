/**
 * The write path, with an identity.
 *
 * `convex-test` runs the real functions against an in-memory deployment and can present a
 * signed-in user, which is the only way to prove owner scoping without a live Google session.
 */
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

// convex-test loads modules by path; the glob must cover every file the functions touch.
const modules = import.meta.glob('./**/*.ts');

const ALICE = { subject: 'alice', tokenIdentifier: 'https://issuer|alice' };
const BOB = { subject: 'bob', tokenIdentifier: 'https://issuer|bob' };

describe('devices', () => {
	test('a signed-in owner registers a device and sees it in their own list', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);

		await asAlice.mutation(api.devices.register, {
			name: 'my laptop',
			kind: 'terminal',
			tokenHash: 'a'.repeat(64),
			endpoint: 'http://127.0.0.1:8649'
		});

		const rows = await asAlice.query(api.devices.list, {});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ name: 'my laptop', endpoint: 'http://127.0.0.1:8649' });

		// The stored row really belongs to Alice's tokenIdentifier, not to a display name.
		const stored = await t.run(async (ctx) => await ctx.db.query('devices').collect());
		expect(stored).toHaveLength(1);
		expect(stored[0].owner).toBe(ALICE.tokenIdentifier);
	});
});

describe('auth boundary', () => {
	test('an anonymous caller cannot register', async () => {
		const t = convexTest(schema, modules);
		await expect(
			t.mutation(api.devices.register, {
				name: 'x',
				kind: 'terminal',
				tokenHash: 'b'.repeat(64)
			})
		).rejects.toThrow();
	});

	test("one owner cannot read another owner's devices", async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const asBob = t.withIdentity(BOB);

		await asAlice.mutation(api.devices.register, {
			name: 'alice-only',
			kind: 'terminal',
			tokenHash: 'c'.repeat(64)
		});

		const bobRows = await asBob.query(api.devices.list, {});
		expect(bobRows).toHaveLength(0);
	});

	test('a malformed token hash is rejected before it reaches the table', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await expect(
			asAlice.mutation(api.devices.register, {
				name: 'bad',
				kind: 'terminal',
				tokenHash: 'not-a-sha256'
			})
		).rejects.toThrow();
	});
});

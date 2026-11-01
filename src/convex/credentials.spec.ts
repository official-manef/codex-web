/**
 * BYOK model credentials: owner scoping, the at-rest secret and endpoint pinning.
 *
 * `convex-test` runs the real functions against an in-memory deployment. Nothing here reaches
 * a provider: no test calls the chat action, only the store around it.
 */
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');

const ALICE = { subject: 'alice', tokenIdentifier: 'https://issuer|alice' };
const BOB = { subject: 'bob', tokenIdentifier: 'https://issuer|bob' };
const MASTER = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));

beforeEach(() => {
	process.env.MODELS_ENC_KEY = MASTER;
});
afterEach(() => {
	delete process.env.MODELS_ENC_KEY;
});

const cred = { provider: 'openai', apiKey: 'sk-abcdef123456' };

describe('connect', () => {
	test('stores the key encrypted and never returns it', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		expect(await asAlice.action(api.credentials.connect, cred)).toEqual({
			provider: 'openai',
			ok: true
		});

		const rows = await t.run(async (ctx) => await ctx.db.query('modelCreds').collect());
		expect(rows).toHaveLength(1);
		expect(rows[0].ciphertext).not.toContain(cred.apiKey);
		expect(rows[0].owner).toBe(ALICE.tokenIdentifier);
		expect(rows[0].kind).toBe('api_key');

		// The public read path has no ciphertext field at all.
		const listed = await asAlice.query(api.credentials.listProviders, {});
		expect(listed).toEqual([
			{ provider: 'openai', kind: 'api_key', updatedAt: expect.any(Number) }
		]);
		expect(JSON.stringify(listed)).not.toContain(cred.apiKey);
	});

	test('re-connecting the same provider replaces the row instead of adding one', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.credentials.connect, cred);
		await asAlice.action(api.credentials.connect, { ...cred, apiKey: 'sk-rotated999999' });
		const rows = await t.run(async (ctx) => await ctx.db.query('modelCreds').collect());
		expect(rows).toHaveLength(1);
	});

	test('rejects a bad provider slug, a non-ASCII key, an oversized key and an empty key', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const cases: Array<[Partial<typeof cred>, string]> = [
			[{ provider: 'OpenAI' }, 'lowercase'],
			[{ provider: '-leading' }, 'lowercase'],
			[{ provider: 'a'.repeat(65) }, 'lowercase'],
			[{ apiKey: '' }, 'empty'],
			[{ apiKey: 'has space' }, 'printable ASCII'],
			[{ apiKey: 'has\ttab' }, 'printable ASCII'],
			[{ apiKey: 'unicode-é' }, 'printable ASCII'],
			[{ apiKey: 'k'.repeat(16_385) }, 'too long']
		];
		for (const [patch, message] of cases)
			await expect(asAlice.action(api.credentials.connect, { ...cred, ...patch })).rejects.toThrow(
				message
			);
		expect(await t.run(async (ctx) => await ctx.db.query('modelCreds').collect())).toEqual([]);
	});

	test('a custom endpoint must be HTTPS and carry no credentials', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await expect(
			asAlice.action(api.credentials.connect, { ...cred, endpoint: 'http://proxy.example/v1' })
		).rejects.toThrow('HTTPS');
		await expect(
			asAlice.action(api.credentials.connect, {
				...cred,
				endpoint: 'https://user:pass@proxy.example/v1'
			})
		).rejects.toThrow('must not embed credentials');
		await expect(
			asAlice.action(api.credentials.connect, { ...cred, endpoint: 'not a url' })
		).rejects.toThrow('not a valid URL');
	});

	test('only the anthropic protocol is persisted; anything else becomes undefined', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.credentials.connect, {
			...cred,
			protocol: 'anthropic',
			endpoint: 'https://proxy.example/v1'
		});
		await asAlice.action(api.credentials.connect, {
			provider: 'other',
			apiKey: 'sk-other-123456',
			protocol: 'openai'
		});
		const rows = await t.run(async (ctx) => ctx.db.query('modelCreds').collect());
		expect(rows.find((row) => row.provider === 'openai')?.protocol).toBe('anthropic');
		expect(rows.find((row) => row.provider === 'other')?.protocol).toBeUndefined();
	});

	test('models are trimmed, de-duplicated and capped at 100', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.credentials.connect, {
			...cred,
			models: [' gpt-a ', 'gpt-a', '', ...Array.from({ length: 120 }, (_, i) => `m${i}`)]
		});
		const rows = await t.run(async (ctx) => await ctx.db.query('modelCreds').collect());
		const models = rows[0].models!;
		expect(models).toHaveLength(100);
		expect(models[0]).toBe('gpt-a');
		expect(new Set(models).size).toBe(100);
	});

	test('the label is trimmed to 80 characters', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.credentials.connect, { ...cred, label: `  ${'x'.repeat(120)}  ` });
		const rows = await t.run(async (ctx) => await ctx.db.query('modelCreds').collect());
		expect(rows[0].label).toHaveLength(80);
	});
});

describe('reads are owner-scoped', () => {
	test('Bob never sees or revokes Alice credentials', async () => {
		const t = convexTest(schema, modules);
		await t.withIdentity(ALICE).action(api.credentials.connect, cred);

		expect(await t.withIdentity(BOB).query(api.credentials.listProviders, {})).toEqual([]);
		expect(await t.withIdentity(BOB).query(api.credentials.connectedSlugs, {})).toEqual([]);
		expect(
			await t.withIdentity(BOB).mutation(api.credentials.disconnect, { provider: 'openai' })
		).toEqual({ removed: false });
		// Alice's row survived Bob's attempt.
		expect(await t.withIdentity(ALICE).query(api.credentials.connectedSlugs, {})).toEqual([
			'openai'
		]);
	});

	test('an anonymous caller is refused on every public entry point', async () => {
		const t = convexTest(schema, modules);
		await expect(t.query(api.credentials.listProviders, {})).rejects.toThrow();
		await expect(t.query(api.credentials.connectedSlugs, {})).rejects.toThrow();
		await expect(t.action(api.credentials.connect, cred)).rejects.toThrow();
		await expect(t.mutation(api.credentials.disconnect, { provider: 'openai' })).rejects.toThrow();
	});

	test('connectedSlugs is the cheap slug-only projection', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.credentials.connect, cred);
		await asAlice.action(api.credentials.connect, { provider: 'anthropic', apiKey: 'sk-ant-1234' });
		expect(await asAlice.query(api.credentials.connectedSlugs, {})).toEqual([
			'openai',
			'anthropic'
		]);
	});
});

describe('disconnect', () => {
	test('removes the row so the ciphertext is unrecoverable', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.action(api.credentials.connect, cred);
		expect(await asAlice.mutation(api.credentials.disconnect, { provider: 'openai' })).toEqual({
			removed: true
		});
		expect(await t.run(async (ctx) => await ctx.db.query('modelCreds').collect())).toEqual([]);
		// A second revoke is a no-op, not an error.
		expect(await asAlice.mutation(api.credentials.disconnect, { provider: 'openai' })).toEqual({
			removed: false
		});
	});
});

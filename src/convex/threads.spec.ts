/**
 * Chat persistence and the decision log.
 *
 * Both modules are owner-scoped: a session id is not authority. `convex-test` gives a real
 * in-memory deployment, so these assertions are about stored rows, not about mocks.
 */
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');
const ALICE = { subject: 'alice', tokenIdentifier: 'https://issuer|alice' };
const BOB = { subject: 'bob', tokenIdentifier: 'https://issuer|bob' };

async function withSession(title = 'first chat') {
	const t = convexTest(schema, modules);
	const asAlice = t.withIdentity(ALICE);
	const id = await asAlice.mutation(api.threads.createSession, {
		title,
		model: 'gpt-a',
		engine: 'cloud'
	});
	return { t, asAlice, id };
}

describe('sessions', () => {
	test('a new session is trimmed, defaults its title and normalises the engine', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const id = await asAlice.mutation(api.threads.createSession, {
			title: '   ',
			model: 'gpt-a',
			engine: 'nonsense'
		});
		const sessions = await asAlice.query(api.threads.listSessions, {});
		expect(sessions).toEqual([
			{ _id: id, title: 'New chat', model: 'gpt-a', engine: 'cloud', at: expect.any(Number) }
		]);
	});

	test('titles and model names are capped, not rejected', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.mutation(api.threads.createSession, {
			title: `  ${'t'.repeat(200)}  `,
			model: 'm'.repeat(300),
			engine: 'local'
		});
		const [session] = await asAlice.query(api.threads.listSessions, {});
		expect(session.title).toHaveLength(120);
		expect(session.model).toHaveLength(200);
		expect(session.engine).toBe('local');
	});

	test('the list is newest-first and scoped to the signed-in owner', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const first = await asAlice.mutation(api.threads.createSession, {
			title: 'one',
			model: 'm',
			engine: 'cloud'
		});
		const second = await asAlice.mutation(api.threads.createSession, {
			title: 'two',
			model: 'm',
			engine: 'cloud'
		});
		await t.withIdentity(BOB).mutation(api.threads.createSession, {
			title: 'bobs',
			model: 'm',
			engine: 'cloud'
		});
		const sessions = await asAlice.query(api.threads.listSessions, {});
		expect(sessions.map((session) => session._id)).toEqual([second, first]);
		expect(sessions.some((session) => session.title === 'bobs')).toBe(false);
	});

	test('an anonymous caller cannot read or create sessions', async () => {
		const t = convexTest(schema, modules);
		await expect(t.query(api.threads.listSessions, {})).rejects.toThrow();
		await expect(
			t.mutation(api.threads.createSession, { title: 'x', model: 'm', engine: 'cloud' })
		).rejects.toThrow();
	});
});

describe('rename and delete are owner-scoped', () => {
	test("Bob cannot rename or delete Alice's session, and the row is untouched", async () => {
		const { t, asAlice, id } = await withSession('original');
		const asBob = t.withIdentity(BOB);

		expect(await asBob.mutation(api.threads.renameSession, { id, title: 'hijacked' })).toBeNull();
		expect(await asBob.mutation(api.threads.deleteSession, { id })).toBe(false);

		const [session] = await asAlice.query(api.threads.listSessions, {});
		expect(session.title).toBe('original');
	});

	test('rename trims and falls back to the default title', async () => {
		const { asAlice, id } = await withSession('original');
		await asAlice.mutation(api.threads.renameSession, { id, title: '   ' });
		expect((await asAlice.query(api.threads.listSessions, {}))[0].title).toBe('New chat');
	});

	test('delete removes the session and every message in it', async () => {
		const { t, asAlice, id } = await withSession();
		await asAlice.mutation(api.threads.appendMessage, {
			sessionId: id,
			role: 'user',
			content: 'hello',
			source: 'cloud'
		});
		expect(await asAlice.mutation(api.threads.deleteSession, { id })).toBe(true);
		expect(await t.run(async (ctx) => await ctx.db.query('messages').collect())).toEqual([]);
		expect(await asAlice.query(api.threads.listSessions, {})).toEqual([]);
		// Deleting twice is false, not an error.
		expect(await asAlice.mutation(api.threads.deleteSession, { id })).toBe(false);
	});

	test('a nonexistent session id is a no-op', async () => {
		const { t, asAlice } = await withSession();
		const other = await t.withIdentity(BOB).mutation(api.threads.createSession, {
			title: 'bobs',
			model: 'm',
			engine: 'cloud'
		});
		await asAlice.mutation(api.threads.deleteSession, { id: other });
		expect(await asAlice.query(api.threads.listSessions, {})).toHaveLength(1);
	});
});

describe('messages', () => {
	test('append keeps role and source within their closed sets and bumps the session time', async () => {
		const { t, asAlice, id } = await withSession();
		await asAlice.mutation(api.threads.appendMessage, {
			sessionId: id,
			role: 'assistant',
			content: 'reply',
			source: 'decision'
		});
		await asAlice.mutation(api.threads.appendMessage, {
			sessionId: id,
			role: 'system',
			content: 'other',
			source: 'nonsense'
		});
		const messages = await asAlice.query(api.threads.listMessages, { sessionId: id });
		expect(messages.map(({ role, source }) => ({ role, source }))).toEqual([
			{ role: 'assistant', source: 'decision' },
			// Anything that is not `assistant` becomes `user`; an unknown source becomes `cloud`.
			{ role: 'user', source: 'cloud' }
		]);
		const raw = await t.run(async (ctx) => await ctx.db.query('sessions').collect());
		expect(raw[0].at).toBeGreaterThanOrEqual(0);
	});

	test('content is capped at 32 000 characters', async () => {
		const { asAlice, id } = await withSession();
		await asAlice.mutation(api.threads.appendMessage, {
			sessionId: id,
			role: 'user',
			content: 'x'.repeat(40_000),
			source: 'local'
		});
		const [message] = await asAlice.query(api.threads.listMessages, { sessionId: id });
		expect(message.content).toHaveLength(32_000);
	});

	test('appending to someone else session throws instead of writing', async () => {
		const { t, id } = await withSession();
		await expect(
			t.withIdentity(BOB).mutation(api.threads.appendMessage, {
				sessionId: id,
				role: 'user',
				content: 'intrusion',
				source: 'cloud'
			})
		).rejects.toThrow('not available');
		expect(await t.run(async (ctx) => await ctx.db.query('messages').collect())).toEqual([]);
	});

	test("another user cannot read Alice's messages, even with the id", async () => {
		const { t, asAlice, id } = await withSession();
		await asAlice.mutation(api.threads.appendMessage, {
			sessionId: id,
			role: 'user',
			content: 'private',
			source: 'cloud'
		});
		expect(await t.withIdentity(BOB).query(api.threads.listMessages, { sessionId: id })).toEqual(
			[]
		);
	});

	test('messages come back oldest-first', async () => {
		const { asAlice, id } = await withSession();
		for (const content of ['one', 'two', 'three'])
			await asAlice.mutation(api.threads.appendMessage, {
				sessionId: id,
				role: 'user',
				content,
				source: 'cloud'
			});
		const messages = await asAlice.query(api.threads.listMessages, { sessionId: id });
		expect(messages.map((message) => message.content)).toEqual(['one', 'two', 'three']);
	});
});

describe('usage summary', () => {
	test('sums tokens, counts requests and counts anything not "ok" as an error', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await t.run(async (ctx) =>
			ctx.db.insert('usage', {
				owner: ALICE.tokenIdentifier,
				provider: 'openai',
				model: 'gpt-a',
				promptTokens: 10,
				completionTokens: 5,
				status: 'ok',
				at: Date.now()
			})
		);
		await t.run(async (ctx) =>
			ctx.db.insert('usage', {
				owner: ALICE.tokenIdentifier,
				provider: 'openai',
				model: 'gpt-a',
				promptTokens: 20,
				completionTokens: 7,
				status: 'rate_limited',
				at: Date.now()
			})
		);
		await t.run(async (ctx) =>
			ctx.db.insert('usage', {
				owner: BOB.tokenIdentifier,
				provider: 'openai',
				model: 'gpt-a',
				promptTokens: 999,
				completionTokens: 999,
				status: 'ok',
				at: Date.now()
			})
		);
		expect(await asAlice.query(api.threads.usageSummary, {})).toEqual({
			requests: 2,
			promptTokens: 30,
			completionTokens: 12,
			errors: 1
		});
	});

	test('an empty history is all zeroes, not null', async () => {
		const t = convexTest(schema, modules);
		expect(await t.withIdentity(ALICE).query(api.threads.usageSummary, {})).toEqual({
			requests: 0,
			promptTokens: 0,
			completionTokens: 0,
			errors: 0
		});
	});
});

describe('decisions', () => {
	const decision = {
		kind: 'choice' as const,
		question: 'Pick one.',
		choice: 'a',
		probability: 0.75,
		engine: 'npu' as const,
		stateTokens: 10,
		answerCount: 2
	};

	test('records a verdict and lists it newest-first for its session', async () => {
		const { asAlice, id } = await withSession();
		await asAlice.mutation(api.decisions.record, { ...decision, sessionId: id });
		await asAlice.mutation(api.decisions.record, {
			...decision,
			sessionId: id,
			choice: 'b',
			kind: 'score'
		});
		const rows = await asAlice.query(api.decisions.listForSession, { sessionId: id });
		expect(rows.map((row) => row.choice)).toEqual(['b', 'a']);
		expect(rows[0]).toMatchObject({ kind: 'score', probability: 0.75, engine: 'npu' });
	});

	test('a verdict may be recorded without a session', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.mutation(api.decisions.record, decision);
		// It is stored, but it belongs to no session, so no session listing shows it.
		expect(await t.run(async (ctx) => await ctx.db.query('decisions').collect())).toHaveLength(1);
	});

	test('rejects an oversized state, an impossible option count and a bad probability', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const cases: Array<[Partial<typeof decision>, string]> = [
			[{ stateTokens: 10_000 }, 'truncates silently'],
			[{ answerCount: 0 }, 'between 1'],
			[{ answerCount: 999 }, 'between 1'],
			[{ probability: -0.1 }, 'between 0 and 1'],
			[{ probability: 1.1 }, 'between 0 and 1'],
			[{ probability: Number.NaN }, 'between 0 and 1'],
			[{ question: 'pregunta é' }, 'ASCII']
		];
		for (const [patch, message] of cases)
			await expect(
				asAlice.mutation(api.decisions.record, { ...decision, ...patch })
			).rejects.toThrow(message);
		expect(await t.run(async (ctx) => await ctx.db.query('decisions').collect())).toEqual([]);
	});

	test('the probability bounds are inclusive', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.mutation(api.decisions.record, { ...decision, probability: 0 });
		await asAlice.mutation(api.decisions.record, { ...decision, probability: 1 });
		expect(await t.run(async (ctx) => await ctx.db.query('decisions').collect())).toHaveLength(2);
	});

	test("a foreign session id cannot attach a verdict to Alice's chat", async () => {
		const { t, asAlice, id } = await withSession();
		await expect(
			t.withIdentity(BOB).mutation(api.decisions.record, { ...decision, sessionId: id })
		).rejects.toThrow();
		expect(await asAlice.query(api.decisions.listForSession, { sessionId: id })).toEqual([]);
	});

	test('another user cannot list a session decisions', async () => {
		const { t, asAlice, id } = await withSession();
		await asAlice.mutation(api.decisions.record, { ...decision, sessionId: id });
		expect(
			await t.withIdentity(BOB).query(api.decisions.listForSession, { sessionId: id })
		).toEqual([]);
	});
});

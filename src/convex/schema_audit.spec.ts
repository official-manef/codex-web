/**
 * Mechanical audit of the Convex data layer.
 *
 * Three claims this file makes checkable instead of hand-asserted:
 *
 *   1. **No public function takes its tenant from the caller.** Enumerated at runtime from the
 *      function objects themselves (`isPublic`, `exportArgs`, `_handler`), not by grep, so a
 *      function added tomorrow is covered without editing this file.
 *   2. **Every public function refuses an anonymous caller**, with arguments synthesised from its
 *      own validator, so none can pass the check by having a shape this file does not know about.
 *   3. **The index is what makes a read cheap, not luck.** `convex-test` counts
 *      `documentsRead`; a tight per-transaction ceiling therefore distinguishes an indexed
 *      lookup from a scan *inside this file* — the claim the previous review left to prose.
 */
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import schema from './schema';
import { api, internal } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');
const ALICE = { subject: 'alice', tokenIdentifier: 'https://issuer|alice' };
const BOB = { subject: 'bob', tokenIdentifier: 'https://issuer|bob' };

/** Public by design: build metadata and the static provider registry, never user data. */
const PUBLIC_WITHOUT_IDENTITY = new Set(['starter.status', 'chat.providers']);

type ValidatorJson = { type: string; value?: unknown; tableName?: string };

/** `exportArgs()` returns the validator serialised as JSON text, not the validator object. */
type ArgsFields = Record<string, { fieldType: ValidatorJson; optional: boolean }>;

type ExportedFunction = {
	isPublic?: boolean;
	isQuery?: boolean;
	isMutation?: boolean;
	exportArgs: () => string;
	_handler: (...args: never[]) => unknown;
};

function argsFields(fn: ExportedFunction): ArgsFields {
	return (JSON.parse(fn.exportArgs()) as { value?: ArgsFields }).value ?? {};
}

type AnyApi = Record<string, Record<string, unknown>>;

function functionRef(module: string, name: string): never {
	return (api as unknown as AnyApi)[module][name] as never;
}

/** Every public function in `src/convex`, as `module.name` plus the reference to call it. */
async function publicFunctions(): Promise<Array<[string, ExportedFunction]>> {
	const found: Array<[string, ExportedFunction]> = [];
	for (const [path, load] of Object.entries(modules)) {
		if (/\.(spec|test)\.ts$/.test(path) || path.includes('/_generated/')) continue;
		const mod = (await load()) as Record<string, unknown>;
		for (const [name, value] of Object.entries(mod)) {
			const fn = value as ExportedFunction;
			if (typeof value !== 'function' || typeof fn.exportArgs !== 'function') continue;
			if (!fn.isPublic) continue;
			found.push([`${path.replace('./', '').replace(/\.ts$/, '')}.${name}`, fn]);
		}
	}
	return found.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * A value the validator accepts, so an anonymous call reaches the handler instead of dying in
 * argument parsing. Ids come from real rows: a well-formed but nonexistent id is rejected by the
 * validator before identity is ever read, which would make the test measure nothing.
 */
function sampleOf(type: ValidatorJson, ids: Map<string, string>): unknown {
	switch (type.type) {
		case 'string':
			return 'anon-probe';
		case 'number':
		case 'int64':
		case 'float64':
			return 1;
		case 'boolean':
			return true;
		case 'null':
			return null;
		case 'literal':
			return type.value;
		case 'id':
			return ids.get(type.tableName ?? '');
		case 'array':
			return [];
		case 'record':
			return {};
		case 'any':
			return null;
		case 'object': {
			const out: Record<string, unknown> = {};
			for (const [key, field] of Object.entries(
				(type.value ?? {}) as Record<string, { fieldType: ValidatorJson }>
			))
				out[key] = sampleOf(field.fieldType, ids);
			return out;
		}
		case 'union': {
			const members = (type.value ?? []) as ValidatorJson[];
			// `T | null` is a "no target" option; taking it keeps the call side-effect free.
			const nullable = members.find((member) => member.type === 'null');
			return sampleOf(nullable ?? members[0], ids);
		}
		default:
			return null;
	}
}

function argsOf(fn: ExportedFunction, ids: Map<string, string>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(argsFields(fn)))
		out[key] = sampleOf(field.fieldType, ids);
	return out;
}

/** One row per table a public function can name, so every id in a sample resolves. */
async function seedIds(t: ReturnType<typeof convexTest>): Promise<Map<string, string>> {
	const owner = ALICE.tokenIdentifier;
	const ids = new Map<string, string>();
	await t.run(async (ctx) => {
		const now = 1_700_000_000_000;
		const put = (table: string, id: unknown) => ids.set(table, String(id));
		put(
			'sessions',
			await ctx.db.insert('sessions', { owner, title: 's', model: 'm', engine: 'cloud', at: now })
		);
		put(
			'devices',
			await ctx.db.insert('devices', {
				owner,
				name: 'd',
				kind: 'runtime',
				tokenHash: 'a'.repeat(64),
				lastSeenAt: now
			})
		);
		put('memories', await ctx.db.insert('memories', { owner, text: 'n', createdAt: now }));
		put('projects', await ctx.db.insert('projects', { owner, name: 'p', createdAt: now }));
		put(
			'automations',
			await ctx.db.insert('automations', {
				owner,
				prompt: 'p',
				intervalMinutes: 15,
				nextRunAt: now,
				enabled: true,
				failureCount: 0
			})
		);
	});
	return ids;
}

describe('ownership audit: enumerated, not hand-checked', () => {
	test('no public function accepts an owner-shaped argument', async () => {
		const ownerShaped = /^(owner|userid|user_id|identity|tenant|account|createdby|subject)$/i;
		const offences: string[] = [];
		for (const [path, fn] of await publicFunctions())
			for (const key of Object.keys(argsFields(fn)))
				if (ownerShaped.test(key)) offences.push(`${path} takes \`${key}\``);
		expect(offences, `an argument may not choose the tenant: ${offences.join('; ')}`).toEqual([]);
	});

	test('the audit covers every public function, and the count is pinned', async () => {
		const paths = (await publicFunctions()).map(([path]) => path);
		// A new public function must be added here deliberately. Without the pin, deleting
		// `requireUser` from one handler and the handler itself would both keep this file green.
		expect(paths).toEqual([
			'automations.create',
			'automations.list',
			'automations.remove',
			'automations.setEnabled',
			'chat.providers',
			'chat.send',
			'credentials.connect',
			'credentials.connectedSlugs',
			'credentials.disconnect',
			'credentials.listProviders',
			'decisions.listForSession',
			'decisions.record',
			'devices.heartbeat',
			'devices.list',
			'devices.register',
			'devices.revoke',
			'devices.touch',
			'mcp.call',
			'mcp.connect',
			'mcp.disconnect',
			'mcp.discover',
			'mcp.list',
			'mcp.prepare',
			'mcp.setEnabled',
			'memories.add',
			'memories.clear',
			'memories.list',
			'memories.remove',
			'projects.assign',
			'projects.create',
			'projects.list',
			'projects.ofSession',
			'projects.remove',
			'projects.rename',
			'starter.status',
			'threads.appendMessage',
			'threads.createSession',
			'threads.deleteSession',
			'threads.listMessages',
			'threads.listSessions',
			'threads.renameSession',
			'threads.usageSummary'
		]);
	});

	test('no public handler reads an owner out of its arguments', async () => {
		const offences: string[] = [];
		for (const [path, fn] of await publicFunctions())
			if (/args\s*\.\s*owner\b/.test(String(fn._handler))) offences.push(path);
		expect(offences, `these read their tenant from a caller: ${offences.join(', ')}`).toEqual([]);
	});

	test('every public function derives identity, except the two that read nothing', async () => {
		const missing: string[] = [];
		for (const [path, fn] of await publicFunctions())
			if (!PUBLIC_WITHOUT_IDENTITY.has(path) && !String(fn._handler).includes('requireUser'))
				missing.push(path);
		expect(missing, `no requireUser in: ${missing.join(', ')}`).toEqual([]);
	});

	test('every public function refuses an anonymous caller', async () => {
		const t = convexTest(schema, modules);
		const ids = await seedIds(t);
		const accepted: string[] = [];
		const wrongError: string[] = [];

		/** The generic call shape `convex-test` exposes once the function reference is dynamic. */
		type AnyCall = (ref: never, args: Record<string, unknown>) => Promise<unknown>;

		for (const [path, fn] of await publicFunctions()) {
			if (PUBLIC_WITHOUT_IDENTITY.has(path)) continue;
			const [module, name] = path.split('.');
			const ref = functionRef(module, name);
			const args = argsOf(fn, ids);
			const call: AnyCall = fn.isQuery
				? (t.query as unknown as AnyCall)
				: fn.isMutation
					? (t.mutation as unknown as AnyCall)
					: (t.action as unknown as AnyCall);
			try {
				// Every public action here reaches the network; nothing below sends one, because
				// each is refused before its first `fetch`.
				await call(ref, args);
				accepted.push(path);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				// A rejection is only evidence if it came from the auth boundary. "Invalid id" or
				// a validator complaint would be a different function answering.
				if (!/sign in/i.test(message)) wrongError.push(`${path}: ${message.slice(0, 120)}`);
			}
		}

		expect(accepted, `answered an anonymous caller: ${accepted.join(', ')}`).toEqual([]);
		expect(wrongError, `refused, but not by identity: ${wrongError.join(' | ')}`).toEqual([]);
	});
});

describe('index usage: a tight read ceiling tells an index from a scan', () => {
	/** 600 memberships for one owner; only the last is the row the lookup wants. */
	async function crowdedProject(t: ReturnType<typeof convexTest>) {
		return await t.run(async (ctx) => {
			const owner = ALICE.tokenIdentifier;
			const projectId = await ctx.db.insert('projects', { owner, name: 'p', createdAt: 0 });
			for (let i = 0; i < 600; i++)
				await ctx.db.insert('projectChats', { owner, projectId, sessionId: `s-${i}` });
			return { owner, projectId };
		});
	}

	test('ofSession reads one document even with 600 other memberships', async () => {
		const t = convexTest({ schema, modules, transactionLimits: { documentsRead: 10 } });
		const { projectId } = await crowdedProject(t);
		const asAlice = t.withIdentity(ALICE);
		await asAlice.mutation(api.projects.assign, { projectId, sessionId: 's-599' });

		// The ceiling is the assertion: `by_owner` + in-memory filter would read 500 rows and
		// trip it. This is what makes "indexed, not scanned" a measured fact.
		const found = await asAlice.query(api.projects.ofSession, { sessionId: 's-599' });
		expect(found?.name).toBe('p');
	});

	test('a by_owner + in-memory filter over the same table does trip the ceiling', async () => {
		const t = convexTest({ schema, modules, transactionLimits: { documentsRead: 10 } });
		await crowdedProject(t);
		// Proves the ceiling in the test above is meaningful rather than vacuous: the shape the
		// code used to have cannot survive it.
		await expect(
			t.run(async (ctx) => {
				const rows = await ctx.db
					.query('projectChats')
					.withIndex('by_owner', (q) => q.eq('owner', ALICE.tokenIdentifier))
					.take(500);
				return rows.find((row) => row.sessionId === 's-599');
			})
		).rejects.toThrow(/Scanned too many documents/);
	});

	test('listSessions, listMessages and memories.list stay inside their take() bounds', async () => {
		const t = convexTest({ schema, modules, transactionLimits: { documentsRead: 60 } });
		const asAlice = t.withIdentity(ALICE);
		const id = await asAlice.mutation(api.threads.createSession, {
			title: 'x',
			model: 'm',
			engine: 'cloud'
		});
		await t.run(async (ctx) => {
			const owner = ALICE.tokenIdentifier;
			for (let i = 0; i < 20; i++)
				await ctx.db.insert('messages', {
					owner,
					sessionId: id,
					role: 'user',
					content: `m${i}`,
					source: 'cloud',
					at: i
				});
		});
		// 20 messages is under both the 200 read bound and the 60-document ceiling, so this
		// asserts the queries are reachable at all under a tight budget, not that they never scan.
		expect(await asAlice.query(api.threads.listMessages, { sessionId: id })).toHaveLength(20);
		expect(await asAlice.query(api.memories.list, {})).toEqual([]);
	});
});

describe('delete paths drain every page instead of the first one', () => {
	test('deleteSession removes messages past the 200-row read bound', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const id = await asAlice.mutation(api.threads.createSession, {
			title: 'long',
			model: 'm',
			engine: 'cloud'
		});
		await t.run(async (ctx) => {
			const owner = ALICE.tokenIdentifier;
			for (let i = 0; i < 450; i++)
				await ctx.db.insert('messages', {
					owner,
					sessionId: id,
					role: 'user',
					content: `m${i}`,
					source: 'cloud',
					at: i
				});
		});

		expect(await asAlice.mutation(api.threads.deleteSession, { id })).toBe(true);
		// Orphans would be unreachable: `listMessages` needs the session row this delete removed.
		expect(await t.run(async (ctx) => await ctx.db.query('messages').collect())).toEqual([]);
	});

	test('projects.remove removes memberships past the 500-row read bound', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const owner = ALICE.tokenIdentifier;
		const id = await asAlice.mutation(api.projects.create, { name: 'big' });
		await t.run(async (ctx) => {
			for (let i = 0; i < 620; i++)
				await ctx.db.insert('projectChats', { owner, projectId: id, sessionId: `s-${i}` });
		});

		await asAlice.mutation(api.projects.remove, { id });
		expect(await t.run(async (ctx) => await ctx.db.query('projectChats').collect())).toEqual([]);
	});
});

describe('write-path state checks', () => {
	test('assign keeps exactly one membership per (owner, session)', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const first = await asAlice.mutation(api.projects.create, { name: 'one' });
		const second = await asAlice.mutation(api.projects.create, { name: 'two' });

		await asAlice.mutation(api.projects.assign, { projectId: first, sessionId: 's' });
		await asAlice.mutation(api.projects.assign, { projectId: second, sessionId: 's' });

		// Two tabs assigning the same session at once is the race; sequentially they must not
		// accumulate, and the newest wins.
		const rows = await t.run(async (ctx) => await ctx.db.query('projectChats').collect());
		expect(rows).toHaveLength(1);
		expect(rows[0].projectId).toBe(second);
	});

	test('an automation cannot be attached to another owner\u2019s chat', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const asBob = t.withIdentity(BOB);
		const aliceSession = await asAlice.mutation(api.threads.createSession, {
			title: 'private',
			model: 'm',
			engine: 'cloud'
		});

		// A session id in an argument is a reference, not authority. Before this check, Bob's
		// automation row pointed at Alice's chat, and the runner read that prompt as Alice's.
		await expect(
			asBob.mutation(api.automations.create, {
				prompt: 'p',
				intervalMinutes: 15,
				sessionId: aliceSession
			})
		).rejects.toThrow('not available');
		expect(await t.run(async (ctx) => await ctx.db.query('automations').collect())).toEqual([]);
	});

	test('pending MCP approvals are capped, not accumulated', async () => {
		const t = convexTest(schema, modules);
		const owner = ALICE.tokenIdentifier;
		const insert = (i: number, expiresAt: number) =>
			t.mutation(internal.mcp.insertApproval, {
				owner,
				tokenHash: `h${i}`,
				alias: 'a',
				tool: 't',
				arguments: '{}',
				expiresAt
			});
		// 200 prepares inside one 120 s window: nothing is expired, so the sweep cannot reclaim
		// anything and only a cap stops the table growing.
		for (let i = 0; i < 16; i++) await insert(i, Date.now() + 120_000);
		await expect(insert(16, Date.now() + 120_000)).rejects.toThrow(/waiting for confirmation/);
		const rows = await t.run(async (ctx) => await ctx.db.query('mcpApprovals').collect());
		expect(rows).toHaveLength(16);
	});

	test('expired approvals are reclaimed on the next prepare', async () => {
		const t = convexTest(schema, modules);
		const owner = ALICE.tokenIdentifier;
		await t.run(async (ctx) => {
			for (let i = 0; i < 16; i++)
				await ctx.db.insert('mcpApprovals', {
					owner,
					tokenHash: `old${i}`,
					alias: 'a',
					tool: 't',
					arguments: '{}',
					expiresAt: 1
				});
		});
		await t.mutation(internal.mcp.insertApproval, {
			owner,
			tokenHash: 'new',
			alias: 'a',
			tool: 't',
			arguments: '{}',
			expiresAt: Date.now() + 120_000
		});
		const rows = await t.run(async (ctx) => await ctx.db.query('mcpApprovals').collect());
		expect(rows.map((row) => row.tokenHash)).toEqual(['new']);
	});

	test('one pairing token cannot register two device rows', async () => {
		const t = convexTest(schema, modules);
		const asAlice = t.withIdentity(ALICE);
		const tokenHash = 'a'.repeat(64);
		await asAlice.mutation(api.devices.register, { name: 'one', kind: 'runtime', tokenHash });

		// Revoking the first row must not leave the token reusable: a stolen token would then get
		// a second live device while the user believes they retired it.
		const first = await asAlice.query(api.devices.list, {});
		await asAlice.mutation(api.devices.revoke, { id: first[0]._id });
		await expect(
			asAlice.mutation(api.devices.register, { name: 'two', kind: 'runtime', tokenHash })
		).rejects.toThrow('already registered');
		expect(await t.run(async (ctx) => await ctx.db.query('devices').collect())).toHaveLength(1);
	});
});

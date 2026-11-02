import { ESLint, Linter } from 'eslint';
import { resolve } from 'node:path';
import ts from 'typescript-eslint';
import { expect, test } from 'vitest';
import { runtimeBoundary, sliceBoundary } from '../../../scripts/eslint-boundaries.mjs';

const runtimeLinter = new Linter();
function boundaries(code: string, filename = 'src/lib/example.ts') {
	return runtimeLinter.verify(
		code,
		{
			files: ['**/*.ts'],
			languageOptions: { parser: ts.parser },
			plugins: {
				starter: { rules: { runtime: runtimeBoundary, slices: sliceBoundary } }
			},
			rules: { 'starter/runtime': 'error', 'starter/slices': 'error' }
		},
		{ filename: resolve(filename) }
	);
}

test('browser boundaries reject private imports, re-exports and literal dynamic imports', () => {
	for (const code of [
		"import { env } from '$env/dynamic/private';",
		"export { secret } from '$lib/server/secrets';",
		"export * from './secrets.server';",
		"await import('./server/integrations/email');",
		'await import(`$lib/server/integrations/email`);',
		"import { read } from '$app/server';",
		"import { env } from '$app/env/private';",
		"import { readFile } from 'node:fs/promises';",
		"import { readFile } from 'fs/promises';",
		"import { query } from 'convex/server';",
		"await import('../convex/starter');",
		"import { query } from '../convex/_generated/server';",
		"import raw from '$lib/server/secrets.ts?raw';"
	]) {
		const messages = boundaries(code);
		expect(messages, code).toHaveLength(1);
		expect(messages[0].ruleId, code).toBe('starter/runtime');
	}
});

test('server modules, generated client API and erased type imports remain usable', () => {
	for (const [code, filename] of [
		["import { env } from '$env/dynamic/private';", 'src/hooks.server.ts'],
		["import { env } from '$env/static/private';", 'src/routes/example/+server.ts'],
		["import { env } from '$env/dynamic/private';", 'src/routes/example/+page.server.ts'],
		["import { createHash } from 'node:crypto';", 'src/lib/server/example.ts'],
		["import { api } from '../convex/_generated/api';", 'src/lib/example.ts'],
		["import type { Session } from '$lib/server/session';", 'src/lib/example.ts'],
		["import { type Session } from '$lib/server/session';", 'src/lib/example.ts'],
		["export type { Session } from '$lib/server/session';", 'src/lib/example.ts'],
		["import { env } from '$env/dynamic/public';", 'src/lib/example.ts'],
		["import { name } from './config/app';", 'src/lib/example.ts']
	]) {
		expect(boundaries(code, filename), code).toEqual([]);
	}
});

test('Convex rejects SvelteKit dependencies and requires Node action runtime for built-ins', () => {
	for (const code of [
		"import { env } from '$env/static/public';",
		"import type { Config } from '$lib/config/app';",
		"export * from '$app/environment';",
		"await import('../lib/server/integrations/email');",
		'await import(`../../slices/dashboard`);',
		"import { redirect } from '@sveltejs/kit';",
		"import { createHash } from 'node:crypto';"
	]) {
		expect(boundaries(code, 'src/convex/example.ts'), code).toHaveLength(1);
	}
	for (const code of [
		"import { query } from './_generated/server';",
		"import { v } from 'convex/values';",
		"import manifest from '../../version.json';",
		"'use node'; import { createHash } from 'node:crypto';",
		"import type { Buffer } from 'node:buffer';"
	]) {
		expect(boundaries(code, 'src/convex/example.ts'), code).toEqual([]);
	}
});

test('slice rules allow lazy own-screen imports and barrels but reject lazy cross-slice internals', () => {
	expect(
		boundaries("await import('./components/screen.svelte');", 'slices/settings/index.ts')
	).toEqual([]);
	expect(boundaries("await import('$features/dashboard');", 'slices/settings/index.ts')).toEqual(
		[]
	);
	for (const code of [
		"await import('$features/dashboard/components/screen.svelte');",
		'await import(`../dashboard/components/screen.svelte`);',
		"export * from '../dashboard/components/screen.svelte';"
	]) {
		expect(boundaries(code, 'slices/settings/index.ts')[0]?.ruleId, code).toBe('starter/slices');
	}
});

// Use real project paths so the actual flat config and TypeScript project service run.
// lintText changes only ESLint's in-memory input; it never replaces these source files.
const eslint = new ESLint();
async function lint(code: string, filePath = 'src/lib/config/metadata.ts') {
	const [result] = await eslint.lintText(code, { filePath });
	expect(
		result.messages.filter((message) => message.fatal),
		code
	).toEqual([]);
	return result.messages.map((message) => message.ruleId);
}

test('actual project config detects floating promises, async callbacks and incomplete unions', async () => {
	expect(await lint('Promise.resolve(1);')).toContain('@typescript-eslint/no-floating-promises');
	expect(await lint('void Promise.resolve(1);')).toContain(
		'@typescript-eslint/no-floating-promises'
	);
	expect(await lint('[1].forEach(async () => { await Promise.resolve(); });')).toContain(
		'@typescript-eslint/no-misused-promises'
	);
	expect(
		await lint(
			"export function label(state: 'pending' | 'paid') { switch (state) { case 'pending': return 'Pending'; } }"
		)
	).toContain('@typescript-eslint/switch-exhaustiveness-check');
	expect(
		await lint(
			"export async function run() { await Promise.resolve(); }\nexport function label(state: 'pending' | 'paid') { switch (state) { case 'pending': return 'Pending'; case 'paid': return 'Paid'; } }"
		)
	).toEqual([]);
});

test('authored Svelte scripts receive typed async checks and raw HTML is rejected', async () => {
	const file = 'src/lib/ArtifactFrame.svelte';
	expect(
		await lint('<script lang="ts">Promise.resolve(1);</script><p>Example</p>', file)
	).toContain('@typescript-eslint/no-floating-promises');
	expect(
		await lint(
			'<script lang="ts">let { content }: { content: string } = $props();</script><div>{@html content}</div>',
			file
		)
	).toContain('svelte/no-at-html-tags');
	expect(
		await lint(
			'<script lang="ts">let { content }: { content: string } = $props();</script><p>{content}</p>',
			file
		)
	).toEqual([]);
});

test('Svelte snippets allow explicit unused arguments without ignoring unused local variables', async () => {
	const file = 'src/lib/ArtifactFrame.svelte';
	expect(
		await lint(
			'<svelte:boundary><p>Example</p>{#snippet failed(_error, reset)}<button onclick={reset}>Retry</button>{/snippet}</svelte:boundary>',
			file
		)
	).toEqual([]);
	expect(await lint('<script lang="ts">const _unused = 1;</script><p>Example</p>', file)).toContain(
		'@typescript-eslint/no-unused-vars'
	);
});

test('Convex query rules distinguish database builders from bounded reads and ordinary arrays', async () => {
	const file = 'src/convex/starter.ts';
	const prefix =
		"import type { GenericDatabaseReader, GenericDataModel } from 'convex/server'; declare const db: GenericDatabaseReader<GenericDataModel>;";
	expect(
		await lint(
			`${prefix} export async function list() { return db.query('messages').collect(); }`,
			file
		)
	).toContain('starter/no-convex-collect');
	expect(
		await lint(
			`${prefix} export async function list() { const selected = db.query('messages').withIndex('by_owner', q => q.eq('owner', 'me')); return selected['collect'](); }`,
			file
		)
	).toContain('starter/no-convex-collect');
	expect(
		await lint(
			`${prefix} export async function list() { return db.query('messages').filter(q => q.eq(q.field('owner'), 'me')).take(10); }`,
			file
		)
	).toContain('@convex-dev/no-filter-in-query');
	expect(
		await lint(
			`${prefix} export async function list() { const rows = await db.query('messages').take(10); return rows.filter(row => row.owner === 'me'); }`,
			file
		)
	).toEqual([]);
	expect(
		await lint(
			'export const result = [1, 2].filter(value => value > 1); export const bag = { collect: () => [1] }; export const values = bag.collect();',
			file
		)
	).toEqual([]);
});

test('Convex argument validators are required by the installed official rule', async () => {
	const file = 'src/convex/starter.ts';
	expect(
		await lint(
			"import { query } from './_generated/server'; export const list = query({ handler: () => null });",
			file
		)
	).toContain('@convex-dev/require-args-validator');
	expect(
		await lint(
			"import { query } from './_generated/server'; export const list = query({ args: {}, handler: () => null });",
			file
		)
	).toEqual([]);
});

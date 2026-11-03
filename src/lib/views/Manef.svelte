<script lang="ts">
	import View from '#lib/View.svelte';
	import StateNote from '#lib/StateNote.svelte';
	import { Icon } from '../../../shared/icons/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { onMount } from 'svelte';
	import { hub, hubMessage, type Module, type Plan, type Readiness } from '#lib/manef_hub.js';
	import { validateModuleProjection } from '#lib/manef_descriptor.js';

	/**
	 * MANEF AI modules.
	 *
	 * Read-only by construction: the bridge exposes the hub's own read paths, the hub itself has no
	 * execution endpoint, and every capability the registry declares is `read` or `none`. This view
	 * states that plainly instead of implying a live connection.
	 *
	 * The descriptor validator is a local port of `manef-ai/packages/foundation`. It runs against
	 * what the hub reports, so a module that the CLI would reject shows up here as broken-and-why
	 * rather than as a card that merely looks odd. See `src/lib/manef_descriptor.ts`.
	 */

	type Props = { onReload?: () => void };
	let { onReload = () => {} }: Props = $props();

	let modules = $state<Module[]>([]);
	let foundationVersion = $state<string | null>(null);
	let readiness = $state<Readiness | null>(null);
	let loading = $state(true);
	let notice = $state('');
	let failed = $state(false);

	let moduleId = $state('');
	let capabilityId = $state('');
	let input = $state('{}');
	let workflow = $state('{"version":"1.0.0","mode":"preview","steps":[]}');
	let plan = $state<Plan | null>(null);
	let planning = $state(false);
	let alive = $state<boolean | null>(null);
	let validation = $state<{ id: string; ok: boolean; errors: string[] }[]>([]);

	const invalid = $derived(validation.filter((entry) => !entry.ok));

	const current = $derived(modules.find((module) => module.id === moduleId) ?? null);
	const capabilities = $derived(current?.capabilities ?? []);
	const declaredReadOnly = $derived(
		modules.every((module) =>
			module.capabilities.every(
				(capability) =>
					capability.risk === 'read' &&
					capability.effects.every((effect) => effect === 'read' || effect === 'none')
			)
		)
	);

	function status(text: string, isError = false) {
		notice = text;
		failed = isError;
	}

	async function refresh() {
		loading = true;
		try {
			const [registry, ready, health] = await Promise.all([
				hub.modules(),
				hub.ready().catch((e) => e as Error),
				hub.health().catch(() => null)
			]);
			modules = registry.modules;
			foundationVersion = registry.foundationVersion;
			readiness = ready instanceof Error ? null : ready;
			alive = health?.status === 'alive';
			// Validate what the hub actually reported, not what we hoped it reported. The hub sends a
			// projection, so this is the projection schema, not the full descriptor schema. A module
			// whose projection does not match is one this build cannot render faithfully.
			validation = (modules as unknown[]).map((entry) => {
				const result = validateModuleProjection(entry);
				const id =
					typeof entry === 'object' && entry !== null && 'id' in entry
						? String((entry as { id: unknown }).id)
						: 'unknown';
				return { id, ok: result.ok, errors: result.errors };
			});
			moduleId = modules[0]?.id ?? '';
			capabilityId = modules[0]?.capabilities[0]?.id ?? '';
			status(
				modules.length === 0
					? 'The hub answered with an empty registry.'
					: invalid.length === 0
						? `${modules.length} module declarations loaded, all well-formed. No live adapter is configured.`
						: `${modules.length} module declarations loaded; ${invalid.length} failed descriptor validation. See the marked cards.`,
				invalid.length > 0
			);
			onReload();
		} catch (e) {
			modules = [];
			foundationVersion = null;
			readiness = null;
			alive = null;
			validation = [];
			status(e instanceof Error ? e.message : hubMessage('unknown'), true);
		} finally {
			loading = false;
		}
	}

	/** Seed the planner with the hub's own example instead of hand-written JSON. */
	async function loadExample() {
		try {
			const example = await hub.example();
			workflow = JSON.stringify(example, null, 2);
			plan = null;
			status('Example workflow loaded from the hub. Generate a preview to check it.');
		} catch (e) {
			status(e instanceof Error ? e.message : hubMessage('unknown'), true);
		}
	}

	function chooseModule() {
		capabilityId = current?.capabilities[0]?.id ?? '';
	}

	function addStep() {
		try {
			const parsed = JSON.parse(workflow);
			if (!Array.isArray(parsed.steps)) throw new Error('bad');
			if (!moduleId || !capabilityId) throw new Error('bad');
			parsed.version ??= '1.0.0';
			parsed.mode = 'preview';
			parsed.steps.push({ moduleId, capabilityId, input: JSON.parse(input) });
			workflow = JSON.stringify(parsed, null, 2);
			plan = null;
			status('Step added. Generate a preview to check the workflow.');
		} catch {
			status('Enter valid capability input and workflow JSON, then choose a module and capability.', true);
		}
	}

	async function preview() {
		planning = true;
		plan = null;
		try {
			plan = await hub.plan(JSON.parse(workflow));
			status(
				plan.ok
					? 'Preview generated. No product was executed.'
					: 'The preview has contract errors. Review the output.',
				!plan.ok
			);
		} catch (e) {
			status(e instanceof Error ? e.message : hubMessage('unknown'), true);
		} finally {
			planning = false;
		}
	}

	onMount(refresh);
</script>

<View
	title="MANEF AI"
	icon="layers"
	subtitle="Four independent products under one versioned contract, with the declarations, source pins and previews each one publishes."
>
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<Button size="sm" variant="outline" onclick={refresh} disabled={loading}>
			<Icon name="chevron" size={13} />Refresh declarations
		</Button>
		<Button size="sm" variant="ghost" onclick={loadExample} disabled={loading}>
			Load example workflow
		</Button>
		<span class="text-[11.5px] text-ink-3">
			{loading && !foundationVersion
				? 'Reading the contract…'
				: foundationVersion
					? `Foundation contract ${foundationVersion}`
					: 'Contract unavailable'}
		</span>
	</div>

	{#if notice}
		<p
			class="mb-4 text-[12.5px] leading-relaxed"
			class:text-destructive={failed}
			class:text-ink-2={!failed}
			role="status"
			aria-live="polite"
		>{notice}</p>
	{/if}

	<dl class="mb-5 grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-4">
		<div>
			<dt class="text-ink-3">Hub liveness</dt>
			<dd class="font-medium">
				{#if alive === null}
					Not answering
				{:else if alive}
					alive
				{:else}
					answered, not alive
				{/if}
			</dd>
		</div>
		<div>
			<dt class="text-ink-3">Live adapters</dt>
			<dd class="font-medium">
				{#if loading && !readiness}
					Reading
				{:else if readiness && 'status' in readiness}
					{readiness.liveAdapters}
				{:else}
					Unknown
				{/if}
			</dd>
		</div>
		<div>
			<dt class="text-ink-3">Planning mode</dt>
			<dd class="font-medium">Preview only</dd>
		</div>
		<div>
			<dt class="text-ink-3">Declared effects</dt>
			<dd class="font-medium">
				{#if modules.length === 0}
					No modules
				{:else if declaredReadOnly}
					read / none only
				{:else}
					Mixed: review each capability
				{/if}
			</dd>
		</div>
	</dl>

	<h2 class="mb-2 text-[13px] font-semibold">Module registry</h2>
	<p class="mb-3 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-2">
		Each card is an offline contract with an exact source pin. A pin identifies review evidence; it
		does not mean merged, deployed or reachable.
	</p>

	<div class="grid gap-3 pb-6 md:grid-cols-2">
		{#if loading && modules.length === 0}
			<div class="md:col-span-2">
				<StateNote
					state="loading"
					title="Reading the hub's module declarations"
					detail="The registry has not answered yet. Each card is a declaration the hub reports, so an empty grid here means it is still reading, not that the hub declares nothing."
					fix="none"
				/>
			</div>
		{:else if modules.length === 0}
			<div class="md:col-span-2">
				<StateNote
					state="degraded"
					title="No module declarations came back"
					detail="The hub answered, and its registry held no modules. A module is a contract this console may preview; without one there is nothing to compose."
					fix="operator"
				/>
			</div>
		{/if}
		{#each modules as module, index (module.id)}
			{@const checked = validation.find((entry) => entry.id === module.id)}
			<article
				class="rounded-lg border border-line p-4"
				class:border-destructive={checked && !checked.ok}
			>
				<div class="mb-2 flex items-start justify-between gap-3">
					<h3 class="text-[13.5px] font-semibold">
						<span class="mr-2 text-ink-3">{String(index + 1).padStart(2, '0')}</span>{module.name}
					</h3>
					<span class="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-3"
						>{checked && !checked.ok ? 'invalid descriptor' : 'declared'}</span
					>
				</div>
				{#if checked && !checked.ok}
					<ul class="mb-3 list-disc pl-5 text-[11.5px] leading-relaxed text-destructive">
						{#each checked.errors as problem (problem)}
							<li><code>{problem}</code></li>
						{/each}
					</ul>
				{/if}
				<p class="mb-3 text-[12px] leading-relaxed text-ink-2">
					{module.capabilities[0]?.summary ?? 'No capabilities declared.'}
				</p>
				<dl class="grid gap-1 text-[11.5px]">
					<div class="flex gap-2">
						<dt class="w-32 shrink-0 text-ink-3">Live adapter</dt><dd>Unconfigured</dd>
					</div>
					<div class="flex gap-2">
						<dt class="w-32 shrink-0 text-ink-3">Module / version</dt><dd
							>{module.id} · {module.version}</dd
						>
					</div>
					<div class="flex gap-2">
						<dt class="w-32 shrink-0 text-ink-3">Native runtime</dt><dd
							>{module.runtime.language} {module.runtime.minimumVersion} · {module.runtime
								.manager}</dd
						>
					</div>
					<div class="flex gap-2">
						<dt class="w-32 shrink-0 text-ink-3">Source revision</dt><dd class="font-mono text-[10.5px]"
							>{module.source.revision}</dd
						>
					</div>
					<div class="flex gap-2">
						<dt class="w-32 shrink-0 text-ink-3">Repository</dt><dd>{module.source.repository}</dd>
					</div>
				</dl>
				{#if module.source.link}
					<a
						class="mt-3 inline-block text-[11.5px] underline underline-offset-2"
						href={module.source.link}
						target="_blank"
						rel="noopener noreferrer">View pinned source ↗</a
					>
				{/if}
				<details class="mt-3 text-[11.5px]">
					<summary class="cursor-pointer text-ink-3"
						>{module.capabilities.length} declared capabilities</summary
					>
					<ul class="mt-2 grid gap-2">
						{#each module.capabilities as capability (capability.id)}
							<li>
								<div class="font-medium">{capability.id} · {capability.mode} · {capability.risk}</div>
								<div class="text-ink-3">
									Effects: {capability.effects.join(', ') || 'none declared'}
								</div>
								<div class="text-ink-3">
									Scopes: {capability.requiredScopes.join(', ') || 'none declared'}
								</div>
								<div class="text-ink-3">
									Input: {capability.input.format} · {capability.input.ref ?? 'no source reference'}
								</div>
								<div class="text-ink-3">
									Output: {capability.output.format} · {capability.output.ref ??
										'no source reference'}
								</div>
							</li>
						{/each}
					</ul>
				</details>
			</article>
		{/each}
	</div>

	<h2 class="mb-2 text-[13px] font-semibold">Compose a preview</h2>
	<p class="mb-3 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-2">
		A plan describes declared effects and required scopes. It never calls a service, and it carries
		no principal, tenant, scope or approval: each product supplies those when it makes its own call.
	</p>

	<div class="grid gap-4 pb-2 lg:grid-cols-2">
		<div class="grid gap-3">
			<label class="grid gap-1 text-[11.5px]">
				<span class="text-ink-3">Module</span>
				<select
					class="h-8 rounded border border-line bg-background px-2"
					bind:value={moduleId}
					onchange={chooseModule}
					disabled={loading || modules.length === 0}
				>
					{#each modules as module (module.id)}
						<option value={module.id}>{module.name}</option>
					{/each}
				</select>
			</label>
			<label class="grid gap-1 text-[11.5px]">
				<span class="text-ink-3">Capability</span>
				<select
					class="h-8 rounded border border-line bg-background px-2"
					bind:value={capabilityId}
					disabled={loading || capabilities.length === 0}
				>
					{#each capabilities as capability (capability.id)}
						<option value={capability.id}>{capability.id}</option>
					{/each}
				</select>
			</label>
			<label class="grid gap-1 text-[11.5px]">
				<span class="text-ink-3">Capability input <span class="text-ink-3">JSON</span></span>
				<Textarea bind:value={input} rows={4} spellcheck="false" />
			</label>
			<p class="text-[11px] leading-relaxed text-ink-3">
				Use synthetic inputs or references. Do not enter credentials, tenant identity, scopes or
				approval.
			</p>
			<div class="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onclick={addStep} disabled={loading}>Add step</Button>
				<Button
					size="sm"
					variant="ghost"
					onclick={() => {
						workflow = '{"version":"1.0.0","mode":"preview","steps":[]}';
						plan = null;
						status('Workflow cleared.');
					}}>Clear workflow</Button
				>
			</div>
			<label class="grid gap-1 text-[11.5px]">
				<span class="text-ink-3">Workflow request <span class="text-ink-3">preview JSON</span></span>
				<Textarea bind:value={workflow} rows={9} spellcheck="false" />
			</label>
			<div>
				<Button size="sm" onclick={preview} disabled={planning || modules.length === 0}>
					{planning ? 'Planning…' : 'Generate preview'}
				</Button>
			</div>
		</div>

		<div class="min-w-0">
			<div class="mb-2 flex items-center justify-between">
				<h3 class="text-[12.5px] font-semibold">Plan output</h3>
				<span class="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-3"
					>{plan?.mode ?? 'preview'}</span
				>
			</div>
			<pre
				class="max-h-[420px] overflow-auto rounded-lg border border-line p-3 text-[11px] leading-relaxed"
				aria-label="Preview plan output"
				aria-live="polite">{plan ? JSON.stringify(plan, null, 2) : 'Your preview will appear here.'}</pre
			>
		</div>
	</div>
</View>

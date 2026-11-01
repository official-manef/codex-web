<script lang="ts">
	import View from "#lib/View.svelte";
	import { onMount } from "svelte";
	import { useMutation, useQuery } from "convex-svelte";
	import { env } from "$env/dynamic/public";
	import { api } from "../../convex/_generated/api.js";
	import type { Id } from "../../convex/_generated/dataModel.js";
	import { MAX_AUTOMATIONS, automationTitle } from "#lib/automations.js";

	/**
	 * Scheduled tasks screen.
	 *
	 * This build records intent and due times; it does not run them. The runner that would
	 * call a model is not implemented, and the view says so rather than showing a scheduler
	 * that never fires. Same rule as every other surface here: no invented state.
	 *
	 * Reads and writes go through Convex so the rows survive a tab close; with no deployment
	 * configured the screen explains why it is unavailable instead of pretending to store.
	 *
	 * No props: like `Pricing.svelte`, this screen takes nothing from `screenProps` and does
	 * not pretend to read a runtime it never uses.
	 */

	type Row = {
		_id: Id<"automations">;
		prompt: string;
		intervalMinutes: number;
		enabled: boolean;
	};

	type DryRunDecision = {
		id: string;
		run: boolean;
		reason: string;
	};

	type DryRunResult = {
		decisions: DryRunDecision[];
		considered: number;
		wouldRun: number;
		executor: string;
		note: string;
	};

	const cloudUrl = env.PUBLIC_CONVEX_URL;
	const list = cloudUrl ? useQuery(api.automations.list, () => ({})) : null;
	const create = cloudUrl ? useMutation(api.automations.create) : null;
	const remove = cloudUrl ? useMutation(api.automations.remove) : null;

	let draft = $state("");
	let interval = $state(60);
	let busy = $state("");
	let error = $state("");
	let dryRunResult = $state<DryRunResult | null>(null);
	let dryRunDisabled = $state(false);
	let dryRunError = $state("");

	const rows = $derived(((list?.data ?? []) as Row[]) || []);
	const available = cloudUrl !== "" && cloudUrl !== undefined;

	onMount(() => {
		if (!available) error = "";
	});

	async function save() {
		if (!create) return;
		busy = "save";
		error = "";
		try {
			await create({ prompt: draft.trim(), intervalMinutes: interval });
			draft = "";
		} catch (e: any) {
			error = e?.data?.message ?? e?.message ?? "That automation could not be recorded.";
		} finally {
			busy = "";
		}
	}

	async function drop(id: Id<"automations">) {
		if (!remove) return;
		busy = id;
		error = "";
		try {
			await remove({ id });
		} catch (e: any) {
			error = e?.data?.message ?? e?.message ?? "That automation could not be removed.";
		} finally {
			busy = "";
		}
	}

	async function runDryRun() {
		busy = "dryRun";
		dryRunError = "";
		dryRunDisabled = false;
		try {
			const res = await fetch("/api/automations/run", {
				method: "POST",
				headers: {
					"content-type": "application/json"
				}
			});
			if (res.status === 404) {
				dryRunDisabled = true;
				dryRunResult = null;
				return;
			}
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				throw new Error(body?.message ?? `Dry run failed with status ${res.status}`);
			}
			dryRunResult = (await res.json()) as DryRunResult;
		} catch (e: any) {
			dryRunError = e?.message ?? "The dry run could not be executed.";
		} finally {
			busy = "";
		}
	}
</script>

<View
	title="Scheduled tasks"
	icon="workflow"
	subtitle="Records a prompt and a due time. This build does not run them yet: the runner and its failure path come first, so nothing here claims to be scheduling anything. The dry run previews decisions and executes nothing."
>
	{#snippet actions()}
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="btn"
				disabled={busy === "dryRun"}
				onclick={runDryRun}>Dry run</button
			>
			<span class="chip mono">{rows.length} of {MAX_AUTOMATIONS}</span>
		</div>
	{/snippet}

	{#if !available}
		<p class="text-[13px] leading-relaxed text-ink-2" role="status">
			Cloud mode is not configured, so there is nowhere to keep a schedule. Set
			<code>PUBLIC_CONVEX_URL</code> to your own deployment to record one.
		</p>
	{:else}
		<section class="card mb-6 p-4">
			<label for="automation-prompt" class="mb-1.5 block text-[13px] font-medium">
				What should run
			</label>
			<textarea
				id="automation-prompt"
				class="field w-full text-[13px] leading-relaxed"
				rows="3"
				maxlength="4000"
				bind:value={draft}
				placeholder="Summarise the open pull requests in this workspace."
			></textarea>
			<div class="mt-2.5 flex flex-wrap items-center gap-3">
				<label class="flex items-center gap-2 text-[12.5px]">
					<span>Every</span>
					<select class="field" bind:value={interval} aria-label="Interval">
						<option value={15}>15 minutes</option>
						<option value={30}>30 minutes</option>
						<option value={60}>hour</option>
						<option value={360}>6 hours</option>
						<option value={1440}>day</option>
					</select>
				</label>
				<button
					type="button"
					class="btn btn-solid"
					disabled={!draft.trim() || !!busy || rows.length >= MAX_AUTOMATIONS}
					onclick={save}>Record</button
				>
			</div>
			{#if error}<p class="mt-2 text-[12px]" role="alert">{error}</p>{/if}
			<p class="mt-2 text-[12px] leading-relaxed text-ink-2">
				Minimum interval is 15 minutes. An automation disables itself after three consecutive
				failures once the runner exists.
			</p>
		</section>

		{#if rows.length === 0}
			<p class="text-[13px] text-ink-2" role="status">
				No automations recorded. Saving one is harmless: nothing will run until the runner
				ships.
			</p>
		{:else}
			<ul class="card divide-y divide-line">
				{#each rows as row (row._id)}
					<li class="flex items-start justify-between gap-3 px-4 py-3">
						<div class="min-w-0">
							<p class="truncate text-[13px]">{automationTitle(row.prompt)}</p>
							<p class="text-[11.5px] text-ink-3">
								Every {row.intervalMinutes} min · {row.enabled ? "enabled" : "disabled"} · not run
							</p>
						</div>
						<button
							type="button"
							class="btn"
							disabled={!!busy}
							onclick={() => drop(row._id)}>Remove</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}

	{#if dryRunDisabled}
		<p class="mt-4 text-[13px] leading-relaxed text-ink-2" role="status">
			The dry run is switched off on this server. Set <code>AUTOMATIONS_ENABLED=true</code> in the
			server environment to enable it.
		</p>
	{/if}

	{#if dryRunError}
		<p class="mt-4 text-[12px] text-crimson" role="alert">{dryRunError}</p>
	{/if}

	{#if dryRunResult}
		<section class="mt-6 space-y-3">
			<div class="flex items-center justify-between">
				<h3 class="text-[13px] font-medium">Dry run preview</h3>
				<span class="text-[12px] text-ink-3">
					{dryRunResult.wouldRun} of {dryRunResult.considered} would run
				</span>
			</div>
			{#if dryRunResult.decisions.length === 0}
				<p class="text-[12.5px] text-ink-2" role="status">No due automations evaluated.</p>
			{:else}
				<div class="card overflow-x-auto">
					<table class="w-full text-left text-[12px]">
						<caption class="sr-only">Dry run decisions</caption>
						<thead class="bg-panel-2 text-ink-2">
							<tr>
								<th scope="col" class="w-16 px-4 py-2.5 font-medium">#</th>
								<th scope="col" class="w-28 px-4 py-2.5 font-medium">Would run</th>
								<th scope="col" class="px-4 py-2.5 font-medium">Reason</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-line">
							{#each dryRunResult.decisions as decision, index}
								<tr>
									<td class="mono px-4 py-2 text-ink-3">{index + 1}</td>
									<td class="px-4 py-2">
										{#if decision.run}
											<span class="font-medium text-ink">Yes</span>
										{:else}
											<span class="text-ink-3">No</span>
										{/if}
									</td>
									<td class="mono px-4 py-2 text-ink-2">{decision.reason}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}
</View>

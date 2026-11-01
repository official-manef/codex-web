<script lang="ts">
	import View from "#lib/View.svelte";
	import McpAppFrame from "#lib/McpAppFrame.svelte";
	import { page } from "$app/state";
	import { onMount } from "svelte";

	type AppManifest = {
		id: string;
		name: string;
		origin: string;
		entry: string;
		surfaces: string[];
	};

	let apps: AppManifest[] = $state([]);
	let selectedAppId = $state<string | null>(null);
	let loading = $state(true);
	let disabled = $state(false);
	let unavailable = $state(false);
	let fetchError = $state<string | null>(null);

	async function loadApps(forceFetch = false) {
		if (!forceFetch) {
			const fromPage = (page.data?.mcpApps ?? page.data?.apps) as AppManifest[] | undefined;
			if (Array.isArray(fromPage)) {
				apps = fromPage;
				loading = false;
				return;
			}
		}

		loading = true;
		disabled = false;
		unavailable = false;
		fetchError = null;

		try {
			const res = await fetch("/api/mcp/apps");
			if (res.status === 404) {
				disabled = true;
				apps = [];
			} else if (res.status === 503) {
				unavailable = true;
				apps = [];
			} else if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				fetchError = body?.error ?? `Request failed with status ${res.status}`;
				apps = [];
			} else {
				const body = (await res.json()) as AppManifest[] | { apps?: AppManifest[] };
				apps = Array.isArray(body) ? body : (body.apps ?? []);
			}
		} catch (err: unknown) {
			fetchError = err instanceof Error ? err.message : "Failed to load MCP apps.";
			apps = [];
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void loadApps();
	});

	function toggleSelect(id: string) {
		selectedAppId = selectedAppId === id ? null : id;
	}
</script>

<View
	title="MCP apps"
	icon="grid"
	subtitle="Apps are an operator-configured allowlist, not a marketplace; a hosted app runs in a sandboxed frame with no same-origin access; a per-app approval gate is not implemented yet."
>
	{#snippet actions()}
		<button
			type="button"
			class="btn"
			onclick={() => loadApps(true)}
			disabled={loading}
		>
			Refresh
		</button>
	{/snippet}

	<div class="mb-4 max-w-[70ch] space-y-1 text-[12px] leading-relaxed text-ink-2">
		<p>Apps are an operator-configured allowlist, not a marketplace.</p>
		<p>A hosted app runs in a sandboxed frame with no same-origin access.</p>
		<p>A per-app approval gate is not implemented yet.</p>
	</div>

	{#if loading && !disabled && !unavailable && !fetchError && apps.length === 0}
		<p class="text-[13px] text-ink-2" role="status">Checking MCP apps…</p>
	{:else if disabled}
		<p class="text-[13px] leading-relaxed text-ink-2" role="status">
			The app host is switched off on this server, set MCP_APPS_ENABLED.
		</p>
	{:else if unavailable}
		<p class="text-[13px] leading-relaxed text-ink-2" role="status">
			The app host is temporarily unavailable.
		</p>
	{:else if fetchError}
		<p class="text-[13px] leading-relaxed text-red-600 dark:text-red-400" role="alert">
			{fetchError}
		</p>
	{:else if apps.length === 0}
		<p class="text-[13px] leading-relaxed text-ink-2" role="status">
			No MCP apps configured.
		</p>
	{:else}
		<ul class="space-y-4">
			{#each apps as app (app.id)}
				<li class="card p-4">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-[14px] font-semibold text-ink">{app.name}</span>
								<span class="text-ink-3">·</span>
								<span class="mono text-[12px] text-ink-2">{app.origin}</span>
							</div>
							<div class="mt-2 flex flex-wrap gap-1">
								{#each app.surfaces as surface}
									<span class="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-ink-2">
										{surface}
									</span>
								{/each}
							</div>
						</div>
						<button
							type="button"
							class="btn text-[12px]"
							aria-pressed={selectedAppId === app.id}
							onclick={() => toggleSelect(app.id)}
						>
							{selectedAppId === app.id ? "Close" : "Open"}
						</button>
					</div>

					{#if selectedAppId === app.id}
						<div class="mt-4 border-t border-line pt-4">
							<McpAppFrame appId={app.id} src={app.origin} />
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</View>

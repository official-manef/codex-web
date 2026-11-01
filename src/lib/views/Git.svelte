<script lang="ts">
	import { onMount } from "svelte";
	import View from "#lib/View.svelte";

	type Props = { backends?: any[] };
	let { backends = [] }: Props = $props();

	type GitFile = { path: string; code: string };
	type GitCommit = { hash: string; date: string; subject: string };
	type GitData = {
		root: { name: string };
		status: {
			branch: string;
			files: GitFile[];
			truncated: boolean;
		};
		commits: GitCommit[];
	};

	let loading = $state(true);
	let disabled = $state(false);
	let noRoot = $state(false);
	let error = $state<string | null>(null);
	let data = $state<GitData | null>(null);

	async function load() {
		loading = true;
		error = null;
		disabled = false;
		noRoot = false;
		try {
			const res = await fetch("/api/git");
			if (res.status === 404) {
				disabled = true;
				data = null;
			} else if (res.status === 503) {
				noRoot = true;
				data = null;
			} else if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				error = body?.error ?? `Request failed with status ${res.status}`;
				data = null;
			} else {
				data = (await res.json()) as GitData;
			}
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : "Failed to load git status.";
			data = null;
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<View
	title="Git"
	icon="fork"
	subtitle="Read-only repository inspection for server-configured roots. Stage, commit, and push operations are not supported in this build."
>
	{#snippet actions()}
		<button class="btn" onclick={load} disabled={loading}>Refresh</button>
	{/snippet}

	{#if loading && !data && !disabled && !noRoot && !error}
		<p class="text-[13px] text-ink-2" role="status">Checking repository status…</p>
	{:else if disabled}
		<p class="text-[13px] leading-relaxed text-ink-2" role="status">
			The git surface is switched off on this server. Set
			<code>GIT_SURFACE_ENABLED=true</code> in the server environment to enable repository
			inspection.
		</p>
	{:else if noRoot}
		<p class="text-[13px] leading-relaxed text-ink-2" role="status">
			No repository root configured. Set <code>GIT_SURFACE_ROOTS</code> in the server environment
			to configure an allowlisted repository root.
		</p>
	{:else if error}
		<p class="text-[13px] leading-relaxed text-ink-2" role="status">
			{error}
		</p>
	{:else if data}
		<div class="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
			<span class="font-medium text-ink">{data.root.name}</span>
			<span class="text-ink-3">·</span>
			<span class="mono text-ink-2">{data.status.branch || "HEAD"}</span>
		</div>

		<h2 class="mb-2 text-[15px] font-semibold">Working tree</h2>
		{#if !data.status.files || data.status.files.length === 0}
			<p class="text-[13px] text-ink-2" role="status">Working tree clean.</p>
		{:else}
			<div class="card overflow-x-auto">
				<table class="w-full min-w-[480px] text-left text-[12px]">
					<caption class="sr-only">Working tree changes</caption>
					<thead class="bg-panel-2 text-ink-2">
						<tr>
							<th scope="col" class="w-20 px-4 py-3 font-medium">Status</th>
							<th scope="col" class="px-4 py-3 font-medium">Path</th>
						</tr>
					</thead>
					<tbody>
						{#each data.status.files as file}
							<tr class="border-t border-line">
								<td class="mono px-4 py-2.5 font-medium text-ink-2">{file.code}</td>
								<td class="mono px-4 py-2.5 text-ink">{file.path}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if data.status.truncated}
				<p class="mt-2 text-[12px] text-ink-3">Showing the first 500 entries.</p>
			{/if}
		{/if}

		<h2 class="mt-6 mb-2 text-[15px] font-semibold">Recent commits</h2>
		{#if !data.commits || data.commits.length === 0}
			<p class="text-[13px] text-ink-2" role="status">No commits yet.</p>
		{:else}
			<div class="card overflow-x-auto">
				<table class="w-full min-w-[520px] text-left text-[12px]">
					<caption class="sr-only">Recent commits</caption>
					<thead class="bg-panel-2 text-ink-2">
						<tr>
							<th scope="col" class="w-28 px-4 py-3 font-medium">Commit</th>
							<th scope="col" class="w-32 px-4 py-3 font-medium">Date</th>
							<th scope="col" class="px-4 py-3 font-medium">Subject</th>
						</tr>
					</thead>
					<tbody>
						{#each data.commits as commit}
							<tr class="border-t border-line">
								<td class="mono px-4 py-2.5 text-ink-2">{commit.hash}</td>
								<td class="mono px-4 py-2.5 text-ink-2">{commit.date}</td>
								<td class="px-4 py-2.5 text-ink">{commit.subject}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</View>

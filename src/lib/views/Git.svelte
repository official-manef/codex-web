<script lang="ts">
	import { onMount } from "svelte";
	import { Dialog } from "bits-ui";
	import View from "#lib/View.svelte";

	type Props = { backends?: any[] };
	let { backends = [] }: Props = $props();

	type GitFile = { path: string; code: string };
	type GitCommit = { hash: string; date: string; subject: string };
	type GitWorktree = { path: string; branch: string };
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

	// Action & policy states
	let actionLoading = $state<string | null>(null);
	let policyNotice = $state<string | null>(null);
	let actionError = $state<string | null>(null);

	// Selection & staging
	let selectedPaths = $state<string[]>([]);

	// Diff state
	let selectedDiffPath = $state<string | null>(null);
	let diffStaged = $state(false);
	let diffContent = $state<string | null>(null);

	// Commit state
	let commitMessage = $state("");
	let lastCommitHash = $state<string | null>(null);

	// Worktrees state
	let worktrees = $state<GitWorktree[] | null>(null);
	let newWorktreePath = $state("");
	let newWorktreeBranch = $state("");
	// Removal is destructive and outside the policy gate's review, so it asks in a real dialog
	// instead of a native confirm box.
	let pendingRemove = $state<string | null>(null);

	function hasStagedFiles(): boolean {
		if (!data?.status.files || data.status.files.length === 0) return false;
		return data.status.files.some((f) => f.code !== "??" && f.code !== "!");
	}

	let isCommitDisabled = $derived(
		Boolean(actionLoading) || commitMessage.trim().length === 0 || !hasStagedFiles()
	);

	function verbForAction(action: string): string {
		if (action === "diff") return "git_diff";
		if (action === "stage") return "git_stage";
		if (action === "commit") return "git_commit";
		if (action.startsWith("worktree")) return "git_worktree";
		return action;
	}

	async function postGit(payload: Record<string, unknown>): Promise<Response> {
		const action = typeof payload.action === "string" ? payload.action : "";
		const url = data?.root.name ? `/api/git?root=${encodeURIComponent(data.root.name)}` : "/api/git";
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});

		if (res.status === 403) {
			const body = (await res.json().catch(() => null)) as {
				verb?: string;
				message?: string;
				error?: string;
			} | null;
			const verb = body?.verb ?? verbForAction(action);
			policyNotice = `Writes for "${verb}" are denied by default on this server (the operator must allow it in GIT_POLICY_JSON).`;
			actionError = null;
		}

		return res;
	}

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
				await fetchWorktrees();
			}
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : "Failed to load git status.";
			data = null;
		} finally {
			loading = false;
		}
	}

	async function loadDiff(path: string, staged: boolean) {
		actionLoading = "diff";
		policyNotice = null;
		actionError = null;
		try {
			const res = await postGit({ action: "diff", path, staged });
			if (res.status === 403) {
				diffContent = null;
				return;
			}
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				actionError = body?.error ?? `Diff failed with status ${res.status}`;
				diffContent = null;
				return;
			}
			const body = (await res.json()) as { root: { name: string }; diff: string };
			diffContent = body.diff;
		} catch (e: unknown) {
			actionError = e instanceof Error ? e.message : "Failed to load diff.";
			diffContent = null;
		} finally {
			actionLoading = null;
		}
	}

	async function selectDiff(path: string) {
		selectedDiffPath = path;
		await loadDiff(path, diffStaged);
	}

	async function toggleDiffStaged(staged: boolean) {
		diffStaged = staged;
		if (selectedDiffPath) {
			await loadDiff(selectedDiffPath, staged);
		}
	}

	function isSelected(path: string): boolean {
		return selectedPaths.includes(path);
	}

	function toggleSelect(path: string) {
		if (selectedPaths.includes(path)) {
			selectedPaths = selectedPaths.filter((p) => p !== path);
		} else {
			selectedPaths = [...selectedPaths, path];
		}
	}

	async function stageSelected() {
		if (selectedPaths.length === 0) return;
		actionLoading = "stage";
		policyNotice = null;
		actionError = null;
		try {
			const res = await postGit({ action: "stage", paths: selectedPaths });
			if (res.status === 403) {
				return;
			}
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				actionError = body?.error ?? `Stage failed with status ${res.status}`;
				return;
			}
			selectedPaths = [];
			await load();
		} catch (e: unknown) {
			actionError = e instanceof Error ? e.message : "Failed to stage files.";
		} finally {
			actionLoading = null;
		}
	}

	async function commitChanges() {
		if (isCommitDisabled) return;
		actionLoading = "commit";
		policyNotice = null;
		actionError = null;
		lastCommitHash = null;
		try {
			const res = await postGit({ action: "commit", message: commitMessage });
			if (res.status === 403) {
				return;
			}
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				actionError = body?.error ?? `Commit failed with status ${res.status}`;
				return;
			}
			const result = (await res.json()) as { root: { name: string }; hash: string };
			lastCommitHash = result.hash;
			commitMessage = "";
			await load();
		} catch (e: unknown) {
			actionError = e instanceof Error ? e.message : "Failed to create commit.";
		} finally {
			actionLoading = null;
		}
	}

	async function fetchWorktrees() {
		actionLoading = "worktree-list";
		try {
			const res = await postGit({ action: "worktree-list" });
			if (res.status === 403) {
				worktrees = [];
				return;
			}
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				actionError = body?.error ?? `Failed to list worktrees (${res.status})`;
				worktrees = [];
				return;
			}
			const result = (await res.json()) as {
				root: { name: string };
				worktrees: GitWorktree[];
			};
			worktrees = result.worktrees;
		} catch (e: unknown) {
			actionError = e instanceof Error ? e.message : "Failed to fetch worktrees.";
			worktrees = [];
		} finally {
			actionLoading = null;
		}
	}

	async function addWorktree() {
		const path = newWorktreePath.trim();
		const branch = newWorktreeBranch.trim();
		if (!path || !branch) return;
		actionLoading = "worktree-add";
		policyNotice = null;
		actionError = null;
		try {
			const res = await postGit({ action: "worktree-add", path, branch });
			if (res.status === 403) {
				return;
			}
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				actionError = body?.error ?? `Failed to add worktree (${res.status})`;
				return;
			}
			newWorktreePath = "";
			newWorktreeBranch = "";
			await fetchWorktrees();
		} catch (e: unknown) {
			actionError = e instanceof Error ? e.message : "Failed to add worktree.";
		} finally {
			actionLoading = null;
		}
	}

	async function removeWorktree(path: string) {
		actionLoading = "worktree-remove";
		policyNotice = null;
		actionError = null;
		try {
			const res = await postGit({ action: "worktree-remove", path });
			if (res.status === 403) {
				return;
			}
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				actionError = body?.error ?? `Failed to remove worktree (${res.status})`;
				return;
			}
			await fetchWorktrees();
		} catch (e: unknown) {
			actionError = e instanceof Error ? e.message : "Failed to remove worktree.";
		} finally {
			actionLoading = null;
		}
	}

	onMount(load);
</script>

<View
	title="Git"
	icon="fork"
	subtitle="Repository inspection and guarded write operations. Status and commits are read-only; stage, commit, and worktree actions are gated by a server policy that denies by default. No push, no PR, no --amend."
>
	{#snippet actions()}
		<button
			type="button"
			class="btn"
			onclick={load}
			disabled={loading || Boolean(actionLoading)}
		>
			Refresh
		</button>
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

		{#if policyNotice}
			<p class="mb-4 text-[13px] leading-relaxed text-ink-2" role="status">
				{policyNotice}
			</p>
		{/if}

		{#if actionError}
			<p class="mb-4 text-[13px] leading-relaxed text-ink-2" role="status">
				{actionError}
			</p>
		{/if}

		<div class="mb-2 flex items-center justify-between">
			<h2 class="text-[15px] font-semibold text-ink">Working tree</h2>
			<button
				type="button"
				class="btn text-[12px]"
				onclick={stageSelected}
				disabled={Boolean(actionLoading) || selectedPaths.length === 0}
			>
				Stage selected {selectedPaths.length > 0 ? `(${selectedPaths.length})` : ""}
			</button>
		</div>

		{#if !data.status.files || data.status.files.length === 0}
			<p class="text-[13px] text-ink-2" role="status">Working tree clean.</p>
		{:else}
			<div class="card overflow-x-auto">
				<table class="w-full min-w-[480px] text-left text-[12px]">
					<caption class="sr-only">Working tree changes</caption>
					<thead class="bg-panel-2 text-ink-2">
						<tr>
							<th scope="col" class="w-10 px-4 py-3 font-medium">
								<span class="sr-only">Select</span>
							</th>
							<th scope="col" class="w-20 px-4 py-3 font-medium">Status</th>
							<th scope="col" class="px-4 py-3 font-medium">Path</th>
						</tr>
					</thead>
					<tbody>
						{#each data.status.files as file}
							<tr
								class="border-t border-line hover:bg-panel-2 cursor-pointer {selectedDiffPath === file.path ? 'bg-panel-2' : ''}"
								onclick={() => selectDiff(file.path)}
							>
								<td class="w-10 px-4 py-2.5">
									<input
										type="checkbox"
										aria-label={`Select ${file.path}`}
										checked={isSelected(file.path)}
										onchange={() => toggleSelect(file.path)}
										onclick={(e) => e.stopPropagation()}
									/>
								</td>
								<td class="mono px-4 py-2.5 font-medium text-ink-2">{file.code}</td>
								<td class="mono px-4 py-2.5 text-ink">
									<button
										type="button"
										class="mono w-full text-left text-ink hover:underline"
										onclick={() => selectDiff(file.path)}
									>
										{file.path}
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if data.status.truncated}
				<p class="mt-2 text-[12px] text-ink-3">Showing the first 500 entries.</p>
			{/if}
		{/if}

		<div class="mt-6 flex flex-col gap-2">
			<div class="flex items-center justify-between">
				<h3 class="text-[14px] font-medium text-ink">
					Diff: <span class="mono text-ink-2">{selectedDiffPath ?? "No file selected"}</span>
				</h3>
				<label class="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
					<input
						type="checkbox"
						checked={diffStaged}
						onchange={(e) => toggleDiffStaged(e.currentTarget.checked)}
						disabled={Boolean(actionLoading)}
					/>
					<span>Staged changes</span>
				</label>
			</div>
			{#if actionLoading === "diff"}
				<p class="text-[13px] text-ink-2" role="status">Loading diff…</p>
			{:else if diffContent !== null}
				{#if diffContent.length === 0}
					<p class="text-[13px] text-ink-2" role="status">No changes in diff for {selectedDiffPath}.</p>
				{:else}
					<pre
						class="mono max-h-80 overflow-y-auto rounded border border-line bg-panel p-3 text-[12px] leading-relaxed text-ink whitespace-pre-wrap">{diffContent}</pre>
				{/if}
			{:else}
				<p class="text-[13px] text-ink-2" role="status">Select a row in the table above to view its diff.</p>
			{/if}
		</div>

		<section class="mt-6">
			<h2 class="mb-2 text-[15px] font-semibold text-ink">Commit changes</h2>
			<div class="flex flex-col gap-2">
				<label for="git-commit-message" class="text-[13px] font-medium text-ink-2">
					Commit message
				</label>
				<textarea
					id="git-commit-message"
					class="w-full rounded border border-line bg-panel p-2.5 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-line"
					rows="3"
					maxlength="2000"
					bind:value={commitMessage}
					placeholder="Write a commit message…"
					disabled={Boolean(actionLoading)}
				></textarea>
				<div class="flex items-center justify-between">
					<span class="text-[12px] text-ink-3">{commitMessage.length} / 2000</span>
					<button
						type="button"
						class="btn"
						onclick={commitChanges}
						disabled={isCommitDisabled}
					>
						Commit
					</button>
				</div>
				{#if lastCommitHash}
					<p class="text-[13px] text-ink" role="status">
						Committed commit <span class="mono font-medium">{lastCommitHash}</span>.
					</p>
				{/if}
			</div>
		</section>

		<section class="mt-6">
			<div class="mb-2 flex items-center justify-between">
				<h2 class="text-[15px] font-semibold text-ink">Worktrees</h2>
				<button
					type="button"
					class="btn text-[12px]"
					onclick={fetchWorktrees}
					disabled={Boolean(actionLoading)}
				>
					Refresh worktrees
				</button>
			</div>

			{#if actionLoading === "worktree-list"}
				<p class="text-[13px] text-ink-2" role="status">Loading worktrees…</p>
			{:else if !worktrees || worktrees.length === 0}
				<p class="text-[13px] text-ink-2" role="status">No worktrees configured.</p>
			{:else}
				<div class="card overflow-x-auto">
					<table class="w-full min-w-[480px] text-left text-[12px]">
						<caption class="sr-only">Git worktrees</caption>
						<thead class="bg-panel-2 text-ink-2">
							<tr>
								<th scope="col" class="px-4 py-3 font-medium">Path</th>
								<th scope="col" class="w-36 px-4 py-3 font-medium">Branch</th>
								<th scope="col" class="w-24 px-4 py-3 font-medium text-right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each worktrees as wt}
								<tr class="border-t border-line">
									<td class="mono px-4 py-2.5 text-ink">{wt.path}</td>
									<td class="mono px-4 py-2.5 text-ink-2">{wt.branch}</td>
									<td class="px-4 py-2.5 text-right">
										<button
											type="button"
											class="text-[12px] text-ink-2 hover:text-ink underline"
											onclick={() => (pendingRemove = wt.path)}
											disabled={Boolean(actionLoading)}
										>
											Remove
										</button>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<div class="mt-3 flex flex-wrap items-end gap-2">
				<div class="flex flex-col gap-1">
					<label for="worktree-path-input" class="text-[12px] font-medium text-ink-2">
						Worktree path
					</label>
					<input
						id="worktree-path-input"
						type="text"
						class="rounded border border-line bg-panel px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-line"
						placeholder="/absolute/path"
						bind:value={newWorktreePath}
						disabled={Boolean(actionLoading)}
					/>
				</div>
				<div class="flex flex-col gap-1">
					<label for="worktree-branch-input" class="text-[12px] font-medium text-ink-2">
						Branch
					</label>
					<input
						id="worktree-branch-input"
						type="text"
						class="rounded border border-line bg-panel px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-line"
						placeholder="branch-name"
						bind:value={newWorktreeBranch}
						disabled={Boolean(actionLoading)}
					/>
				</div>
				<button
					type="button"
					class="btn text-[12px]"
					onclick={addWorktree}
					disabled={Boolean(actionLoading) || !newWorktreePath.trim() || !newWorktreeBranch.trim()}
				>
					Add worktree
				</button>
			</div>
		</section>

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

	<Dialog.Root open={pendingRemove !== null} onOpenChange={(open) => !open && (pendingRemove = null)}>
		<Dialog.Portal>
			<Dialog.Overlay class="dialog-overlay" />
			<Dialog.Content class="dialog-shell w-[min(420px,calc(100vw-32px))] p-5">
				<Dialog.Title class="text-[15px] font-semibold text-ink">Remove worktree</Dialog.Title>
				<Dialog.Description class="mt-1.5 text-[13px] leading-relaxed text-ink-2">
					The worktree at <span class="mono text-ink">{pendingRemove}</span> is removed from this
					repository. The branch and its commits stay.
				</Dialog.Description>
				<div class="mt-4 flex justify-end gap-2">
					<Dialog.Close class="btn">Keep worktree</Dialog.Close>
					<button
						type="button"
						class="btn btn-solid"
						disabled={Boolean(actionLoading)}
						onclick={() => {
							const path = pendingRemove;
							pendingRemove = null;
							if (path) void removeWorktree(path);
						}}
					>
						Remove worktree
					</button>
				</div>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
</View>

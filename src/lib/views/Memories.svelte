<script lang="ts">
	import View from "#lib/View.svelte";
	import {
		MAX_MEMORIES,
		MAX_TEXT_CHARS,
		memoryStore,
	} from "#lib/memories.js";
	import {
		mergeMemories,
		toMemoryRows,
		type MemoryRow,
	} from "#lib/memory_client.js";
	import {
		shouldDualWrite,
		reconcile,
		DUAL_WRITE_FLAG,
	} from "#lib/memory_dual.js";
	import { onMount } from "svelte";
	import { useMutation, useQuery, useAuth } from "convex-svelte";
	import { env } from "$env/dynamic/public";
	import { api } from "../../convex/_generated/api.js";
	import type { Id } from "../../convex/_generated/dataModel.js";

	const cloudUrl = env.PUBLIC_CONVEX_URL;
	const auth = cloudUrl ? useAuth() : null;
	const isCloud = $derived(Boolean(cloudUrl) && auth?.isAuthenticated === true);

	const listQuery = cloudUrl
		? useQuery(api.memories.list, () => (auth?.isAuthenticated ? {} : "skip"))
		: null;
	const addMutation = cloudUrl ? useMutation(api.memories.add) : null;
	const removeMutation = cloudUrl ? useMutation(api.memories.remove) : null;
	const clearMutation = cloudUrl ? useMutation(api.memories.clear) : null;

	let localItems = $state<MemoryRow[]>([]);
	let draft = $state("");
	let error = $state("");
	let notice = $state("");
	let importing = $state(false);
	let localDualWrite = $state<string | undefined>(undefined);

	onMount(() => {
		localItems = memoryStore.all();
		try {
			const saved = localStorage.getItem(DUAL_WRITE_FLAG);
			if (saved !== null) {
				localDualWrite = saved;
			}
		} catch {
			// Storage unavailable
		}
	});

	const dualWrite = $derived(
		shouldDualWrite(
			localDualWrite ?? env.PUBLIC_MEMORY_DUAL_WRITE,
			isCloud,
		),
	);

	function toggleDualWrite() {
		const next = dualWrite.enabled ? "false" : "true";
		localDualWrite = next;
		try {
			localStorage.setItem(DUAL_WRITE_FLAG, next);
		} catch {
			// Storage unavailable
		}
	}

	const cloudItems = $derived(toMemoryRows(listQuery?.data));
	const items = $derived(isCloud ? cloudItems : localItems);
	const reconciliation = $derived(reconcile(localItems, cloudItems));
	const canImportLocal = $derived(
		isCloud &&
			!listQuery?.isLoading &&
			!listQuery?.error &&
			Array.isArray(listQuery?.data) &&
			cloudItems.length === 0 &&
			localItems.length > 0,
	);

	async function addMemory() {
		error = "";
		notice = "";
		const trimmed = draft.trim();
		if (!trimmed || trimmed.length > MAX_TEXT_CHARS) {
			error = `A memory must be 1–${MAX_TEXT_CHARS} characters.`;
			return;
		}
		if (items.length >= MAX_MEMORIES) {
			error = `Maximum of ${MAX_MEMORIES} memories reached. Remove an existing memory first.`;
			return;
		}

		if (isCloud && addMutation) {
			try {
				await addMutation({ text: trimmed });
				if (dualWrite.enabled) {
					memoryStore.add(draft);
					localItems = memoryStore.all();
				}
				draft = "";
				notice = "Memory added.";
			} catch (e: any) {
				error = e?.data?.message ?? e?.message ?? "Could not add memory.";
			}
		} else {
			const created = memoryStore.add(draft);
			if (created) {
				draft = "";
				localItems = memoryStore.all();
				notice = "Memory added.";
			} else {
				if (localItems.length >= MAX_MEMORIES) {
					error = `Maximum of ${MAX_MEMORIES} memories reached. Remove an existing memory first.`;
				} else {
					error = `A memory must be 1–${MAX_TEXT_CHARS} characters.`;
				}
			}
		}
	}

	async function removeMemory(id: string) {
		error = "";
		notice = "";
		if (isCloud && removeMutation) {
			try {
				await removeMutation({ id: id as Id<"memories"> });
				notice = "Memory removed.";
			} catch (e: any) {
				error = e?.data?.message ?? e?.message ?? "Could not remove memory.";
			}
		} else {
			if (memoryStore.remove(id)) {
				localItems = memoryStore.all();
				notice = "Memory removed.";
			} else {
				error = "Could not remove memory.";
			}
		}
	}

	async function clearAll() {
		error = "";
		notice = "";
		if (!confirm("Delete all memories? This cannot be undone.")) {
			return;
		}
		if (isCloud && clearMutation) {
			try {
				await clearMutation({});
				notice = "All memories cleared.";
			} catch (e: any) {
				error = e?.data?.message ?? e?.message ?? "Could not clear memories.";
			}
		} else {
			if (memoryStore.clear()) {
				localItems = memoryStore.all();
				notice = "All memories cleared.";
			} else {
				error = "Could not clear memories.";
			}
		}
	}

	async function importLocalMemories() {
		if (!addMutation || importing) return;
		error = "";
		notice = "";
		importing = true;
		try {
			const currentCloud = cloudItems;
			const currentLocal = memoryStore.all();
			const merge = mergeMemories(
				currentCloud.length > 0 ? currentCloud : null,
				currentLocal,
			);

			const cloudTexts = new Set(currentCloud.map((c) => c.text.trim()));
			const toImport: MemoryRow[] = [];
			let alreadyPresent =
				currentCloud.length > 0 ? currentLocal.length - merge.droppedLocal : 0;

			for (const item of currentLocal) {
				const text = item.text.trim();
				if (cloudTexts.has(text)) {
					if (currentCloud.length === 0) {
						alreadyPresent++;
					}
				} else {
					cloudTexts.add(text);
					toImport.push(item);
				}
			}

			let imported = 0;
			for (const item of toImport) {
				try {
					await addMutation({ text: item.text });
					imported++;
				} catch (e: any) {
					error = e?.data?.message ?? e?.message ?? "Could not import all memories.";
					break;
				}
			}
			if (imported > 0 || alreadyPresent > 0) {
				notice =
					alreadyPresent > 0
						? `${imported} imported, ${alreadyPresent} already present.`
						: `${imported} imported.`;
			}
		} finally {
			importing = false;
		}
	}

	function deleteLabel(text: string, index: number): string {
		if (text.length > 40) {
			return `Delete memory ${index + 1}`;
		}
		return `Delete memory: ${text}`;
	}
</script>

<View
	title="Memories"
	icon="pin"
	subtitle="Memories are attached to the next chat turn as context when a BYOK turn runs."
>
	{#snippet actions()}
		<span class="chip mono">{items.length} of {MAX_MEMORIES}</span>
		{#if isCloud}
			<button
				type="button"
				class="btn text-[11.5px]"
				onclick={toggleDualWrite}
				aria-pressed={dualWrite.enabled}
			>
				Dual write: {dualWrite.enabled ? "on" : "off"}
			</button>
		{/if}
		{#if items.length > 0}
			<button type="button" class="btn" onclick={clearAll}>Clear all</button>
		{/if}
	{/snippet}

	<p class="mb-4 text-[12.5px] leading-relaxed text-ink-2" role="status">
		{#if isCloud}
			Stored on your Convex deployment
		{:else}
			Stored in this browser only
		{/if}
	</p>

	{#if isCloud}
		{#if reconciliation.conflicts.length > 0}
			<p class="mb-3 text-[12.5px] leading-relaxed text-ink-3" role="status">
				{reconciliation.conflicts.length} note(s) mirrored locally and in cloud.
			</p>
		{/if}
		{#if reconciliation.toCloud.length > 0 && cloudItems.length > 0}
			<p class="mb-3 text-[12.5px] leading-relaxed text-ink-3" role="status">
				{reconciliation.toCloud.length} un-synced local note(s).
			</p>
		{/if}
	{/if}

	<section class="card mb-6 p-4">
		<label for="memory-draft" class="mb-1.5 block text-[13px] font-medium text-ink">
			Add a memory
		</label>
		<textarea
			id="memory-draft"
			class="field w-full text-[13px] leading-relaxed"
			rows="3"
			bind:value={draft}
			maxlength={MAX_TEXT_CHARS}
			placeholder="e.g. Always respond in concise bullet points with TypeScript examples."
		></textarea>
		<div class="mt-2.5 flex flex-wrap items-center justify-between gap-2">
			<span class="text-[11.5px] text-ink-3">
				{draft.length} / {MAX_TEXT_CHARS} characters
			</span>
			<button
				type="button"
				class="btn btn-solid"
				disabled={!draft.trim()}
				onclick={addMemory}
			>
				Add memory
			</button>
		</div>
		{#if error}
			<p class="mt-2 text-[12px] text-red-400" role="alert">{error}</p>
		{/if}
		{#if notice}
			<p class="mt-2 text-[12px] text-ink-2" role="status">{notice}</p>
		{/if}
	</section>

	<section class="flex flex-col">
		<h2 class="mb-2 text-[13px] font-semibold text-ink">Saved memories</h2>
		{#if isCloud && listQuery?.isLoading}
			<p class="text-[12.5px] text-ink-3">Loading memories…</p>
		{:else if isCloud && listQuery?.error}
			<p class="text-[12.5px] text-red-400" role="alert">
				Could not load memories: {listQuery.error.message}
			</p>
		{:else if items.length === 0}
			<div
				role="status"
				class="card flex flex-col items-center justify-center p-8 text-center text-ink-2"
			>
				<p class="text-[13px] font-medium text-ink">No memories stored yet</p>
				<p class="mt-1 max-w-[50ch] text-[12px] leading-relaxed text-ink-3">
					{#if isCloud}
						Memories are stored on your Convex deployment and attached as context to your chat turns.
					{:else}
						Add notes or preferences above. They stay on this machine and are attached as context to your chat turns.
					{/if}
				</p>
				{#if canImportLocal}
					<div class="mt-4">
						<button
							type="button"
							class="btn btn-solid"
							disabled={importing}
							onclick={importLocalMemories}
						>
							{importing ? "Importing…" : "Import local memories"}
						</button>
					</div>
				{/if}
			</div>
		{:else}
			<ul class="card m-0 list-none divide-y divide-line overflow-hidden p-0">
				{#each items as item, index (item.id)}
					<li class="flex items-start justify-between gap-4 p-3.5">
						<div class="min-w-0 flex-1">
							<p class="break-words text-[13px] leading-relaxed text-ink">
								{item.text}
							</p>
							{#if item.createdAt > 0}
								<span class="mt-1 block text-[11px] text-ink-3">
									{new Date(item.createdAt).toLocaleDateString()}
								</span>
							{/if}
						</div>
						<button
							type="button"
							class="btn shrink-0 text-[11.5px]"
							aria-label={deleteLabel(item.text, index)}
							onclick={() => removeMemory(item.id)}
						>
							Delete
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</View>

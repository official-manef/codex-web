<script lang="ts">
  import View from "#lib/View.svelte";
  import {
    MAX_MEMORIES,
    MAX_TEXT_CHARS,
    memoryStore,
    type Memory,
  } from "#lib/memories.js";
  import { onMount } from "svelte";

  let items = $state<Memory[]>([]);
  let draft = $state("");
  let error = $state("");
  let notice = $state("");

  onMount(() => {
    items = memoryStore.all();
  });

  function addMemory() {
    error = "";
    notice = "";
    const created = memoryStore.add(draft);
    if (created) {
      draft = "";
      items = memoryStore.all();
      notice = "Memory added.";
    } else {
      if (items.length >= MAX_MEMORIES) {
        error = `Maximum of ${MAX_MEMORIES} memories reached. Remove an existing memory first.`;
      } else {
        error = `A memory must be 1–${MAX_TEXT_CHARS} characters.`;
      }
    }
  }

  function removeMemory(id: string) {
    error = "";
    notice = "";
    if (memoryStore.remove(id)) {
      items = memoryStore.all();
      notice = "Memory removed.";
    } else {
      error = "Could not remove memory.";
    }
  }

  function clearAll() {
    error = "";
    notice = "";
    if (!confirm("Delete all memories? This cannot be undone.")) {
      return;
    }
    if (memoryStore.clear()) {
      items = memoryStore.all();
      notice = "All memories cleared.";
    } else {
      error = "Could not clear memories.";
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
  subtitle="Memories are stored in this browser only (localStorage), never sent to a server, and are attached to the next chat turn as context when a BYOK turn runs."
>
  {#snippet actions()}
    <span class="chip mono">{items.length} of {MAX_MEMORIES}</span>
    {#if items.length > 0}
      <button type="button" class="btn" onclick={clearAll}>Clear all</button>
    {/if}
  {/snippet}

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
    {#if items.length === 0}
      <div
        role="status"
        class="card flex flex-col items-center justify-center p-8 text-center text-ink-2"
      >
        <p class="text-[13px] font-medium text-ink">No memories stored yet</p>
        <p class="mt-1 max-w-[50ch] text-[12px] leading-relaxed text-ink-3">
          Add notes or preferences above. They stay on this machine and are attached as context to your chat turns.
        </p>
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

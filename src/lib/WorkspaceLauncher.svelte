<script lang="ts" generics="Id extends string">
  import { Icon } from "../../shared/icons/index.js";
  import {
    selectLauncherViews,
    selectRecentViews,
  } from "../../slices/workspace-shell/shared/launcher/index.js";
  let {
    outputs,
    recent = [],
    quickIds = [],
    suggestedIds = [],
    recentLabel = "",
    launcherId = "",
    onOpen,
  }: {
    outputs: readonly { id: Id; label: string; icon: string }[];
    recent?: string[];
    quickIds?: readonly string[];
    suggestedIds?: readonly string[];
    recentLabel?: string;
    launcherId?: string;
    onOpen: (id: Id) => void;
  } = $props();
  let query = $state("");
  let matches = $derived(
    outputs.filter(
      (row) =>
        row.id !== launcherId &&
        `${row.label} ${row.id}`.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
  let quick = $derived(selectLauncherViews(outputs, quickIds));
  let suggestions = $derived(selectLauncherViews(outputs, suggestedIds));
  let recentRows = $derived(selectRecentViews(outputs, recent, [launcherId]));
</script>

<section class="workspace-launcher" aria-label="Open a local tool">
  <label class="launcher-search"
    ><Icon name="search" size={16} /><input
      type="search"
      bind:value={query}
      placeholder="Find a tool"
      aria-label="Find a local tool"
    /></label
  >
  <p class="launcher-note mb-4 text-[12px] text-ink-3">
    Every tool this build registers. Opening one changes which screen you see; none of them reaches
    a server.
  </p>
  {#if query.trim()}<h2>Search results</h2>
    <div class="launcher-list">
      {#each matches as row}<button onclick={() => onOpen(row.id)}
          ><Icon name={row.icon} size={17} /><span>{row.label}</span><Icon
            name="arrowUpRight"
            size={13}
          /></button
        >{/each}
    </div>
    {#if !matches.length}<p>No tool matches that name. Clear the search to see the full list.</p>{/if}
  {:else}<h2>Tools</h2>
    <div class="launcher-quick">
      {#each quick as row}<button onclick={() => onOpen(row.id)}
          ><Icon name={row.icon} />{row.label}</button
        >{/each}
    </div>
    <h2>Suggested</h2>
    <div class="launcher-suggestions">
      {#each suggestions as row}<button onclick={() => onOpen(row.id)}
          ><span class="suggestion-symbol"><Icon name={row.icon} size={22} /></span><strong
            >{row.label}</strong
          ></button
        >{/each}
    </div>
    <h2>Recently opened</h2>
    {#if recentRows.length}<div class="launcher-list">
        {#each recentRows as row}<button onclick={() => onOpen(row.id)}
            ><Icon name={row.icon} size={17} /><span>{row.label}</span>{#if recentLabel}<small
                >{recentLabel}</small
              >{/if}</button
          >{/each}
      </div>{:else}<p>No tool has been opened yet. Whatever you open next appears here.</p>{/if}
  {/if}
</section>

<style>
  .workspace-launcher {
    width: 100%;
    max-width: 770px;
    margin: 0 auto;
    padding: 30px 20px;
    min-width: 0;
    font-size: 13px;
  }
  .launcher-search {
    display: flex;
    align-items: center;
    gap: 9px;
    background: var(--color-hover);
    border-radius: 22px;
    padding: 9px 14px;
    margin-bottom: 32px;
    color: var(--color-ink-2);
  }
  input {
    width: 100%;
    min-width: 0;
    background: transparent;
    outline: none;
    font-size: 12px;
  }
  h2 {
    font-size: 12px;
    font-weight: 600;
    margin: 24px 0 16px;
  }
  p {
    color: var(--color-ink-2);
    font-size: 12px;
  }
  .launcher-quick {
    display: flex;
    gap: 13px;
    margin-bottom: 36px;
  }
  .launcher-quick button {
    display: flex;
    align-items: center;
    gap: 9px;
    flex: 1;
    min-width: 0;
    text-align: left;
    background: var(--color-panel);
    border-radius: 8px;
    padding: 12px;
    font-size: 12px;
  }
  .launcher-suggestions {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin: 24px 0 42px;
  }
  .launcher-suggestions button {
    min-width: 0;
    padding: 8px 0;
    border-radius: 8px;
  }
  .suggestion-symbol {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    background: var(--color-hover);
    border-radius: 9px;
    margin: 0 auto 16px;
  }
  .launcher-suggestions strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 550;
  }
  .launcher-list button {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    text-align: left;
    border-bottom: 1px solid var(--color-line);
    padding: 13px 10px;
    min-width: 0;
  }
  .launcher-list span {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .launcher-list small {
    color: var(--color-ink-2);
    font-size: 11px;
  }
  button:hover {
    background: var(--color-hover);
  }
  @container (max-width:420px) {
    .workspace-launcher {
      padding: 22px 14px;
    }
    .launcher-suggestions {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .launcher-quick {
      flex-direction: column;
    }
    .launcher-list small {
      display: none;
    }
  }
</style>

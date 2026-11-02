<script module lang="ts">
  export type ComposerPickerItem = {
    id: string;
    label: string;
    description?: string;
    icon?: string;
  };
  export type ComposerPickerTab = { id: string; label: string };
</script>

<script lang="ts" generics="Item extends ComposerPickerItem">
  import { onMount, tick } from "svelte";
  import { Icon } from "$shared/icons/index.js";

  let {
    items,
    tabs,
    activeTab,
    onTabChange,
    onSelect,
    onClose,
    position,
    loading = false,
    error = "",
    selectedIndex = -1,
    onRetry,
    title = "Resources",
    emptyLabel = "No matching resources.",
  }: {
    items: readonly Item[];
    tabs: readonly ComposerPickerTab[];
    activeTab: string;
    onTabChange: (id: string) => void;
    onSelect: (item: Item) => void;
    onClose: () => void;
    position: "above" | "below";
    loading?: boolean;
    error?: string;
    selectedIndex?: number;
    onRetry?: () => void;
    title?: string;
    emptyLabel?: string;
  } = $props();
  const pickerId = $props.id();
  let picker = $state<HTMLDivElement>();
  let availableHeight = $state(360);

  function fitViewport() {
    if (!picker) return;
    const rect = picker.getBoundingClientRect();
    const space = position === "below" ? window.innerHeight - rect.top - 8 : rect.bottom - 8;
    availableHeight = Math.max(0, Math.min(360, window.innerHeight * 0.4, space));
  }
  $effect(() => {
    position;
    if (picker) void tick().then(fitViewport);
  });
  onMount(() => {
    fitViewport();
    window.addEventListener("resize", fitViewport);
    const observer = new ResizeObserver(fitViewport);
    if (picker?.parentElement) observer.observe(picker.parentElement);
    return () => {
      window.removeEventListener("resize", fitViewport);
      observer.disconnect();
    };
  });
</script>

<div
  bind:this={picker}
  class="composer-command-menu"
  class:picker-above={position === "above"}
  class:picker-below={position === "below"}
  data-position={position}
  style:max-height={`${availableHeight}px`}
  role="region"
  aria-labelledby={`${pickerId}-title`}
>
  <div class="command-menu-heading">
    <strong id={`${pickerId}-title`}>{title}</strong>
    <button
      type="button"
      class="picker-close"
      aria-label="Close picker"
      onpointerdown={(event) => event.preventDefault()}
      onclick={onClose}><Icon name="x" size={16} /></button
    >
  </div>
  {#if tabs.length}<div class="picker-tabs" role="group" aria-label={`${title} categories`}>
      {#each tabs as tab (tab.id)}<button
          type="button"
          aria-pressed={activeTab === tab.id}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => onTabChange(tab.id)}>{tab.label}</button
        >{/each}
    </div>{/if}
  <div
    id="composer-resources"
    class="picker-items"
    role="listbox"
    aria-label={title}
    aria-busy={loading}
  >
    {#each items as item, index (item.id)}<button
        type="button"
        id={`composer-resource-${index}`}
        class="picker-option"
        class:command-selected={selectedIndex === index}
        role="option"
        tabindex="-1"
        aria-selected={selectedIndex === index}
        onpointerdown={(event) => event.preventDefault()}
        onclick={() => onSelect(item)}
      >
        {#if item.icon}<Icon name={item.icon} size={16} />{/if}
        <span
          ><strong>{item.label}</strong>{#if item.description}<small>{item.description}</small
            >{/if}</span
        >
      </button>{/each}
  </div>
  {#if loading}<p class="picker-state" role="status">Loading…</p>
  {:else if !items.length && !error}<p class="picker-state">{emptyLabel}</p>{/if}
  {#if error}<div class="picker-state picker-error" role="status">
      <span>{error}</span>{#if onRetry}<button type="button" onclick={onRetry}>Retry</button>{/if}
    </div>{/if}
</div>

<style>
  .composer-command-menu {
    position: absolute;
    inset-inline: 0;
    z-index: 45;
    display: flex;
    flex-direction: column;
    min-width: 0;
    max-height: min(360px, 40vh);
    overflow: hidden;
    border: 1px solid var(--color-line);
    border-radius: var(--chat-picker-radius, 12px);
    background: var(--color-panel);
    color: var(--color-ink);
  }
  .picker-above {
    bottom: calc(100% + 8px);
  }
  .picker-below {
    top: calc(100% + 8px);
  }
  .command-menu-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    flex: none;
  }
  .command-menu-heading strong {
    font-size: 12px;
    font-weight: 600;
  }
  button {
    font: inherit;
    cursor: pointer;
  }
  .picker-close {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--color-ink-2);
  }
  .picker-tabs {
    display: flex;
    gap: 4px;
    flex: none;
    padding: 0 8px 8px;
    overflow-x: auto;
    border-bottom: 1px solid var(--color-line);
  }
  .picker-tabs button {
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 12px;
    white-space: nowrap;
    color: var(--color-ink-2);
  }
  .picker-tabs button[aria-pressed="true"] {
    background: var(--color-hover);
    color: var(--color-ink);
  }
  .picker-items {
    overflow-y: auto;
    overscroll-behavior: contain;
    min-height: 0;
    padding: 4px;
  }
  .picker-option {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 7px;
    text-align: left;
  }
  .picker-option > span {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .picker-option strong {
    font-size: 12px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .picker-option small {
    color: var(--color-ink-2);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .command-selected,
  button:hover {
    background: var(--color-hover);
  }
  .picker-state {
    margin: 0;
    padding: 9px 12px;
    font-size: 12px;
    color: var(--color-ink-2);
    flex: none;
    overflow-wrap: anywhere;
  }
  .picker-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .picker-error button {
    flex: none;
    padding: 5px 8px;
    border: 1px solid var(--color-line);
    border-radius: 6px;
    color: var(--color-ink);
  }
</style>

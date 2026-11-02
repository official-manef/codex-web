<script lang="ts">
  import type { Snippet } from "svelte";
  import { Icon } from "$shared/icons/index.js";
  let {
    label,
    expanded,
    ontoggle,
    actions,
  }: {
    label: string;
    expanded: boolean;
    ontoggle: () => void;
    actions?: Snippet;
  } = $props();
</script>

<div class="chat-group-header">
  <button type="button" class="chat-group-toggle" aria-expanded={expanded} onclick={ontoggle}>
    <span>{label}</span><span class="group-chevron" class:expanded aria-hidden="true"
      ><Icon name="chevron" size={12} /></span
    >
  </button>
  {#if actions}<div class="chat-group-actions">{@render actions()}</div>{/if}
</div>

<style>
  .chat-group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    min-height: var(--chat-group-header-height, 32px);
  }
  .chat-group-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    min-height: inherit;
    padding: 5px 8px;
    border-radius: var(--radius-card);
    color: var(--color-ink-2);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .chat-group-toggle > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group-chevron {
    display: inline-flex;
    flex: none;
    transform: rotate(-90deg);
  }
  .group-chevron.expanded {
    transform: none;
  }
  .chat-group-toggle:hover {
    color: var(--color-ink);
    background: var(--color-hover);
  }
  .chat-group-actions {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    flex: none;
  }
</style>

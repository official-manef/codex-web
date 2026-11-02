<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { Icon } from "$shared/icons/index.js";
  import type { WorkspaceMenuItem } from "./types.js";

  let { items }: { items: readonly WorkspaceMenuItem[] } = $props();
</script>

{#snippet entries(rows: readonly WorkspaceMenuItem[])}
  {#each rows as item (item.id)}
    {#if item.separatorBefore}<DropdownMenu.Separator class="workspace-menu-separator" />{/if}
    {#if item.children?.length}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger
          class="workspace-menu-item"
          disabled={item.disabled}
        >
          {#if item.icon}<Icon name={item.icon} size={15} />{/if}
          <span class="menu-text">
            <span class="menu-label">{item.label}</span>
            {#if item.description}<span class="menu-hint">{item.description}</span>{/if}
          </span>
          {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
          <span class="submenu-chevron" aria-hidden="true"><Icon name="chevron" size={13} /></span>
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent
            class="workspace-menu-content"
            sideOffset={4}
            collisionPadding={10}
            loop
          >
            {@render entries(item.children)}
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
    {:else}
      <DropdownMenu.Item
        class="workspace-menu-item"
        data-destructive={item.destructive || undefined}
        disabled={item.disabled || !item.onSelect}
        onSelect={item.onSelect}
      >
        {#if item.icon}<Icon name={item.icon} size={15} />{/if}
        <span class="menu-text">
          <span class="menu-label">{item.label}</span>
          {#if item.description}<span class="menu-hint">{item.description}</span>{/if}
        </span>
        {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
      </DropdownMenu.Item>
    {/if}
  {/each}
{/snippet}

{@render entries(items)}

<style>
  :global(.workspace-menu-item[data-destructive="true"]) {
    color: var(--color-destructive);
  }

  :global(.workspace-menu-content) {
    min-width: 200px;
    max-width: min(320px, calc(100vw - 20px));
    padding: 4px;
    border: 1px solid var(--color-line);
    border-radius: 10px;
    background: var(--color-panel-2);
    color: var(--color-ink);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.24);
    z-index: 110;
  }
  :global(.workspace-menu-item) {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 32px;
    padding: 6px 9px;
    border-radius: var(--radius-card);
    color: var(--color-ink);
    font-size: 12px;
    outline: none;
    cursor: default;
  }
  :global(.workspace-menu-item:focus-visible) {
    outline: 2px solid var(--color-ink);
    outline-offset: -2px;
  }
  :global(.workspace-menu-item[data-highlighted]),
  :global(.workspace-menu-item[data-state="open"]) {
    background: var(--color-hover);
  }
  :global(.workspace-menu-item[data-disabled]) {
    opacity: 0.45;
  }
  :global(.workspace-menu-separator) {
    height: 1px;
    margin: 4px 0;
    background: var(--color-line);
  }
  .menu-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .menu-label {
    min-width: 0;
  }
  /* A reason shown inline, so it is read by keyboard and screen reader alike instead of
     hiding behind a hover tooltip. */
  .menu-hint {
    color: var(--color-ink-3);
    font-size: 11px;
    line-height: 1.35;
    white-space: normal;
  }
  kbd {
    color: var(--color-ink-2);
    font: inherit;
    white-space: nowrap;
  }
  .submenu-chevron {
    transform: rotate(-90deg);
    display: flex;
    color: var(--color-ink-2);
  }
</style>

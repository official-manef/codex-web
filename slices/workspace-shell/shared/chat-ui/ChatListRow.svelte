<script lang="ts">
  import type { Snippet } from "svelte";
  let actionWidth = $state(0);
  let {
    children,
    actions,
    selected = false,
  }: { children: Snippet; actions?: Snippet; selected?: boolean } = $props();
</script>

<div
  class="session-row chat-list-row"
  class:session-selected={selected}
  style:--chat-row-actions-width={`${actionWidth + 9}px`}
>
  <div class="row-main">{@render children()}</div>
  {#if actions}<div class="row-actions" bind:clientWidth={actionWidth}>
      {@render actions()}
    </div>{/if}
</div>

<style>
  .chat-list-row {
    position: relative;
    min-width: 0;
    min-height: var(--chat-row-height, 34px);
    border-radius: var(--chat-row-radius, 8px);
  }
  .session-selected {
    background: var(--color-nav-active);
  }
  /* Forced colours remove the background tint that marked the active conversation. */
  @media (forced-colors: active) {
    .session-selected {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }
  .row-main {
    min-width: 0;
    display: flex;
    align-items: center;
    min-height: inherit;
  }
  .row-main :global(button) {
    width: 100%;
    text-align: left;
    min-width: 0;
    min-height: var(--chat-row-height, 34px);
    padding: 6px 8px;
    padding-right: var(--chat-row-idle-space, 8px);
    border-radius: inherit;
    display: flex;
    align-items: center;
  }
  .row-main :global(button > span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }
  .row-actions {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    opacity: var(--chat-row-idle-opacity, 0);
    pointer-events: var(--chat-row-idle-pointer-events, none);
    --row-surface: var(--color-nav, var(--color-panel));
    background: linear-gradient(
      to right,
      transparent,
      var(--row-surface) var(--chat-row-action-fade, 18px),
      var(--row-surface) calc(100% - var(--chat-row-action-fade, 18px)),
      transparent
    );
    padding-inline: var(--chat-row-action-fade, 18px);

    transition: opacity var(--chat-row-action-duration, 140ms) ease;
    border-radius: var(--chat-row-radius, 8px);
  }
  .session-selected .row-actions {
    --row-surface: var(--color-nav-active);
  }
  .chat-list-row:hover .row-actions,
  .chat-list-row:focus-within .row-actions {
    opacity: 1;
    pointer-events: auto;
  }
  .chat-list-row:hover .row-main :global(button),
  .chat-list-row:focus-within .row-main :global(button) {
    padding-right: var(--chat-row-actions-width, 62px);
  }
  .row-actions :global(button) {
    display: grid;
    place-items: center;
    min-width: 26px;
    white-space: nowrap;
    height: var(--chat-action-size, 28px);
    padding: 0 4px;
    color: var(--color-ink-2);
  }
  @media (pointer: coarse) {
    .row-actions {
      opacity: 1;
      pointer-events: auto;
    }
    .row-main :global(button) {
      padding-right: var(--chat-row-actions-width, 62px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .row-actions {
      transition: none;
    }
  }
</style>

<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    children,
    controls,
    above,
    below,
    onsubmit,
    ariaLabel = "Message composer",
    class: className = "",
    style,
  }: {
    children: Snippet;
    controls?: Snippet;
    above?: Snippet;
    below?: Snippet;
    onsubmit?: (event: SubmitEvent) => void;
    ariaLabel?: string;
    class?: string;
    style?: string;
  } = $props();

  function submit(event: SubmitEvent) {
    event.preventDefault();
    onsubmit?.(event);
  }
</script>

{#if above}{@render above()}{/if}
<form
  class={`conversation-composer chat-composer ${className}`}
  aria-label={ariaLabel}
  onsubmit={submit}
  {style}
>
  {@render children()}
  {#if controls}<div class="composer-controls">{@render controls()}</div>{/if}
</form>
{#if below}{@render below()}{/if}

<style>
  .chat-composer {
    position: relative;
    min-width: 0;
    background: var(--chat-composer-background, var(--color-composer, var(--color-panel-2)));
    border: var(--chat-composer-border-width, 0px) solid var(--chat-composer-border, transparent);
    border-radius: var(--chat-composer-radius, 22px);
    padding: var(--chat-composer-padding, 12px 12px 9px);
    color: var(--color-ink);
  }
  .chat-composer:focus-within {
    outline: 1px solid var(--chat-composer-focus, var(--color-line-strong, var(--color-ink-2)));
    outline-offset: 0;
  }
  /* Forced colours strip the custom property that made the focus ring visible; the base
     `:focus-visible` rule targets the textarea, which has `outline: none`. */
  @media (forced-colors: active) {
    .chat-composer:focus-within {
      outline: 2px solid Highlight;
    }
  }
  .chat-composer :global(textarea) {
    display: block;
    width: 100%;
    min-height: var(--chat-input-min-height, 48px);
    max-height: var(--chat-input-max-height, 180px);
    padding: 0;
    resize: none;
    font: inherit;
    font-size: var(--chat-input-size, 14px);
    line-height: 1.65;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 0;
    outline: none;
    box-shadow: none;
  }
  .chat-composer :global(textarea::placeholder) {
    color: var(--color-ink-3);
  }
  .chat-composer :global(textarea:disabled) {
    opacity: 0.6;
  }
  .chat-composer :global(.composer-controls) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    margin-top: var(--chat-controls-spacing, 8px);
    gap: var(--chat-controls-gap, 5px);
  }
  .chat-composer :global(.composer-controls > div) {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: var(--chat-controls-gap, 5px);
  }
</style>

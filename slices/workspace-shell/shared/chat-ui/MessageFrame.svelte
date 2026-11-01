<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    children,
    actions,
    time,
    datetime,
    tone = "user",
  }: {
    children: Snippet;
    actions?: Snippet;
    time?: string;
    datetime?: string;
    tone?: "user" | "assistant";
  } = $props();
</script>

<div class="chat-message" data-tone={tone}>
  <div class="chat-message-body">{@render children()}</div>
  {#if actions || time}<div class="chat-message-meta">
      {#if time}<time {datetime}>{time}</time>{/if}{#if actions}{@render actions()}{/if}
    </div>{/if}
</div>

<style>
  .chat-message {
    width: fit-content;
    max-width: var(--chat-user-width, 80%);
    margin-left: auto;
    min-width: 0;
  }
  .chat-message-body {
    padding: var(--chat-bubble-padding, 14px);
    border-radius: var(--chat-bubble-radius, 16px);
    background: var(--chat-user-background, var(--color-hover));
    color: var(--chat-user-color, var(--color-ink));
    overflow-wrap: anywhere;
  }
  .chat-message[data-tone="assistant"] {
    width: 100%;
    max-width: 100%;
    margin-left: 0;
  }
  .chat-message[data-tone="assistant"] .chat-message-body {
    background: var(--chat-assistant-background, transparent);
    color: var(--color-ink);
    border: 1px solid var(--color-line);
  }
  /* Forced colours: the user bubble's only distinction from the page was a background tint,
     which the palette swap removes; keep the outline that separates the two tones. */
  @media (forced-colors: active) {
    .chat-message-body {
      border: 1px solid CanvasText;
    }
  }
  .chat-message-meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    min-height: var(--chat-action-size, 28px);
    padding: 3px 2px 0;
    opacity: var(--chat-action-idle-opacity, 0);
    pointer-events: var(--chat-action-idle-pointer-events, none);
    color: var(--color-ink-2);
    font-size: 11px;
    transition: opacity 0.12s ease;
  }
  .chat-message[data-tone="assistant"] .chat-message-meta {
    justify-content: flex-start;
  }
  .chat-message:hover .chat-message-meta,
  .chat-message:focus-within .chat-message-meta {
    opacity: 1;
    pointer-events: auto;
  }
  .chat-message-meta :global([data-slot="button"]) {
    width: var(--chat-action-size, 28px);
    height: var(--chat-action-size, 28px);
    min-height: var(--chat-action-size, 28px);
    padding: 4px;
    color: var(--color-ink-2);
  }
  .chat-message-meta time {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  @media (pointer: coarse) {
    .chat-message-meta {
      opacity: 1;
      pointer-events: auto;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .chat-message-meta {
      transition: none;
    }
  }
</style>

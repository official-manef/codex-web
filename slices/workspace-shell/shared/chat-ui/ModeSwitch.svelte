<script lang="ts">
  let {
    modes,
    value,
    disabled = false,
    onchange,
    labels = {},
  }: {
    modes: readonly string[];
    value: string;
    disabled?: boolean;
    onchange: (id: string) => void;
    labels?: Record<string, string>;
  } = $props();
</script>

{#if modes.length > 1}<div class="chat-mode-bar">
    <div class="chat-mode-switch" role="group" aria-label="Chat modes">
      {#each modes as mode}<button
          {disabled}
          aria-pressed={value === mode}
          onclick={() => onchange(mode)}>{labels[mode] ?? mode}</button
        >{/each}
    </div>
  </div>{/if}

<style>
  .chat-mode-bar {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: var(--chat-mode-height, 52px);
    flex: none;
    order: var(--chat-mode-order, 0);
  }
  .chat-mode-switch {
    display: flex;
    padding: 2px;
    background: var(--color-panel-2);
    border-radius: 24px;
    max-width: 100%;
  }
  button {
    min-width: 0;
    min-height: 32px;
    padding: 6px 22px;
    border: 1px solid transparent;
    border-radius: 22px;
    color: var(--color-ink-2);
    font-size: 12px;
    font-weight: 600;
  }
  button[aria-pressed="true"] {
    background: var(--color-hover);
    border-color: var(--color-line);
    color: var(--color-ink);
  }
  button:disabled {
    opacity: 0.5;
  }
  button:hover {
    color: var(--color-ink);
  }
  @media (max-width: 400px) {
    button {
      padding-inline: 16px;
    }
  }
</style>

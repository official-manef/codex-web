<script lang="ts">
  import { Icon } from "$shared/icons/index.js";
  let {
    items,
    active = 0,
    disabled = false,
    max = 3,
    min = 2,
    onfocus,
    onadd,
    onremove,
    addLabel = "Add comparison",
  }: {
    items: readonly { id: string; label: string; color?: string }[];
    active?: number;
    disabled?: boolean;
    max?: number;
    min?: number;
    onfocus: (index: number) => void;
    onadd: () => void;
    onremove: (index: number) => void;
    addLabel?: string;
  } = $props();
</script>

<div class="comparison-tabs" role="group" aria-label="Comparison panels">
  <div class="comparison-tab-scroll">
    {#each items as item, index (item.id)}<div
        class="comparison-subtab"
        style:--candidate-color={item.color}
      >
        <button
          aria-label={`Focus comparison ${index + 1}`}
          aria-pressed={active === index}
          {disabled}
          onclick={() => onfocus(index)}
          ><span class="dot" aria-hidden="true"></span><span>{item.label}</span></button
        >
        {#if items.length > min}<button
            class="remove"
            aria-label={`Remove comparison ${index + 1}`}
            {disabled}
            onclick={() => onremove(index)}><Icon name="x" size={12} /></button
          >{/if}
      </div>{/each}
  </div>
  <button
    class="comparison-add"
    aria-label={addLabel}
    title={items.length >= max ? `Maximum ${max} comparison panels` : addLabel}
    disabled={disabled || items.length >= max}
    onclick={onadd}><Icon name="plus" size={16} /><span>{addLabel}</span></button
  >
</div>

<style>
  .comparison-tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    width: 100%;
  }
  .comparison-tab-scroll {
    display: flex;
    gap: 5px;
    min-width: 0;
    flex: 1;
    overflow-x: auto;
  }
  .comparison-subtab {
    display: flex;
    border: 1px solid var(--color-line);
    border-radius: 8px;
    flex: none;
    max-width: 240px;
  }
  button {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 9px;
    min-width: 0;
    font-size: 12px;
    white-space: nowrap;
  }
  button > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--candidate-color, var(--color-ink-2));
    flex: none;
  }
  button[aria-pressed="true"] {
    background: var(--color-hover);
    border-radius: 7px;
  }
  .comparison-add {
    flex: none;
    border: 1px solid var(--color-line);
    border-radius: 8px;
  }
  button:disabled {
    opacity: 0.45;
  }
  button:hover:not(:disabled) {
    background: var(--color-hover);
  }
  @media (max-width: 600px) {
    .comparison-add span {
      display: none;
    }
  }
</style>

<script lang="ts">
  import { Popover } from "bits-ui";
  import { ChevronDown, RotateCcw, Zap } from "@lucide/svelte";
  import { selectableEffortOptions, selectedEffortIndex } from "./lib/options.js";
  import type { EffortOption } from "./types.js";

  let {
    supported = false,
    options = [],
    value = "",
    label = "Reasoning effort",
    placeholder = "Select effort",
    modelLabel = "",
    resetLabel = "Reset effort",
    disabled = false,
    onchange,
    onreset,
  }: {
    supported?: boolean;
    options?: readonly EffortOption[];
    value?: string;
    label?: string;
    placeholder?: string;
    modelLabel?: string;
    resetLabel?: string;
    disabled?: boolean;
    onchange?: (value: string) => void;
    onreset?: () => void;
  } = $props();

  let available = $derived(selectableEffortOptions(options));
  let selected = $derived(selectedEffortIndex(available, value));

  function chooseIndex(event: Event) {
    const index = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isInteger(index) && available[index]) onchange?.(available[index].value);
  }
</script>

{#if supported && available.length && onchange}
  <Popover.Root>
    <Popover.Trigger class="effort-trigger" aria-label={label} {disabled}>
      <span>{selected >= 0 ? available[selected].label : placeholder}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        class="effort-popup"
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={10}
        aria-label={label}
      >
        <div class="effort-header">
          <Zap size={15} aria-hidden="true" />
          <div class="effort-title">
            <strong>{selected >= 0 ? available[selected].label : placeholder}</strong>
            {#if modelLabel}<span>{modelLabel}</span>{/if}
          </div>
          {#if onreset}<button
              type="button"
              class="effort-reset"
              aria-label={resetLabel}
              title={resetLabel}
              {disabled}
              onclick={onreset}><RotateCcw size={15} aria-hidden="true" /></button
            >{/if}
        </div>
        {#if selected >= 0}
          <input
            class="effort-slider"
            type="range"
            min="0"
            max={available.length - 1}
            step="1"
            value={selected}
            aria-label={label}
            aria-valuetext={available[selected].label}
            {disabled}
            oninput={chooseIndex}
          />
        {:else}
          <div class="effort-options" aria-label={label}>
            {#each available as option (option.value)}<button
                type="button"
                {disabled}
                onclick={() => onchange?.(option.value)}>{option.label}</button
              >{/each}
          </div>
        {/if}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

<style>
  :global(.effort-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 220px;
    padding: 5px 9px;
    border-radius: 18px;
    color: var(--color-ink-2);
    background: var(--color-hover);
    font-size: 12px;
  }
  :global(.effort-trigger span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.effort-trigger:focus-visible),
  .effort-reset:focus-visible,
  .effort-options button:focus-visible {
    outline: 2px solid var(--color-execution);
    outline-offset: 2px;
  }
  :global(.effort-trigger:disabled),
  .effort-reset:disabled,
  .effort-options button:disabled {
    opacity: 0.5;
  }
  :global(.effort-popup) {
    width: min(264px, calc(100vw - 20px));
    padding: 12px;
    border: 1px solid var(--color-line);
    border-radius: 14px;
    background: var(--color-panel-2);
    color: var(--color-ink);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.24);
    z-index: 110;
  }
  .effort-header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .effort-title {
    display: grid;
    flex: 1;
    text-align: center;
    gap: 2px;
    min-width: 0;
  }
  .effort-title strong {
    color: var(--color-execution);
    font-size: 13px;
    font-weight: 600;
  }
  .effort-title span {
    color: var(--color-ink-2);
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .effort-reset {
    display: grid;
    place-items: center;
    border-radius: var(--radius-card);
    color: var(--color-ink-2);
  }
  .effort-slider {
    width: 100%;
    margin: 14px 0 0;
    accent-color: var(--color-execution);
  }
  .effort-options {
    display: grid;
    gap: 3px;
    margin-top: 12px;
  }
  .effort-options button {
    min-height: 32px;
    border-radius: var(--radius-card);
    padding: 6px 8px;
    text-align: left;
  }
  .effort-options button:hover {
    background: var(--color-hover);
  }
</style>

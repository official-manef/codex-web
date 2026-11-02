<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { ArrowLeft, ArrowRight, RotateCw, Ellipsis } from "@lucide/svelte";
  import { WorkspaceMenuItems } from "../menu/index.js";
  import { availableBrowserActions } from "./lib/menu.js";
  import type { BrowserToolbarConfig } from "./types.js";

  let { config, address = $bindable("") }: { config: BrowserToolbarConfig; address?: string } =
    $props();
  let menu = $derived(availableBrowserActions(config.menu ?? []));

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!config.addressDisabled) config.onSubmit?.(address);
  }
</script>

<div class="browser-toolbar" role="group" aria-label="Browser controls">
  {#if config.back}<button
      type="button"
      aria-label={config.back.label}
      title={config.back.label}
      disabled={config.back.disabled}
      onclick={config.back.onSelect}><ArrowLeft size={16} /></button
    >{/if}
  {#if config.forward}<button
      type="button"
      aria-label={config.forward.label}
      title={config.forward.label}
      disabled={config.forward.disabled}
      onclick={config.forward.onSelect}><ArrowRight size={16} /></button
    >{/if}
  {#if config.reload}<button
      type="button"
      aria-label={config.reload.label}
      title={config.reload.label}
      disabled={config.reload.disabled}
      onclick={config.reload.onSelect}><RotateCw size={16} /></button
    >{/if}
  {#if config.annotate}<button
      class="annotate"
      type="button"
      disabled={config.annotate.disabled}
      aria-pressed={config.annotate.pressed}
      onclick={config.annotate.onSelect}>{config.annotate.label}</button
    >{/if}
  <form onsubmit={submit}>
    <input
      type="text"
      aria-label={config.addressLabel}
      aria-describedby={config.addressDescribedBy}
      inputmode="url"
      autocomplete="off"
      placeholder={config.addressPlaceholder ?? ""}
      bind:value={address}
      disabled={config.addressDisabled || !config.onSubmit}
    />
    {#if config.onSubmit}<button type="submit" disabled={config.addressDisabled || !address.trim()}
        >{config.submitLabel}</button
      >{/if}
  </form>
  {#if menu.length}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class="browser-menu-trigger"
        aria-label={config.menuLabel ?? "Browser menu"}
        title={config.menuLabel ?? "Browser menu"}><Ellipsis size={17} /></DropdownMenu.Trigger
      >
      <DropdownMenu.Portal
        ><DropdownMenu.Content
          class="workspace-menu-content"
          align="end"
          sideOffset={6}
          collisionPadding={10}
          loop><WorkspaceMenuItems items={menu} /></DropdownMenu.Content
        ></DropdownMenu.Portal
      >
    </DropdownMenu.Root>
  {/if}
</div>

<style>
  .browser-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 8px;
    background: var(--color-panel);
    color: var(--color-ink);
  }
  button,
  :global(.browser-menu-trigger) {
    display: grid;
    place-items: center;
    flex: none;
    min-width: 34px;
    min-height: 34px;
    border-radius: 8px;
    color: var(--color-ink-2);
  }
  button:hover,
  :global(.browser-menu-trigger:hover) {
    background: var(--color-hover);
    color: var(--color-ink);
  }
  button:disabled {
    opacity: 0.45;
  }
  form {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 8px 12px;
    border: 1px solid var(--color-line);
    border-radius: 18px;
    background: var(--color-panel-2);
    color: var(--color-ink);
    font-size: 12px;
  }
  form button {
    padding: 0 8px;
    font-size: 12px;
  }
</style>

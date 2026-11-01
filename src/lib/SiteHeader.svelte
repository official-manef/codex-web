<script lang="ts">
  import { Popover } from "bits-ui";
  import { PROJECT } from "#lib/registry.js";
  import BackendChip from "#lib/BackendChip.svelte";
  import { Icon } from "../../shared/icons/index.js";
  import { Checkbox } from "#lib/components/ui/checkbox/index.js";
  type Props = {
    backends?: any[];
    backend?: string;
    connection?: "checking" | "online" | "offline";
    title?: string;
    icon?: string;
    canClose?: boolean;
    showCompute?: boolean;
    showOptions?: boolean;
    comparison?: boolean;
    compareBackends?: string[];
    onPick?: (id: string) => void;
    onClose?: () => void;
    onComparison?: (enabled: boolean) => void;
    onComparePick?: (ids: string[]) => void;
  };
  let {
    backends = [],
    backend = "",
    connection = "checking",
    title = "Workspace",
    icon = "workflow",
    canClose = false,
    showCompute = true,
    showOptions = true,
    comparison = false,
    compareBackends = [],
    onPick = () => {},
    onClose = () => {},
    onComparison = () => {},
    onComparePick = () => {},
  }: Props = $props();
  let optionsOpen = $state(false);
  const uid = $props.id();
  $effect(() => {
    title;
    canClose;
    optionsOpen = false;
  });
  function toggleDevice(id: string, checked: boolean) {
    onComparePick(
      checked ? [...compareBackends, id] : compareBackends.filter((item) => item !== id),
    );
  }
</script>

<div class="output-header-container">
  <header class="output-header">
    <div class="output-title"><Icon name={icon} size={16} /><strong {title}>{title}</strong></div>
    <div class="header-actions">
      <span class="connection-status" role="status"
        ><span
          class:online={connection === "online"}
          class:offline={connection === "offline"}
          class="status-dot"
        ></span>{connection === "online"
          ? "Stub · no runtime"
          : connection === "checking"
            ? "Starting…"
            : "No runtime"}</span
      >
      {#if showCompute}<BackendChip {backends} {backend} {onPick} />{/if}
      {#if showOptions}<Popover.Root bind:open={optionsOpen}>
          <Popover.Trigger
            class="btn header-options-trigger"
            aria-label="Display and comparison options"
            ><Icon name="sliders" size={14} /><span class="header-options-label">Options</span
            ></Popover.Trigger
          >
          <Popover.Portal>
            <Popover.Content
              class="header-options-panel"
              side="bottom"
              align="end"
              sideOffset={8}
              collisionPadding={12}
              aria-label="Display and comparison options"
            >
              <div class="comparison-toggle">
                <Checkbox
                  id={`${uid}-compare-mode`}
                  checked={comparison}
                  onCheckedChange={(value) => onComparison(value === true)}
                /><label for={`${uid}-compare-mode`}>Compare</label>
              </div>
              {#if comparison}<fieldset class="header-device-checks">
                  <legend class="sr-only">Devices to compare</legend
                  >{#each ["CPU", "NPU", "GPU"] as device}{@const id = `local:${device.toLowerCase()}`}{@const available =
                      backends.some((b) => b.id === id && b.ready)}
                    <div
                      class="device-checkbox"
                      title={available ? `Include ${device}` : `${device} is unavailable`}
                    >
                      <Checkbox
                        id={`${uid}-compare-${device}`}
                        checked={compareBackends.includes(id)}
                        disabled={!available}
                        onCheckedChange={(value) => toggleDevice(id, value === true)}
                      /><label for={`${uid}-compare-${device}`}>{device}</label>
                    </div>{/each}
                </fieldset>{/if}
              <a class="btn" href="#models" onclick={() => (optionsOpen = false)}
                >Models & downloads</a
              >
              <a
                class="btn source-link"
                href={PROJECT.repo}
                target="_blank"
                rel="noreferrer"
                onclick={() => (optionsOpen = false)}>GitHub</a
              >
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>{/if}
      {#if canClose}<button
          class="btn close-output"
          onclick={onClose}
          aria-label="Close output panel"><Icon name="x" size={15} /></button
        >{/if}
    </div>
  </header>
</div>

<style>
  .output-header-container {
    container-type: inline-size;
    container-name: output-header;
    flex-shrink: 0;
    min-width: 0;
  }
  .output-header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 58px;
    padding: 8px 18px;
    border-bottom: 1px solid var(--color-line);
  }
  .output-title {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 9px;
    min-width: 0;
    color: var(--color-ink-2);
    font-size: 12px;
  }
  .output-title :global(svg) {
    flex-shrink: 0;
  }
  .output-title strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
  }
  .output-header .header-actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    margin-left: auto;
    gap: 8px;
  }
  .output-header :global(.backend-picker) {
    min-width: 0;
    max-width: 160px;
  }
  .output-header :global(.backend-picker .app-select-trigger) {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .close-output {
    padding: 5px;
    border-color: transparent;
  }
  :global(.header-options-trigger) {
    gap: 6px;
    min-height: 30px;
  }
  :global(.header-options-panel) {
    z-index: 95;
    display: grid;
    gap: 12px;
    padding: 16px;
    width: 270px;
    max-width: calc(100vw - 24px);
    max-height: min(var(--bits-popover-content-available-height, calc(100dvh - 24px)), 450px);
    overflow-y: auto;
    background: var(--color-panel);
    color: var(--color-ink);
    border: 1px solid var(--color-line);
    border-radius: 12px;
    font-family: var(--font-sans);
  }
  :global(.header-options-panel .header-device-checks) {
    flex-wrap: wrap;
  }
  :global(.header-options-panel > .btn) {
    justify-content: flex-start;
  }
  @container output-header (max-width: 600px) {
    .output-header {
      padding-inline: 12px;
      gap: 8px;
    }
    .output-header .connection-status {
      display: none;
    }
    .header-options-label {
      display: none;
    }
    :global(.header-options-trigger) {
      width: 30px;
      padding-inline: 6px;
    }
    .output-header .header-actions {
      gap: 5px;
    }
  }
  @container output-header (max-width: 360px) {
    .output-header :global(.backend-picker) {
      max-width: 100px;
    }
    .output-title {
      gap: 6px;
    }
    .output-title strong {
      font-size: 11px;
    }
  }
</style>

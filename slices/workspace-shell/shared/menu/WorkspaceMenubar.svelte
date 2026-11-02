<script lang="ts">
  import { Menubar } from "bits-ui";
  import { tick } from "svelte";
  import { Icon } from "$shared/icons/index.js";
  import type { WorkspaceMenuGroup, WorkspaceMenuItem } from "./types.js";

  let { menus, onBeforeOpen }: { menus: readonly WorkspaceMenuGroup[]; onBeforeOpen?: () => void } =
    $props();
  let activeMenu = $state("");
  let menubar: HTMLDivElement | null = $state(null);
  let escapeMenu = "";
  let outsideMenu = "";
  let outsideTarget: HTMLElement | null = null;
  const menubarId = $props.id();

  function beginOpen() {
    escapeMenu = "";
    outsideMenu = "";
    outsideTarget = null;
    onBeforeOpen?.();
  }
  function beforePointer() {
    if (!activeMenu) beginOpen();
  }
  function beforeKey(event: KeyboardEvent) {
    if (!activeMenu && ["Enter", " ", "ArrowDown"].includes(event.key)) beginOpen();
  }
  function rememberOutside(event: PointerEvent, id: string) {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest(".workspace-menubar, .workspace-menubar-content")
    )
      return;
    outsideMenu = id;
    const candidate = target.closest(
      "button, input, textarea, select, a[href], [contenteditable='true'], [tabindex]",
    );
    outsideTarget = candidate instanceof HTMLElement ? candidate : null;
  }
  function returnEscapeFocus(event: Event, id: string) {
    if (outsideMenu === id) {
      outsideMenu = "";
      escapeMenu = "";
      const target = outsideTarget;
      outsideTarget = null;
      // Let an outside interaction keep its own focus instead of restoring the menu trigger.
      event.preventDefault();
      if (target)
        void tick().then(() => {
          const current = document.activeElement;
          if (
            !target.isConnected ||
            target.matches(":disabled") ||
            target.closest("[inert]") ||
            !target.getClientRects().length
          )
            return;
          if (
            current === document.body ||
            current === menubar ||
            (current instanceof Element &&
              !!current.closest(".workspace-menubar, .workspace-menubar-content"))
          )
            target.focus({ preventScroll: true });
        });
      return;
    }
    if (escapeMenu !== id) return;
    escapeMenu = "";
    const trigger = Array.from(
      menubar?.querySelectorAll<HTMLButtonElement>("[data-menu-value]") ?? [],
    ).find((element) => element.dataset.menuValue === id);
    if (!trigger || trigger.disabled) return;
    event.preventDefault();
    trigger.focus();
  }
</script>

{#snippet entries(items: readonly WorkspaceMenuItem[], path: readonly string[])}
  {#each items as item (item.id)}
    {@const triggerId = `${menubarId}-${encodeURIComponent(JSON.stringify([...path, item.id]))}`}
    {#if item.separatorBefore}<Menubar.Separator class="workspace-menubar-separator" />{/if}
    {#if item.children?.length}
      <Menubar.Sub>
        <Menubar.SubTrigger id={triggerId} class="workspace-menubar-item" disabled={item.disabled}>
          {#if item.icon}<Icon name={item.icon} size={15} />{/if}
          <span class="workspace-menubar-label">{item.label}</span>
          {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
          <span class="workspace-menubar-chevron" aria-hidden="true"></span>
        </Menubar.SubTrigger>
        <Menubar.Portal>
          <Menubar.SubContent
            class="workspace-menubar-content"
            sideOffset={3}
            collisionPadding={8}
            loop
            escapeKeydownBehavior="close"
            onEscapeKeydown={() => document.getElementById(triggerId)?.focus()}
          >
            {@render entries(item.children, [...path, item.id])}
          </Menubar.SubContent>
        </Menubar.Portal>
      </Menubar.Sub>
    {:else}
      <Menubar.Item
        class="workspace-menubar-item"
        disabled={item.disabled || !item.onSelect}
        onSelect={item.onSelect}
      >
        {#if item.icon}<Icon name={item.icon} size={15} />{/if}
        <span class="workspace-menubar-label">{item.label}</span>
        {#if item.shortcut}<kbd>{item.shortcut}</kbd>{/if}
      </Menubar.Item>
    {/if}
  {/each}
{/snippet}

<Menubar.Root
  class="workspace-menubar"
  aria-label="Workspace menu"
  bind:value={activeMenu}
  bind:ref={menubar}
  onpointerdowncapture={beforePointer}
  onkeydowncapture={beforeKey}
>
  {#each menus as menu (menu.id)}
    <Menubar.Menu value={menu.id}>
      <Menubar.Trigger class="workspace-menubar-trigger">{menu.label}</Menubar.Trigger>
      <Menubar.Portal>
        <Menubar.Content
          class="workspace-menubar-content"
          align="start"
          side="bottom"
          style={menu.width && Number.isFinite(menu.width)
            ? `width: ${Math.max(160, Math.min(400, menu.width))}px`
            : undefined}
          sideOffset={4}
          collisionPadding={8}
          loop
          onInteractOutside={(event) => rememberOutside(event, menu.id)}
          onEscapeKeydown={() => (escapeMenu = menu.id)}
          onCloseAutoFocus={(event) => returnEscapeFocus(event, menu.id)}
        >
          {@render entries(menu.items, [menu.id])}
        </Menubar.Content>
      </Menubar.Portal>
    </Menubar.Menu>
  {/each}
</Menubar.Root>

<style>
  :global(.workspace-menubar) {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  :global(.workspace-menubar-trigger) {
    border: 0;
    border-radius: 7px;
    padding: 5px 8px;
    background: transparent;
    color: var(--color-ink-2);
    font: inherit;
    font-size: 12px;
    cursor: default;
  }
  :global(.workspace-menubar-trigger:hover),
  :global(.workspace-menubar-trigger[data-state="open"]),
  :global(.workspace-menubar-trigger:focus-visible) {
    background: var(--color-hover);
    color: var(--color-ink);
  }
  :global(.workspace-menubar-content) {
    z-index: 110;
    min-width: 210px;
    max-width: min(320px, calc(100vw - 16px));
    max-height: min(80vh, var(--bits-menubar-content-available-height, 80vh));
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--color-line);
    border-radius: 4px;
    background: var(--color-frame);
    color: var(--color-ink);
    box-shadow: 0 8px 22px rgb(0 0 0 / 0.28);
  }
  :global(.workspace-menubar-item) {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 28px;
    padding: 4px 8px;
    border-radius: 2px;
    outline: none;
    color: var(--color-ink);
    font-size: 12px;
    cursor: default;
  }
  /* Keyboard highlight is `data-highlighted` only; give it an indicator that survives a
     palette where --color-hover sits close to the menu background. */
  :global(.workspace-menubar-item:focus-visible) {
    outline: 2px solid var(--color-ink);
    outline-offset: -2px;
  }
  :global(.workspace-menubar-item[data-highlighted]),
  :global(.workspace-menubar-item[data-state="open"]) {
    background: var(--color-hover);
  }
  :global(.workspace-menubar-item[data-disabled]) {
    opacity: 0.45;
  }
  :global(.workspace-menubar-label) {
    flex: 1;
    min-width: 0;
  }
  :global(.workspace-menubar-item kbd) {
    color: var(--color-ink-2);
    font: inherit;
    white-space: nowrap;
  }
  :global(.workspace-menubar-chevron) {
    width: 6px;
    height: 6px;
    margin-inline-start: 3px;
    border-top: 1px solid currentColor;
    border-right: 1px solid currentColor;
    transform: rotate(45deg);
  }
  :global(.workspace-menubar-separator) {
    height: 1px;
    margin: 4px 0;
    background: var(--color-line);
  }
</style>

<script lang="ts">
  import { Dialog } from "bits-ui";
  import type { Snippet } from "svelte";
  import { Icon } from "../../shared/icons/index.js";

  type Category = { id: string; label: string; icon: string };
  type Props = {
    open?: boolean;
    selected?: string;
    categories: readonly Category[];
    onSelect?: (id: string) => void;
    children: Snippet<[string]>;
  };

  let {
    open = $bindable(false),
    selected = $bindable("chat-settings"),
    categories,
    onSelect = () => {},
    children,
  }: Props = $props();
  let search = $state("");
  // A fresh opening must not hide the category requested by another control.
  $effect(() => {
    if (!open) search = "";
  });
  let filtered = $derived(
    categories.filter((category) =>
      category.label.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  let title = $derived(
    categories.find((category) => category.id === selected)?.label ?? "Settings",
  );

  function select(id: string) {
    selected = id;
    onSelect(id);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay settings-overlay" />
    <Dialog.Content class="dialog-shell settings-window" aria-describedby={undefined}>
      <div class="settings-header">
        <Dialog.Title class="settings-title">Settings</Dialog.Title>
        <Dialog.Close class="settings-close" aria-label="Close settings" title="Close settings">
          <Icon name="x" size={17} />
        </Dialog.Close>
      </div>
      <div class="settings-body">
        <nav class="settings-nav" aria-label="Settings categories">
          <label class="sr-only" for="settings-search">Search settings</label>
          <input
            id="settings-search"
            class="field"
            type="search"
            placeholder="Search settings"
            bind:value={search}
          />
          {#each filtered as category (category.id)}
            <button
              class:current={selected === category.id}
              aria-current={selected === category.id ? "page" : undefined}
              onclick={() => select(category.id)}
              ><Icon name={category.icon} size={16} /><span>{category.label}</span></button
            >
          {:else}
            <p>No matching settings.</p>
          {/each}
        </nav>
        <section class="settings-content" aria-label={title}>
          <h2>{title}</h2>
          {@render children(selected)}
        </section>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.settings-overlay) {
    z-index: 100;
  }
  :global(.settings-window) {
    z-index: 101;
    display: flex;
    flex-direction: column;
    width: min(980px, calc(100vw - 32px));
    height: min(720px, calc(100dvh - 32px));
    min-width: 0;
    overflow: hidden;
    box-shadow: 0 18px 48px rgb(0 0 0 / 0.4);
  }
  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding: 0 16px 0 20px;
    border-bottom: 1px solid var(--color-line);
  }
  :global(.settings-title) {
    font-size: 15px;
    font-weight: 600;
  }
  :global(.settings-close) {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 7px;
    color: var(--color-ink-2);
  }
  :global(.settings-close:hover) {
    background: var(--color-hover);
    color: var(--color-ink);
  }
  .settings-body {
    display: grid;
    grid-template-columns: 225px minmax(0, 1fr);
    min-height: 0;
    flex: 1;
  }
  .settings-nav {
    overflow-y: auto;
    padding: 14px 10px;
    border-right: 1px solid var(--color-line);
  }
  .settings-nav input {
    width: 100%;
    margin-bottom: 10px;
  }
  .settings-nav button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 36px;
    padding: 7px 10px;
    border-radius: 7px;
    color: var(--color-ink-2);
    text-align: left;
  }
  .settings-nav button:hover,
  .settings-nav button.current {
    color: var(--color-ink);
    background: var(--color-nav-active);
  }
  .settings-nav p {
    padding: 0 10px;
    color: var(--color-ink-2);
  }
  .settings-content {
    min-width: 0;
    overflow: auto;
    padding: 24px 28px;
  }
  .settings-content h2 {
    margin: 0 0 22px;
    font-size: 19px;
    font-weight: 600;
  }
  @media (max-width: 600px) {
    .settings-body {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }
    .settings-nav {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      border-right: 0;
      border-bottom: 1px solid var(--color-line);
      padding: 8px;
    }
    .settings-nav input {
      width: 130px;
      min-width: 130px;
      margin: 0 4px 0 0;
    }
    .settings-nav button {
      width: auto;
      flex: 0 0 auto;
      white-space: nowrap;
    }
    .settings-content {
      padding: 20px 16px;
    }
  }
</style>

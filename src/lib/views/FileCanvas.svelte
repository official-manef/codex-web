<script lang="ts">
  import { Icon } from "../../../shared/icons/index.js";
  import RichText from "#lib/RichText.svelte";
  import PanelResizeHandle from "#lib/PanelResizeHandle.svelte";
  import { getContext, onMount, tick } from "svelte";
  import { DropdownMenu } from "bits-ui";
  import {
    WORKSPACE_RESOURCE_CONTEXT,
    type WorkspaceResourceContext,
  } from "../../../slices/workspace-shell/shared/runtime/index.js";
  const resource = getContext<WorkspaceResourceContext | undefined>(WORKSPACE_RESOURCE_CONTEXT);
  import { readDraft, saveDraft } from "#lib/drafts.js";
  import { closeFileTab, openFileTab } from "#lib/file_canvas_tabs.js";
  import {
    DEFAULT_FILE_TREE_WIDTH,
    MAX_FILE_TREE_WIDTH,
    fileTreeBounds,
    visibleFileTreeWidth,
  } from "#lib/file_canvas_layout.js";

  // Files are explicitly selected in the browser and are never sent to the runtime.
  // Read content only after the user selects an item; keep it in memory only.
  const MAX_FILES = 200;
  const MAX_BYTES = 1024 * 1024;
  let fileInput: HTMLInputElement;
  let folderInput: HTMLInputElement;
  let fileTabs = $state<HTMLDivElement>();
  let chooseFileButton = $state<HTMLButtonElement>();
  let files = $state<File[]>([]);
  let selected = $state<File | null>(null);
  let openFiles = $state<File[]>([]);
  let content = $state("");
  let query = $state("");
  let message = $state("");
  let selectionMessage = $state("");
  let loading = $state(false);
  let sourceFiles = $state<File[]>([]);
  let expanded = $state<string[]>([]);
  let treeWidth = $state(DEFAULT_FILE_TREE_WIDTH);
  let bodyWidth = $state(0);
  let treeWidthHydrated = $state(false);
  let widthBounds = $derived(fileTreeBounds(bodyWidth));
  const downloadUrls = new Set<string>();
  const downloadTimers = new Set<ReturnType<typeof setTimeout>>();
  let renderedTreeWidth = $derived(visibleFileTreeWidth(treeWidth, bodyWidth));
  onMount(() => {
    const saved = readDraft<number>("file-tree-width", DEFAULT_FILE_TREE_WIDTH);
    treeWidth =
      typeof saved === "number" && Number.isFinite(saved)
        ? Math.max(0, Math.min(MAX_FILE_TREE_WIDTH, saved))
        : DEFAULT_FILE_TREE_WIDTH;
    treeWidthHydrated = true;
    return () => {
      for (const timer of downloadTimers) clearTimeout(timer);
      for (const url of downloadUrls) URL.revokeObjectURL(url);
      downloadTimers.clear();
      downloadUrls.clear();
    };
  });
  $effect(() => {
    if (treeWidthHydrated) saveDraft("file-tree-width", treeWidth);
  });
  let revision = 0;
  let visibleFiles = $derived(
    files.filter((file) => displayPath(file).toLowerCase().includes(query.trim().toLowerCase())),
  );
  let isMarkdown = $derived(!!selected && /\.(md|markdown)$/i.test(selected.name));
  let showSource = $derived(!!selected && sourceFiles.includes(selected));
  type FileNode = { kind: "file"; name: string; file: File };
  type FolderNode = { kind: "folder"; name: string; path: string; children: TreeNode[] };
  type TreeNode = FileNode | FolderNode;
  let tree = $derived(buildTree(visibleFiles));
  onMount(() =>
    resource?.register("files", {
      toolbar: resourceToolbar,
      commands: {
        openFiles: () => fileInput.showPicker(),
        openFolder: () => folderInput.showPicker(),
      },
    }),
  );

  function buildTree(items: File[]): TreeNode[] {
    const roots: TreeNode[] = [];
    for (const file of items) {
      const parts = displayPath(file).split("/").filter(Boolean);
      let siblings = roots;
      let path = "";
      for (const part of parts.slice(0, -1)) {
        path = path ? `${path}/${part}` : part;
        let folder = siblings.find(
          (node): node is FolderNode => node.kind === "folder" && node.name === part,
        );
        if (!folder) {
          folder = { kind: "folder", name: part, path, children: [] };
          siblings.push(folder);
        }
        siblings = folder.children;
      }
      siblings.push({ kind: "file", name: parts.at(-1) || file.name, file });
    }
    return roots;
  }
  function toggleFolder(path: string) {
    expanded = expanded.includes(path)
      ? expanded.filter((item) => item !== path)
      : [...expanded, path];
  }

  function displayPath(file: File) {
    return file.webkitRelativePath || file.name;
  }
  function directoryPicker(node: HTMLInputElement) {
    node.setAttribute("webkitdirectory", "");
    node.setAttribute("directory", "");
  }
  function chooseFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const picked = input.files;
    if (!picked?.length) return;
    const combined = [...files];
    let omitted = Math.max(0, picked.length - MAX_FILES);
    let duplicates = 0;
    for (let index = 0; index < Math.min(picked.length, MAX_FILES); index++) {
      const file = picked.item(index)!;
      const duplicate = combined.some(
        (existing) =>
          displayPath(existing) === displayPath(file) &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified,
      );
      if (duplicate) {
        duplicates++;
        continue;
      }
      if (combined.length < MAX_FILES) combined.push(file);
      else omitted++;
    }
    files = combined;
    selectionMessage = [
      omitted
        ? `The file list is limited to ${MAX_FILES} files. ${omitted} additional files were not added.`
        : "",
      duplicates
        ? `${duplicates} files with matching names, paths, sizes and modification times were skipped. Clear the list to select them again.`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    input.value = "";
  }
  function clearFiles() {
    revision++;
    files = [];
    openFiles = [];
    sourceFiles = [];
    selected = null;
    content = "";
    query = "";
    expanded = [];
    message = "";
    selectionMessage = "";
    loading = false;
    void tick().then(() => chooseFileButton?.focus());
  }
  function downloadFile() {
    if (!selected) return;
    const url = URL.createObjectURL(selected);
    downloadUrls.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = selected.name;
    document.body.append(link);
    link.click();
    link.remove();
    // Revoke after the browser has consumed the local File, also on teardown.
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      downloadUrls.delete(url);
      downloadTimers.delete(timer);
    }, 1000);
    downloadTimers.add(timer);
  }
  async function openFile(file: File) {
    const current = ++revision;
    openFiles = openFileTab(openFiles, file);
    selected = file;
    content = "";
    message = "";
    loading = false;
    if (file.size > MAX_BYTES) {
      message = "This file is larger than 1 MB. Choose a smaller text file.";
      return;
    }
    loading = true;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (current !== revision) return;
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
        message = "This file is not a supported text file. Choose a text or Markdown file.";
      } else {
        content = text;
      }
    } catch (error) {
      if (current === revision)
        message =
          error instanceof TypeError
            ? "This file is not UTF-8 text. Choose a supported text or Markdown file."
            : "Could not read this file. Select it again and retry.";
    } finally {
      if (current === revision) loading = false;
    }
  }

  async function closeFile(file: File) {
    const wasSelected = selected === file;
    const next = closeFileTab(openFiles, selected, file);
    openFiles = next.tabs;
    sourceFiles = sourceFiles.filter((item) => item !== file);
    if (wasSelected) {
      if (next.selected) void openFile(next.selected);
      else {
        revision++;
        selected = null;
        content = "";
        message = "";
        loading = false;
      }
    }
    await tick();
    if (selected) {
      fileTabs?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    } else chooseFileButton?.focus();
  }

  function navigateFileTabs(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % openFiles.length;
    else if (event.key === "ArrowLeft") next = (index + openFiles.length - 1) % openFiles.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = openFiles.length - 1;
    else if (event.key === "Delete") {
      event.preventDefault();
      void closeFile(openFiles[index]);
      return;
    } else return;
    event.preventDefault();
    void openFile(openFiles[next]);
    void tick().then(() =>
      fileTabs?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus(),
    );
  }
</script>

{#snippet fileTree(nodes: TreeNode[])}
  <ul>
    {#each nodes as node, index (index)}
      <li>
        {#if node.kind === "folder"}
          <button
            aria-expanded={expanded.includes(node.path) || !!query.trim()}
            title={node.path}
            disabled={!!query.trim()}
            onclick={() => toggleFolder(node.path)}
            ><Icon name="folder" size={14} /><span>{node.name}</span></button
          >
          {#if expanded.includes(node.path) || query.trim()}
            <div class="nested">{@render fileTree(node.children)}</div>
          {/if}
        {:else}
          <button
            class:selected={selected === node.file}
            title={displayPath(node.file)}
            aria-current={selected === node.file ? "true" : undefined}
            onclick={() => openFile(node.file)}
            ><Icon name="file" size={14} /><span>{node.name}</span></button
          >
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet resourceToolbar()}
  <div class="file-toolbar" aria-label="File controls">
    <div class="breadcrumb" title={selected ? displayPath(selected) : "Files"}>
      <Icon name="folder" size={14} />
      <span class="breadcrumb-root">Files</span>
      {#if selected}<Icon name="chevronRight" size={13} /><strong>{displayPath(selected)}</strong
        >{/if}
    </div>
    <div class="toolbar-actions">
      {#if selected}
        <button
          class="quiet-button file-download"
          onclick={downloadFile}
          aria-label="Download selected file"
          title="Download selected file"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"><path d="M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5" /></svg
          >
          <span>Download</span>
        </button>
      {/if}
      {#if isMarkdown}
        <button
          class="quiet-button"
          onclick={() => {
            if (selected)
              sourceFiles = showSource
                ? sourceFiles.filter((file) => file !== selected)
                : [...sourceFiles, selected];
          }}
        >
          {showSource ? "Preview" : "View source"}
        </button>
      {/if}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="file-open-menu"
          ><Icon name="folder" size={15} /><span>Open</span><Icon
            name="chevron"
            size={13}
          /></DropdownMenu.Trigger
        >
        <DropdownMenu.Portal
          ><DropdownMenu.Content class="workspace-menu-content" align="end" sideOffset={6}>
            <DropdownMenu.Item class="workspace-menu-item" onSelect={() => fileInput.click()}
              >Open files…</DropdownMenu.Item
            >
            <DropdownMenu.Item class="workspace-menu-item" onSelect={() => folderInput.click()}
              >Open folder…</DropdownMenu.Item
            >
            {#if files.length}<DropdownMenu.Separator
                class="file-open-separator"
              /><DropdownMenu.Item class="workspace-menu-item" onSelect={clearFiles}
                >Clear files</DropdownMenu.Item
              >{/if}
          </DropdownMenu.Content></DropdownMenu.Portal
        >
      </DropdownMenu.Root>
    </div>
  </div>
{/snippet}

<section class="file-canvas" aria-label="File viewer">
  <input bind:this={fileInput} type="file" multiple hidden onchange={chooseFiles} />
  <input
    bind:this={folderInput}
    type="file"
    multiple
    hidden
    use:directoryPicker
    onchange={chooseFiles}
  />
  {#if openFiles.length}
    <div class="file-tabs" role="tablist" aria-label="Open files" bind:this={fileTabs}>
      {#each openFiles as file, index (file)}
        <div class:active={selected === file} class="file-tab" role="presentation">
          <button
            role="tab"
            id={`file-tab-${index}`}
            aria-selected={selected === file}
            aria-controls="file-view-content"
            tabindex={selected === file ? 0 : -1}
            title={displayPath(file)}
            onclick={() => openFile(file)}
            onkeydown={(event) => navigateFileTabs(event, index)}
            ><Icon name="file" size={14} /><span>{file.name}</span></button
          >
          <button
            class="close-file"
            aria-label={`Close ${displayPath(file)}`}
            onclick={() => closeFile(file)}><Icon name="x" size={13} /></button
          >
        </div>
      {/each}
    </div>
  {/if}
  {#if !resource}{@render resourceToolbar()}{/if}

  <div class="file-body" bind:clientWidth={bodyWidth}>
    <!-- A `main` inside the shell's own `main#workspace` gave the page two main landmarks; the
         unnamed inner one was the only landmark in this view with no accessible name. -->
    <div
      id="file-view-content"
      class="file-content"
      role={selected ? "tabpanel" : "region"}
      aria-label={selected ? undefined : "File content"}
      aria-labelledby={selected ? `file-tab-${openFiles.indexOf(selected)}` : undefined}
    >
      <!-- Announcing the whole panel on every tab change re-read the entire document. Only the
           short status line below is a live region. -->
      <p class="sr-only" role="status"
        >{loading
          ? "Opening file"
          : selected
            ? `Viewing ${displayPath(selected)}`
            : "No file open"}</p
      >
      {#if loading}
        <p class="notice">Opening file…</p>
      {:else if message && selected}
        <p class="notice" role="alert">{message}</p>
      {:else if selected}
        {#if isMarkdown && !showSource}
          <article class="markdown-content"><RichText text={content} /></article>
        {:else}
          <pre class="source-content"><code>{content}</code></pre>
        {/if}
      {:else}
        <div class="empty">
          <Icon name="folder" size={28} />
          <strong>Open a file</strong>
          <p>Choose files or a folder, then select a file to view it.</p>
          <p>Files stay in this browser and are not uploaded.</p>
          <button
            class="primary-button"
            bind:this={chooseFileButton}
            onclick={() => fileInput.click()}>Choose files</button
          >
        </div>
      {/if}
    </div>
    {#if widthBounds.max > widthBounds.min}
      <PanelResizeHandle
        bind:value={treeWidth}
        min={widthBounds.min}
        max={widthBounds.max}
        label="Resize file list"
      />
    {/if}
    <aside
      class="file-list"
      style:--file-list-width={`${renderedTreeWidth}px`}
      aria-label="Selected files"
    >
      <label class="search-label" for="file-canvas-filter">Filter files</label>
      <input id="file-canvas-filter" type="search" placeholder="Filter files…" bind:value={query} />
      {#if selectionMessage}<p class="list-message" role="status">{selectionMessage}</p>{/if}
      {#if !files.length}
        <p class="list-message">No files selected.</p>
      {:else if !visibleFiles.length}
        <p class="list-message">No matching files.</p>
      {:else}
        {@render fileTree(tree)}
      {/if}
    </aside>
  </div>
</section>

<style>
  .file-canvas {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--color-page);
    color: var(--color-ink);
  }
  .file-toolbar {
    min-height: 50px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 12px;
    container-type: inline-size;
  }
  .file-tabs {
    display: flex;
    min-width: 0;
    overflow-x: auto;
    gap: 6px;
    min-height: 48px;
    padding: 7px 8px;
    border-bottom: 1px solid var(--color-line);
  }
  .file-tab {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    min-width: 0;
    width: var(--workspace-tab-width, 184px);
    max-width: 240px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: 9px 9px 0 0;
    color: var(--color-ink-2);
  }
  .file-tab.active {
    background: var(--color-tab-active, var(--color-panel-2));
    border-color: var(--color-tab-active-border, var(--color-line));
    color: var(--color-ink);
  }
  .file-tab > button {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    flex: 1;
    height: 30px;
    padding: 0 7px 0 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 12px;
  }
  .file-tab > button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-tab .close-file {
    flex: 0 0 auto;
    width: 24px;
    height: 28px;
    padding: 0;
    justify-content: center;
    margin-right: 4px;
  }
  .file-tab button:hover {
    color: var(--color-ink);
    background: var(--color-hover);
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--color-ink-2);
    font-size: 12px;
  }
  .breadcrumb span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .breadcrumb {
    flex: 1;
    padding: 7px 11px;
    border-radius: 18px;
    background: var(--color-panel-2);
  }
  .breadcrumb strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 550;
    color: var(--color-ink);
  }
  .breadcrumb-root {
    flex: none;
  }
  :global(.file-open-menu) {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 32px;
    padding: 6px 9px;
    border-radius: 18px;
    background: var(--color-panel-2);
    color: var(--color-ink);
    font-size: 12px;
  }
  :global(.file-open-menu:hover) {
    background: var(--color-hover);
  }
  :global(.file-open-separator) {
    margin: 5px -4px;
    height: 1px;
    background: var(--color-line);
  }
  .toolbar-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
  }
  .quiet-button,
  .primary-button {
    border: 1px solid var(--color-line);
    border-radius: 8px;
    padding: 6px 10px;
    background: var(--color-panel-2);
    color: var(--color-ink);
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .quiet-button:hover,
  .primary-button:hover {
    background: var(--color-panel);
  }
  .file-download {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .file-body {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }
  .file-content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
  .file-list {
    width: var(--file-list-width);
    flex: 0 0 var(--file-list-width);
    min-width: 0;
    overflow: auto;
    padding: 10px 8px;
  }
  .file-list input {
    width: 100%;
    border: 1px solid var(--color-line);
    border-radius: 8px;
    padding: 7px 9px;
    background: var(--color-panel);
    color: var(--color-ink);
    font: inherit;
    font-size: 12px;
  }
  .search-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .file-list ul {
    list-style: none;
    margin: 10px 0;
    padding: 0;
  }
  .file-list .nested {
    padding-left: 12px;
  }
  .file-list .nested ul {
    margin: 0;
  }
  .file-list li button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    border-radius: 5px;
    padding: 7px 8px;
    background: transparent;
    color: var(--color-ink-2);
    text-align: left;
    cursor: pointer;
    font-size: 12px;
  }
  .file-list li button:hover,
  .file-list li button.selected {
    background: var(--color-panel-2);
    color: var(--color-ink);
  }
  .file-list li button span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list-message,
  .notice {
    color: var(--color-ink-2);
    font-size: 12px;
    line-height: 1.5;
  }
  .notice {
    margin: 24px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 100%;
    padding: 32px;
    text-align: center;
    color: var(--color-ink-2);
  }
  .empty strong {
    color: var(--color-ink);
  }
  .empty p {
    margin: 0;
    font-size: 12px;
  }
  .primary-button {
    margin-top: 8px;
  }
  .markdown-content {
    max-width: 800px;
    padding: 24px;
  }
  .source-content {
    margin: 0;
    padding: 20px;
    white-space: pre;
    overflow: auto;
    font: 12px/1.65 var(--font-mono, monospace);
  }
  @media (max-width: 500px) {
    .file-toolbar {
      align-items: flex-start;
      flex-direction: column;
    }
    .toolbar-actions {
      justify-content: flex-start;
    }
  }
</style>

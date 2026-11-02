<script lang="ts">
  import { Icon } from "../../../shared/icons/index.js";
  import { BrowserToolbar } from "../../../slices/workspace-shell/shared/browser-toolbar/index.js";
  import { DropdownMenu } from "bits-ui";
  import { getContext, onMount, onDestroy } from "svelte";
  import {
    WORKSPACE_RESOURCE_CONTEXT,
    type WorkspaceResourceContext,
  } from "../../../slices/workspace-shell/shared/runtime/index.js";
  import { env } from "$env/dynamic/public";
  import { useQuery } from "convex-svelte";
  import { api } from "../../convex/_generated/api.js";
  import { deviceTools } from "#lib/device_tools.svelte.js";
  import { displayEndpoint } from "#lib/runtime/endpoint.js";
  const resource = getContext<WorkspaceResourceContext | undefined>(WORKSPACE_RESOURCE_CONTEXT);
  onMount(() => resource?.register("browser", { toolbar: resourceToolbar }));

  /**
   * Remote browser view. Off by default: the selector appears only when the user turned the
   * tool on in Tools and a browser-kind device is paired. A remote view cannot be framed
   * with a token in a URL, so selecting one shows an honest note instead of a broken iframe.
   */
  type RemoteDevice = { _id: string; name: string; kind: string; endpoint?: string };
  const cloudUrl = env.PUBLIC_CONVEX_URL;
  let toolsEnabled = $state(false);
  let pairingLoaded = $state(false);
  onMount(() => {
    deviceTools.start();
    toolsEnabled = deviceTools.isEnabled("browser");
    pairingLoaded = true;
  });
  const remoteEnabled = $derived(Boolean(cloudUrl) && toolsEnabled && pairingLoaded);
  // One hook per component: subscribe only when this build has a backend at all.
  const paired = cloudUrl ? useQuery(api.devices.list, () => (remoteEnabled ? {} : "skip")) : null;
  const remoteDevices = $derived(
    remoteEnabled
      ? ((paired?.data ?? []) as RemoteDevice[]).filter((row) => row.kind === "browser")
      : [],
  );
  let target = $state("this-browser");
  const activeRemote = $derived(remoteDevices.find((row) => row._id === target) ?? null);
  let { onNavigate = (_id: string) => {} }: { onNavigate?: (id: string) => void } = $props();
  let address = $state("");
  let error = $state("");
  let history = $state<string[]>([]);
  let historyIndex = $state(-1);
  let revision = $state(0);
  let url = $derived(history[historyIndex] ?? "");
  let deviceToolbar = $state(false);
  let device = $state("responsive");
  let width = $state(1099);
  let height = $state(944);
  let zoom = $state("fit");
  let stageWidth = $state(800);
  let stageHeight = $state(600);
  const presets: Record<string, [number, number]> = {
    phone: [390, 844],
    tablet: [768, 1024],
    laptop: [1366, 768],
    desktop: [1920, 1080],
  };
  let viewportWidth = $derived(deviceToolbar ? width : Math.max(240, stageWidth - 24));
  let viewportHeight = $derived(deviceToolbar ? height : Math.max(240, stageHeight - 24));
  let scale = $derived(
    deviceToolbar
      ? zoom === "fit"
        ? Math.min(1, Math.max(0.1, (stageWidth - 24) / viewportWidth))
        : Number(zoom)
      : 1,
  );
  type Point = { x: number; y: number };
  let annotating = $state(false);
  let strokes = $state<Point[][]>([]);
  let drawing: number | null = null;
  let annotationSurface = $state<SVGSVGElement>();
  const exports = new Set<string>();
  onDestroy(() => exports.forEach((value) => URL.revokeObjectURL(value)));
  function validateAddress(value: string): string | null {
    const input = value.trim();
    if (
      !input ||
      input.length > 2048 ||
      /\s/.test(input) ||
      /^(?:javascript|data|file|about|chrome|edge|vbscript):/i.test(input)
    )
      return null;
    try {
      const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
      const localNames = ["localhost", "127.0.0.1", "[::1]"];
      if (
        parsed.origin === location.origin ||
        (parsed.port === location.port &&
          localNames.includes(parsed.hostname) &&
          localNames.includes(location.hostname))
      )
        return null;
      return parsed.href;
    } catch {
      return null;
    }
  }
  function resetPageState() {
    strokes = [];
    annotating = false;
    drawing = null;
    error = "";
  }
  function openWebsite(value: string) {
    const next = validateAddress(value);
    if (!next) {
      error =
        "Use an http or https address without credentials. The Laya runtime cannot be embedded.";
      return;
    }
    resetPageState();
    history = [...history.slice(0, historyIndex + 1), next].slice(-80);
    historyIndex = history.length - 1;
    address = next;
    revision++;
  }
  function step(direction: number) {
    const index = historyIndex + direction;
    if (index < 0 || index >= history.length) return;
    resetPageState();
    historyIndex = index;
    address = history[index];
    revision++;
  }
  function reload() {
    if (url) {
      resetPageState();
      revision++;
    }
  }
  function pickDevice() {
    const size = presets[device];
    if (size) [width, height] = size;
  }
  function dimension(value: string, axis: "width" | "height") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const bounded = Math.round(Math.max(240, Math.min(3840, parsed)));
    if (axis === "width") width = bounded;
    else height = bounded;
    device = "responsive";
  }
  function exportFile(content: string, type: string, name: string) {
    const blob = URL.createObjectURL(new Blob([content], { type }));
    exports.add(blob);
    const link = document.createElement("a");
    link.href = blob;
    link.download = name;
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(blob);
      exports.delete(blob);
    }, 1000);
  }
  function downloadAnnotations() {
    const paths = strokes
      .map(
        (stroke) =>
          `<polyline points="${stroke.map((p) => `${(p.x * viewportWidth).toFixed(2)},${(p.y * viewportHeight).toFixed(2)}`).join(" ")}"/>`,
      )
      .join("");
    exportFile(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${viewportWidth}" height="${viewportHeight}" viewBox="0 0 ${viewportWidth} ${viewportHeight}"><g fill="none" stroke="#a66aff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`,
      "image/svg+xml",
      "browser-annotations.svg",
    );
  }
  function point(event: PointerEvent): Point {
    const box = annotationSurface!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  }
  function beginStroke(event: PointerEvent) {
    if (event.button !== 0) return;
    drawing = event.pointerId;
    annotationSurface?.setPointerCapture(event.pointerId);
    strokes = [...strokes.slice(-63), [point(event)]];
  }
  function moveStroke(event: PointerEvent) {
    if (drawing !== event.pointerId || !strokes.length) return;
    const last = strokes[strokes.length - 1];
    if (last.length < 512) strokes = [...strokes.slice(0, -1), [...last, point(event)]];
  }
  function endStroke() {
    drawing = null;
  }
</script>

{#snippet resourceToolbar()}
  <div class="browser-navigation">
    <div class="navigation-address">
      <BrowserToolbar
        bind:address
        config={{
          back: { label: "Back", disabled: historyIndex <= 0, onSelect: () => step(-1) },
          forward: {
            label: "Forward",
            disabled: historyIndex >= history.length - 1,
            onSelect: () => step(1),
          },
          reload: { label: "Reload", disabled: !url, onSelect: reload },
          annotate: {
            label: "Annotate",
            disabled: !url,
            pressed: annotating,
            onSelect: () => (annotating = !annotating),
          },
          addressLabel: "Website address",
          addressPlaceholder: "Enter a website address",
          submitLabel: "Go",
          onSubmit: openWebsite,
        }}
      />
    </div>
    <button
      class="icon-button"
      aria-label="Plugins"
      title="Plugins"
      onclick={() => onNavigate("chat-tools")}><Icon name="layers" size={17} /></button
    >
    <DropdownMenu.Root
      ><DropdownMenu.Trigger class="icon-button" aria-label="Downloads" title="Downloads"
        ><svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></svg
        ></DropdownMenu.Trigger
      >
      <DropdownMenu.Portal
        ><DropdownMenu.Content class="browser-menu" align="end" sideOffset={6}>
          <DropdownMenu.Item
            class="browser-menu-item"
            disabled={!strokes.length}
            onSelect={downloadAnnotations}>Download annotations (SVG)</DropdownMenu.Item
          >
          <DropdownMenu.Item
            class="browser-menu-item"
            disabled={!history.length}
            onSelect={() =>
              exportFile(
                JSON.stringify({ addresses: history }, null, 2),
                "application/json",
                "browser-addresses.json",
              )}>Download address history (JSON)</DropdownMenu.Item
          >
          <div class="menu-note">Page downloads use the external browser.</div>
        </DropdownMenu.Content></DropdownMenu.Portal
      >
    </DropdownMenu.Root>
    <DropdownMenu.Root
      ><DropdownMenu.Trigger
        class="icon-button"
        aria-label="Browser options"
        title="Browser options"><Icon name="more" size={17} /></DropdownMenu.Trigger
      >
      <DropdownMenu.Portal
        ><DropdownMenu.Content class="browser-menu" align="end" sideOffset={6}>
          {#if remoteDevices.length}
            <DropdownMenu.Group>
              <DropdownMenu.GroupHeading class="menu-note"
                >View target</DropdownMenu.GroupHeading
              >
              <DropdownMenu.RadioGroup
                value={target}
                onValueChange={(value) => {
                  target = value;
                  resetPageState();
                }}
              >
                <DropdownMenu.RadioItem class="browser-menu-item" value="this-browser"
                  >This browser</DropdownMenu.RadioItem
                >
                {#each remoteDevices as row (row._id)}
                  <DropdownMenu.RadioItem class="browser-menu-item" value={row._id}
                    >{row.name}</DropdownMenu.RadioItem
                  >
                {/each}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Group>
            <DropdownMenu.Separator class="browser-menu-separator" />
          {/if}
          <DropdownMenu.CheckboxItem
            class="browser-menu-item"
            checked={deviceToolbar}
            onCheckedChange={(value) => (deviceToolbar = value)}
            >Device toolbar</DropdownMenu.CheckboxItem
          >
          <DropdownMenu.Item
            class="browser-menu-item"
            disabled={!url}
            onSelect={() => window.open(url, "_blank", "noopener,noreferrer")}
            >Open in external browser</DropdownMenu.Item
          >
          <DropdownMenu.Item class="browser-menu-item" onSelect={() => onNavigate("apps")}
            >Browser automation</DropdownMenu.Item
          >
          <DropdownMenu.Item class="browser-menu-item" onSelect={() => onNavigate("chat-tools")}
            >Plugins and integrations</DropdownMenu.Item
          >
        </DropdownMenu.Content></DropdownMenu.Portal
      >
    </DropdownMenu.Root>
  </div>
  {#if deviceToolbar}<div class="device-toolbar" aria-label="Device toolbar">
      <label
        >Dimensions: <select aria-label="Device preset" bind:value={device} onchange={pickDevice}
          ><option value="responsive">Responsive</option><option value="phone"
            >Phone · 390 × 844</option
          ><option value="tablet">Tablet · 768 × 1024</option><option value="laptop"
            >Laptop · 1366 × 768</option
          ><option value="desktop">Desktop · 1920 × 1080</option></select
        ></label
      >
      <div class="dimensions">
        <input
          aria-label="Viewport width"
          type="number"
          min="240"
          max="3840"
          value={width}
          onchange={(e) => dimension(e.currentTarget.value, "width")}
        /><span>×</span><input
          aria-label="Viewport height"
          type="number"
          min="240"
          max="3840"
          value={height}
          onchange={(e) => dimension(e.currentTarget.value, "height")}
        />
      </div>
      <button
        class="icon-button"
        aria-label="Rotate viewport"
        title="Rotate viewport"
        onclick={() => {
          [width, height] = [height, width];
          device = "responsive";
        }}
        ><svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"><path d="M5 7h14v10H5zM2 8V3h5M2 3l4 4M22 16v5h-5m5 0-4-4" /></svg
        ></button
      >
      <select aria-label="Viewport zoom" bind:value={zoom}
        ><option value="fit">Fit</option><option value="1">100%</option><option value="0.75"
          >75%</option
        ><option value="0.5">50%</option><option value="0.25">25%</option></select
      >
      <button
        class="icon-button"
        aria-label="Close device toolbar"
        title="Close device toolbar"
        onclick={() => (deviceToolbar = false)}><Icon name="x" size={15} /></button
      >
    </div>{/if}
{/snippet}

<section class="browser-canvas" aria-label="Browser preview">
  {#if !resource}{@render resourceToolbar()}{/if}
  {#if error}<p class="browser-error" role="alert">{error}</p>{/if}
  {#if activeRemote}
    <div class="remote-note" role="status">
      <p>
        <strong>{activeRemote.name}</strong>{#if activeRemote.endpoint}
          · {displayEndpoint(activeRemote.endpoint)}{/if}
      </p>
      <p>
        The remote browser view opens over this device's own authenticated session. Pairing
        tokens are not accepted in a frame URL, so the preview stays closed here until a
        token-backed URL scheme exists.
      </p>
      <button onclick={() => (target = "this-browser")}>Use this browser</button>
    </div>
  {:else if url}
    <div class="preview-note">
      Sandboxed preview · sites may block embedding. Back/Forward track addresses entered here; page
      links are not tracked. <button
        onclick={() => window.open(url, "_blank", "noopener,noreferrer")}>Open externally</button
      >
    </div>
    {#if annotating || strokes.length}<div class="annotation-tools">
        <span
          >{annotating ? "Draw over the viewport" : "Annotation overlay"} · {strokes.length} strokes</span
        ><button disabled={!strokes.length} onclick={() => (strokes = strokes.slice(0, -1))}
          >Undo stroke</button
        ><button disabled={!strokes.length} onclick={() => (strokes = [])}>Clear</button><button
          disabled={!strokes.length}
          onclick={downloadAnnotations}>Download SVG</button
        ><span>Overlay only; not a page screenshot.</span>
      </div>{/if}
    <div class="preview-stage" bind:clientWidth={stageWidth} bind:clientHeight={stageHeight}>
      <div
        class="viewport-space"
        style:width={`${viewportWidth * scale}px`}
        style:height={`${viewportHeight * scale}px`}
      >
        <div
          class="browser-viewport"
          style:width={`${viewportWidth}px`}
          style:height={`${viewportHeight}px`}
          style:transform={`scale(${scale})`}
        >
          {#key `${url}:${revision}`}<iframe
              title="Website preview"
              src={url}
              sandbox="allow-scripts allow-forms"
              referrerpolicy="no-referrer"
              allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
              onerror={() => (error = "Preview could not load. Try opening this page externally.")}
            ></iframe>{/key}
          {#if annotating || strokes.length}<svg
              bind:this={annotationSurface}
              class="annotation-surface"
              class:drawing={annotating}
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              role="application"
              aria-label="Annotation overlay"
              onpointerdown={beginStroke}
              onpointermove={moveStroke}
              onpointerup={endStroke}
              onpointercancel={endStroke}
            >
              {#each strokes as stroke}<polyline
                  points={stroke.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ")}
                  fill="none"
                  stroke="#a66aff"
                  stroke-width="3"
                  vector-effect="non-scaling-stroke"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />{/each}
            </svg>{/if}
        </div>
      </div>
    </div>
  {:else}<div class="browser-home">
      <Icon name="globe" size={32} />
      <h2>Open a website</h2>
      <p>Enter an address to preview a page, inspect responsive sizes and add local annotations.</p>
      <p>
        Sites that disallow embedding open in your external browser. Plugins configure Laya
        integrations; they do not install browser extensions.
      </p>
      <button onclick={() => onNavigate("apps")}
        ><Icon name="workflow" size={17} />Browser automation</button
      >
    </div>{/if}
</section>

<style>
  .browser-canvas {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    background: var(--color-page);
    color: var(--color-ink);
  }
  .browser-navigation {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding-right: 8px;
  }
  .navigation-address {
    min-width: 100px;
    flex: 1;
  }
  .browser-navigation button,
  /* `DropdownMenu.Trigger` renders its own element, so the scoped child selector above never
     matched it: the Downloads and Browser options triggers had no padding and measured 17x17. */
  .browser-navigation :global(.icon-button),
  .annotation-tools button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 9px;
    border-radius: 16px;
    font-size: 12px;
    white-space: nowrap;
  }
  .browser-navigation button:hover,
  .annotation-tools button:hover {
    background: var(--color-hover);
  }
  .browser-navigation :global(button[aria-pressed="true"]) {
    background: var(--color-hover);
  }
  :global(.browser-menu) {
    z-index: 110;
    max-width: calc(100vw - 16px);
    min-width: 220px;
    padding: 5px;
    border: 1px solid var(--color-line);
    border-radius: 8px;
    background: var(--color-frame);
    color: var(--color-ink);
    box-shadow: 0 8px 22px rgb(0 0 0 / 0.25);
  }
  :global(.browser-menu-item) {
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
    cursor: default;
    outline: none;
  }
  :global(.browser-menu-item[data-highlighted]) {
    background: var(--color-hover);
  }
  /* Same keyboard indicator as `.workspace-menu-item`; this menu is a separate implementation
     and never got the outline fix, so ArrowDown moved focus invisibly. */
  :global(.browser-menu-item:focus-visible) {
    outline: 2px solid var(--color-ink);
    outline-offset: -2px;
  }
  :global(.browser-menu-item[data-disabled]) {
    opacity: 0.45;
  }
  .menu-note {
    max-width: 240px;
    padding: 8px 10px;
    font-size: 11px;
    color: var(--color-ink-2);
    border-top: 1px solid var(--color-line);
  }
  :global(.browser-menu-separator) {
    height: 1px;
    margin: 4px 0;
    background: var(--color-line);
  }
  .remote-note {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    margin: 8px 12px;
    padding: 10px 12px;
    border: 1px solid var(--color-line);
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--color-ink-2);
  }
  .remote-note strong {
    color: var(--color-ink);
  }
  .remote-note p {
    margin: 0;
  }
  .remote-note button {
    padding: 6px 9px;
    border-radius: 16px;
    font-size: 12px;
    color: var(--color-ink);
  }
  .remote-note button:hover {
    background: var(--color-hover);
  }
  .device-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 6px 12px;
    border-top: 1px solid var(--color-line);
    font-size: 12px;
  }
  .device-toolbar label,
  .dimensions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .device-toolbar input {
    width: 66px;
    padding: 4px 6px;
    background: var(--color-hover);
    border: 1px solid var(--color-line);
    border-radius: var(--radius-card);
    text-align: center;
  }
  .device-toolbar select {
    min-width: 0;
    max-width: 180px;
    padding: 4px;
    background: var(--color-frame);
    color: var(--color-ink);
    border: 0;
    border-radius: var(--radius-card);
  }
  .device-toolbar .icon-button {
    padding: 4px;
  }
  .preview-note,
  .annotation-tools {
    padding: 7px 12px;
    color: var(--color-ink-2);
    font-size: 11px;
    line-height: 1.5;
    border-bottom: 1px solid var(--color-line);
  }
  .preview-note button {
    margin-left: 6px;
    text-decoration: underline;
    color: var(--color-ink);
  }
  .annotation-tools {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .preview-stage {
    flex: 1;
    min-height: 240px;
    min-width: 0;
    overflow: auto;
    padding: 12px;
    background: var(--color-frame);
  }
  .viewport-space {
    position: relative;
    margin: 0 auto;
  }
  .browser-viewport {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    background: white;
  }
  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: white;
  }
  .annotation-surface {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .annotation-surface.drawing {
    pointer-events: auto;
    touch-action: none;
    cursor: crosshair;
  }
  .browser-error {
    margin: 8px 12px;
    font-size: 12px;
    color: var(--color-ink);
  }
  .browser-home {
    width: min(100%, 720px);
    margin: 0 auto;
    padding: 40px 22px;
  }
  .browser-home h2 {
    margin: 16px 0 10px;
    font-size: 18px;
    font-weight: 600;
  }
  .browser-home p {
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-ink-2);
    margin: 10px 0;
  }
  .browser-home button {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 24px;
    padding: 9px 12px;
    border: 1px solid var(--color-line);
    border-radius: 8px;
  }
  @media (max-width: 600px) {
    .browser-navigation {
      flex-wrap: wrap;
      padding: 0 8px 6px;
    }
    .navigation-address {
      flex-basis: 100%;
    }
    .browser-navigation :global(.annotate) {
      margin-left: 4px;
    }
  }
</style>

<script lang="ts">
  import View from "#lib/View.svelte";
  import StateNote from "#lib/StateNote.svelte";
  import { deviceListState } from "#lib/view_states.js";
  import { Icon } from "../../../shared/icons/index.js";
  import { get, post, configureEndpoint } from "#lib/http.js";

  type Props = {
    backends?: any[];
    backend?: string;
    connection?: string;
    connectionError?: string;
    onPick?: (id: string) => void;
  };
  let {
    backends = [],
    backend = "",
    connection = "online",
    connectionError = "",
    onPick = () => {},
  }: Props = $props();
  let hosted = $derived(backends.filter((b) => b.kind === "byok"));
  let local = $derived(backends.filter((b) => b.kind === "local"));
  const listState = $derived(
    deviceListState({
      connection: connection as "checking" | "online" | "offline",
      backends,
    }),
  );

  let byokUrl = $state("");
  let byokKey = $state("");
  let byokModel = $state("jev");
  let endpointMessage = $state("");
  let endpointBusy = $state(false);
  async function useEndpoint() {
    if (endpointBusy) return;
    endpointBusy = true;
    try {
      const url = new URL(byokUrl);
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error("Use an http or https endpoint.");
      const result = await post("/api/workflow-provider/configure", {
        url: byokUrl,
        key: byokKey,
        model: byokModel,
      });
      if (result.error) throw new Error(result.error);
      configureEndpoint(byokUrl, byokKey, byokModel);
      byokKey = "";
      onPick("byok");
      endpointMessage =
        "Endpoint accepted for this run. Workflows ask before sending data to it.";
    } catch (e: any) {
      endpointMessage = e.message ?? "Enter a valid endpoint URL.";
    } finally {
      endpointBusy = false;
    }
  }
  async function forgetEndpoint() {
    if (endpointBusy) return;
    endpointBusy = true;
    try {
      const result = await post("/api/workflow-provider/clear", { confirm: true });
      if (result.error) throw new Error(result.error);
      configureEndpoint("", "", "");
      byokKey = "";
      endpointMessage = "Endpoint cleared. No credential is kept.";
    } catch (e: any) {
      endpointMessage = e.message ?? "Could not remove the endpoint. Try again.";
    } finally {
      endpointBusy = false;
    }
  }

  // ---- NPU driver ----
  let drv = $state<any>(null);
  $effect(() => {
    get("/api/driver")
      .then((d) => (drv = d))
      .catch(
        () =>
          (drv = {
            error: "Driver status did not load. Reload the page to try again.",
          }),
      );
  });

  // ---- device identity ----
  let dev = $state<any>(null);
  let portal = $state("https://laya.manef.dev");
  let linkMsg = $state("");
  let copied = $state(false);

  $effect(() => {
    get("/api/device")
      .then((d) => {
        dev = d;
        if (d?.portal) portal = d.portal;
      })
      .catch(() => {});
  });

  async function copyId() {
    try {
      await navigator.clipboard.writeText(dev?.id ?? "");
      copied = true;
      setTimeout(() => (copied = false), 1400);
    } catch {
      linkMsg = "Could not copy. Select the device ID and copy it manually.";
    }
  }

  async function link() {
    linkMsg = "linking…";
    try {
      const d = await post("/api/device/link", { portal });
      if (d.error) throw new Error(d.error);
      linkMsg = d.heartbeat?.ok
        ? `linked · ${d.heartbeat.detail}`
        : `saved locally · heartbeat: ${d.heartbeat?.detail ?? "not sent"}`;
      dev = await get("/api/device");
    } catch (e: any) {
      linkMsg = String(e.message ?? e);
    }
  }
</script>

<View
  title="Compute & devices"
  icon="cpu"
  subtitle="Where the forward pass would run: this machine's NPU, GPU or CPU, or an endpoint you supply. This browser build reports no local device and no driver; the desktop app is the build that has them."
>

  {#if listState === "loading"}
    <StateNote
      state="loading"
      title="Reading this build's devices"
      detail="The device list has not answered yet, so no device is listed or selected."
      fix="none"
    />
  {:else if listState === "error"}
    <StateNote
      state="error"
      title="The device list did not load"
      detail={connectionError ||
        "The runtime did not answer, so no device could be listed. A failed read is not the same as a machine with no NPU."}
      fix="you"
      action={{ label: "Check again", onclick: () => location.reload() }}
    />
  {:else if !local.length}
    <StateNote
      state="degraded"
      title="No local device is detected"
      detail="No CPU, GPU or NPU row came back for this machine. Setup check names which of the three is missing: the runtime, the decision model or the NPU driver."
      fix="build"
      action={{ label: "Open Setup check", href: "#setup" }}
    />
  {/if}
  <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
    {#each local as b}
      <button
        class="card p-4 text-left transition-colors
          {backend === b.id ? 'border-ink/40 bg-panel-2' : 'hover:bg-hover'}"
        onclick={() => onPick(b.id)}
        disabled={!b.ready}
        aria-pressed={backend === b.id}
      >
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-2 text-[13px] font-semibold">
            <span
              class="size-1.5 rounded-full {b.ready
                ? 'bg-[#43cb7a]'
                : b.present
                  ? 'bg-[#e9c93a]'
                  : 'bg-ink-3'}"
            ></span>
            {b.label}
          </span>
          {#if backend === b.id}
            <span class="chip mono">selected</span>
          {:else if (b as any).stub}
            <span class="chip">stub · not configured</span>
          {:else if !b.present}
            <span class="chip">absent</span>
          {/if}
        </div>

        <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">{b.description}</p>

        <div class="mt-3 flex flex-wrap gap-1.5">
          {#if b.latency_ms}
            <span class="chip mono">{b.latency_ms} ms</span>
          {/if}
          {#if b.compile_s}
            <span class="chip mono">compile {b.compile_s}s</span>
          {/if}
          <span class="chip mono">{b.device}</span>
        </div>
      </button>
    {/each}
  </div>

  <span class="label mt-6 mb-2 block">Your own endpoint</span>

  {#if !hosted.length}
    <StateNote
      state="degraded"
      title="No endpoint provider is set up"
      detail="In the desktop app you enter a URL, a model and a key here and the server keeps them in memory. This build has no transport to send a request through, so there is nothing to connect and the form stays closed rather than accepting input it would drop."
      fix="build"
    />
  {/if}

  {#each hosted as b}
    <div class="card p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="flex items-center gap-2 text-[13px] font-semibold">
          <span class="size-1.5 rounded-full {b.ready ? 'bg-[#43cb7a]' : 'bg-ink-3'}"></span>
          {b.label}
        </span>
        {#if backend === "byok"}
          <span class="chip mono">selected</span>
        {/if}
      </div>

      <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">{b.description}</p>

      <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label class="flex flex-col gap-1">
          <span class="label">Endpoint</span>
          <input class="field mono" bind:value={byokUrl} placeholder="https://api.example.com" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="label">Model</span>
          <input class="field mono" bind:value={byokModel} placeholder="jev" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="label">Key</span>
          <input class="field mono" type="password" bind:value={byokKey} placeholder="sk-..." />
        </label>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          class="btn btn-solid h-7"
          onclick={useEndpoint}
          disabled={endpointBusy || !byokUrl.trim()}
        >
          {endpointBusy ? "Connecting…" : "Connect provider"}
        </button>
        <button class="btn h-7" onclick={forgetEndpoint} disabled={endpointBusy}
          >Forget connection</button
        >
        <span class="text-[11px] text-ink-3">
          This build has no endpoint transport, so a key you paste is dropped rather than stored.
          Nothing is written to disk or echoed back.
        </span>
      </div>
      {#if endpointMessage}<p class="mt-2 text-[12px] text-ink-2" role="status">
          {endpointMessage}
        </p>{/if}
    </div>
  {/each}

  <span class="label mt-6 mb-2 block">NPU driver</span>

  <div class="card p-4">
    {#if !drv}
      <p class="text-[11.5px] text-ink-3">Checking the driver…</p>
    {:else if drv.error}
      <p class="message-error" role="alert">{drv.error}</p>
    {:else if !drv.present}
      <div class="flex items-center gap-2">
        <span class="size-1.5 rounded-full bg-ink-3"></span>
        <span class="text-[12.5px]">No Intel NPU detected</span>
      </div>
      <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
        {drv.reason ?? "The app falls back to GPU or CPU, or to no device at all in this build."}
      </p>
    {:else}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="flex items-center gap-2 text-[12.5px] font-semibold">
          <span
            class="size-1.5 rounded-full {drv.action === 'none'
              ? 'bg-[#43cb7a]'
              : drv.action === 'update'
                ? 'bg-[#f43e64]'
                : 'bg-[#e9c93a]'}"
          ></span>
          {drv.current}
        </span>
        <span class="chip mono">{drv.verdict ?? "unknown"}</span>
      </div>

      <div class="mt-2 flex flex-wrap gap-1.5">
        {#if drv.latest}<span class="chip mono">latest {drv.latest}</span>{/if}
        {#if drv.date}<span class="chip mono">{drv.date}</span>{/if}
        {#if drv.provider}<span class="chip mono">{drv.provider}</span>{/if}
      </div>

      <p class="mt-2 text-[11.5px] leading-relaxed text-ink-3">{drv.message}</p>

      {#if drv.action !== "none"}
        <a class="btn mt-2 h-7" href={drv.url} target="_blank" rel="noreferrer">
          Download driver
        </a>
        <p class="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
          Installing one needs administrator rights and a reboot. On an OEM laptop the vendor build
          is often the tested one, which is why this is a link and not an automatic download.
        </p>
      {/if}
    {/if}
  </div>

  <span class="label mt-6 mb-2 block">This device</span>

  <div class="card p-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="mono text-[15px] font-semibold">{dev?.id ?? "Unavailable"}</span>
      <div class="flex gap-1.5">
        <button class="btn h-6 text-[10.5px]" onclick={copyId} disabled={!dev?.id}>
          {copied ? "copied" : "copy id"}
        </button>
        {#if dev?.linked_at}
          <span class="chip mono">linked</span>
        {/if}
      </div>
    </div>

    <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
      {#if (dev as any)?.stub}
        This build reports a placeholder device id because no runtime answers it. The desktop app
        derives a real id from a machine identifier, with no name, path or key in it.
      {:else}
        Paste this ID into the portal to make this machine visible in the registry. It is a hash of
        a machine identifier, with no name, path or key in it.
      {/if}
    </p>

    <div class="mt-3 flex flex-wrap items-end gap-2">
      <label class="flex min-w-[240px] flex-1 flex-col gap-1">
        <span class="label">Portal</span>
        <input class="field mono" bind:value={portal} placeholder="https://manef.dev" />
      </label>
      <button class="btn btn-solid h-[34px]" onclick={link} disabled={!portal.trim()}>
        Link device
      </button>
    </div>

    {#if linkMsg}
      <p class="mono mt-2 text-[10.5px] text-ink-3">{linkMsg}</p>
    {/if}

    {#if dev?.heartbeat?.at}
      <p class="mono mt-1 text-[10.5px] text-ink-3">
        last heartbeat {dev.heartbeat.at} · {dev.heartbeat.detail}
      </p>
    {/if}
  </div>

  <div class="card mt-4 p-4">
    <span class="label">Hardware measurements</span>
    <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">
      This build ships no measurements. The desktop app reports measured NPU, GPU and CPU latency
      from its own benchmark run; nothing here can produce one.
    </p>
  </div>
</View>

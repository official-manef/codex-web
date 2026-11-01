<script lang="ts">
  import { onMount } from "svelte";
  import View from "#lib/View.svelte";
  import { Icon } from "../../../shared/icons/index.js";
  import Deps from "#lib/Deps.svelte";
  import RecoveryNotice from "#lib/RecoveryNotice.svelte";
  import { get } from "#lib/http.js";
  type Props = {
    backends?: any[];
    backend?: string;
    onPick?: (id: string) => void;
    onReload?: () => void;
  };
  let { backends = [], backend = "", onPick = () => {}, onReload = () => {} }: Props = $props();
  let driver = $state<any>(null);
  let health = $state<any>(null);
  let loading = $state(true);
  let error = $state("");
  async function check() {
    loading = true;
    error = "";
    health = null;
    driver = null;
    try {
      const [d, h] = await Promise.all([get("/api/driver"), get("/api/health")]);
      driver = d;
      health = h;
      if (h.error) error = h.error;
      onReload();
    } catch (e: any) {
      error =
        e.message ??
        "The health check did not answer. This build has no runtime to answer it; the desktop app does.";
    } finally {
      loading = false;
    }
  }
  onMount(check);
  let isStub = $derived(Boolean(health?.runtime === "browser-stub" || health?.stub));
  let ready = $derived(backends.filter((b) => b.kind === "local" && b.ready && !(b as any).stub));
  let npu = $derived(backends.find((b) => b.device === "NPU"));
  let checks = $derived([
    {
      title: "Local server",
      ok: health?.ok === true && !isStub,
      status: isStub ? "Not configured" : health?.ok === true ? "Ready" : "Needs attention",
      detail: isStub
        ? "No runtime answers this check. This build answers every request from a fixed stub in the page."
        : health?.ok === true
          ? "The app is connected to the server on this machine."
          : (health?.reason ??
            "No server answered. Configure one in the desktop app, then run this check again."),
    },
    {
      title: "Decision model",
      ok: ready.length > 0,
      status: ready.length > 0 ? "Ready" : isStub ? "Not configured" : "Needs attention",
      detail: ready.length
        ? `Ready on ${ready.map((b) => b.device).join(", ")}. Select one below to run an example.`
        : isStub
          ? "No decision model is loaded. Every classification in this build returns a fixed answer."
          : "No decision model is ready. Configure one before running a decision.",
    },
    {
      title: "Intel NPU",
      ok: !!npu?.ready,
      optional: true,
      status: npu?.ready ? "Ready" : "Optional · not detected",
      detail: npu?.ready
        ? "OpenVINO can use the Intel NPU for local decisions."
        : (npu?.reason ?? "No usable Intel NPU. The desktop app can fall back to a ready GPU or CPU."),
    },
    {
      title: "NPU driver",
      ok: driver?.present && driver?.action === "none",
      optional: true,
      status: driver?.present && driver?.action === "none" ? "Ready" : "Optional · unavailable",
      detail:
        driver?.error ??
        driver?.message ??
        driver?.reason ??
        "This build reads no driver. Open Compute & devices for what it can and cannot report.",
    },
  ]);
</script>

<View
  title="Setup check"
  icon="check"
  subtitle="Four checks: the server, the decision model, the NPU and its driver. This browser build has no runtime to answer any of them, so each row names the piece that is absent instead of showing a green tick."
>
  {#snippet actions()}<button class="btn" onclick={check} disabled={loading}
      >{loading ? "Checking…" : "Check again"}</button
    >{/snippet}
  {#if error}<RecoveryNotice message={error} retry={check} retryLabel="Check again" />{/if}
  <Deps />
  {#if loading}<div class="setup-loading" aria-live="polite">
      Checking the server, the decision model, the devices and the NPU driver…
    </div>{:else}
    <div class="setup-checks">
      {#each checks as c}<div class="setup-check">
          <span class:check-ok={c.ok} class="check-symbol"
            ><Icon name={c.ok ? "check" : "help"} size={17} /></span
          >
          <div>
            <h2>
              {c.title}<span
                >{c.status ?? (c.ok
                  ? "Ready"
                  : c.optional
                    ? "Optional · needs attention"
                    : "Not configured")}</span
              >
            </h2>
            <p>{c.detail}</p>
          </div>
        </div>{/each}
    </div>
    {#if driver?.present && driver?.action !== "none" && driver?.url}<a
        class="btn mt-3"
        href={driver.url}
        target="_blank"
        rel="noreferrer">Open Intel driver instructions</a
      >{/if}
    <section class="setup-device-section">
      <h2>Choose a decision device</h2>
      <p>Only a ready device can be selected. The chat has its own model and device controls.</p>
      <div class="setup-devices">
        {#if !backends.some((b) => b.kind === "local")}
          <p class="text-[12.5px] leading-relaxed text-ink-2">
            No device is reported. This build has no runtime to enumerate one, so there is nothing
            to select.
          </p>
        {/if}
        {#each backends.filter((b) => b.kind === "local") as b}<button
            class="device-option"
            class:device-selected={backend === b.id}
            onclick={() => onPick(b.id)}
            disabled={!b.ready}
            aria-pressed={backend === b.id}
            ><strong>{b.device}</strong><span
              >{(b as any).stub
                ? "Stub · no model runs here"
                : b.ready
                  ? backend === b.id
                    ? "Selected"
                    : "Ready to use"
                  : (b.reason ?? "Unavailable")}</span
            ></button
          >{/each}
      </div>
    </section>
    <div class="setup-next">
      <div>
        <h2>Run a first decision</h2>
        <p>Start from the example, read the label and its probability, then edit the input.</p>
      </div>
      <a class="btn btn-solid" href="#playground">Open Decision simulation</a><a
        class="btn"
        href="#chat">Open Chat</a
      >
    </div>
  {/if}
</View>

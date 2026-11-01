<script lang="ts">
  import { onMount, tick } from "svelte";
  import { Icon } from "../../shared/icons/index.js";
  import { get, post } from "#lib/http.js";
  import RecoveryNotice from "#lib/RecoveryNotice.svelte";
  let { placement = "header" }: { placement?: "header" | "rail" } = $props();
  let runtime = $state<any>(null);
  let open = $state(false);
  let restarting = $state(false);
  let error = $state("");
  let statusError = $state("");
  let note = $state("");
  let mounted = false;
  let statusRequest = 0;
  let container: HTMLDivElement;
  let trigger: HTMLButtonElement;
  const panelId = $props.id();
  async function close(returnFocus = false) {
    open = false;
    if (returnFocus) {
      await tick();
      trigger?.focus();
    }
  }
  function dismiss(event: PointerEvent) {
    if (open && event.target instanceof Node && !container?.contains(event.target)) close();
  }
  function escape(event: KeyboardEvent) {
    if (open && event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  }
  async function runtimeStatus() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      return await get("/api/runtime", controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
  async function requestRestart(generation: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      return await post("/api/runtime/restart", { confirm: true, generation }, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
  async function load() {
    if (restarting) return;
    const request = ++statusRequest;
    try {
      const result = await runtimeStatus();
      if (mounted && request === statusRequest && !restarting) {
        runtime = result.generation ? result : null;
        statusError = result.error ?? "";
      }
    } catch {
      if (mounted && request === statusRequest && !restarting) {
        runtime = null;
        statusError = "No runtime answered. This build has none; reload the page to try again.";
      }
    }
  }
  onMount(() => {
    mounted = true;
    load();
    const timer = setInterval(load, 15000);
    return () => {
      mounted = false;
      statusRequest++;
      clearInterval(timer);
    };
  });
  async function restart() {
    if (restarting || !runtime?.restart_available) return;
    restarting = true;
    statusRequest++;
    error = "";
    note = "Restarting Laya. Waiting for the server…";
    const generation = runtime.generation;
    try {
      const result = await requestRestart(generation);
      if (result.error) throw new Error(result.error);
      const deadline = Date.now() + 60000;
      while (mounted && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        let next = null;
        try {
          next = await runtimeStatus();
        } catch {
          /* brief disconnection is expected during a restart */
        }
        if (!mounted) return;
        if (next) {
          if (next.generation && next.generation !== generation && next.state === "running") {
            runtime = next;
            note = "Laya restarted. Reconnecting…";
            location.reload();
            return;
          }
          if (next.error && next.state === "running") throw new Error(next.error);
        }
      }
      if (mounted)
        throw new Error("The server has not reconnected. Start laya-npu.cmd and reconnect.");
    } catch (e) {
      if (mounted) {
        error = e instanceof Error ? e.message : "Restart could not complete.";
        note = "";
      }
    } finally {
      if (mounted) restarting = false;
      if (mounted) await load();
    }
  }
</script>

<svelte:window onpointerdown={dismiss} onkeydown={escape} />
<div bind:this={container} class="runtime-control" class:rail-control={placement === "rail"}>
  <button
    bind:this={trigger}
    class="btn runtime-button"
    onclick={() => {
      open = !open;
      if (open) load();
    }}
    aria-expanded={open}
    aria-controls={panelId}
    aria-label="Server controls"><Icon name="server" size={14} /><span>Server</span></button
  >
  {#if open}<section id={panelId} class="runtime-panel" aria-label="Local server controls">
      <div class="panel-title">
        <strong>Local server</strong><button
          class="btn"
          aria-label="Close server controls"
          onclick={() => close(true)}><Icon name="x" /></button
        >
      </div>
      {#if runtime}<p>Running · {Math.floor((runtime.uptime_s ?? 0) / 60)} min uptime</p>
        <p>
          Restart reloads the local runtime. Saved chats and recordings are unaffected. Copy any
          unsent text before restarting.
        </p>
        {#if runtime.blockers?.length}<p class="blocked">
            Finish or stop: {runtime.blockers.map((b: any) => b.label).join(", ")}.
          </p>{/if}
        <button
          class="btn btn-solid"
          onclick={restart}
          disabled={restarting || !runtime.restart_available}
          >{restarting ? "Restarting…" : "Restart Laya"}</button
        >
      {:else}<p>
          Server controls are unavailable, because this build has no runtime to restart. The
          desktop app is the build that has one.
        </p>
        <a class="btn" href="http://127.0.0.1:8649/">Open installed app</a><button
          class="btn"
          onclick={() => location.reload()}>Reconnect</button
        >{/if}
      {#if note}<p role="status">{note}</p>{/if}
      {#if statusError}<RecoveryNotice message={statusError} retry={load} />{/if}
      {#if error}<RecoveryNotice message={error} />{/if}
    </section>{/if}
</div>

<style>
  .rail-control .runtime-button {
    width: 36px;
    height: 36px;
    padding: 0;
    justify-content: center;
    border-color: transparent;
  }
  .rail-control .runtime-button span {
    display: none;
  }
  .rail-control .runtime-panel {
    top: auto;
    bottom: 14px;
    left: 56px;
    right: auto;
    width: min(360px, calc(100vw - 70px));
  }
  .runtime-control {
    position: relative;
  }
  .runtime-button {
    height: 30px;
    gap: 6px;
  }
  .runtime-panel {
    position: fixed;
    z-index: 70;
    right: 20px;
    top: 58px;
    width: min(360px, calc(100vw - 40px));
    box-sizing: border-box;
    max-height: calc(100dvh - 84px);
    overflow-y: auto;
    overflow-wrap: anywhere;
    padding: 16px;
    border: 1px solid var(--color-line);
    border-radius: 12px;
    background: var(--color-panel);
    box-shadow: 0 12px 32px #0006;
    color: var(--color-ink);
    font-size: 12px;
    line-height: 1.6;
  }
  .panel-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .panel-title .btn {
    width: 28px;
    height: 28px;
    padding: 0;
  }
  p {
    margin: 10px 0;
    color: var(--color-ink-2);
  }
  .blocked {
    color: var(--color-ink);
  }
  .runtime-panel > .btn {
    margin: 4px 5px 4px 0;
    min-height: 32px;
  }
  @media (max-width: 600px) {
    .runtime-button span {
      display: none;
    }
  }
</style>

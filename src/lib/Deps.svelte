<script lang="ts">
  import { onMount } from "svelte";
  import { Icon } from "../../shared/icons/index.js";
  import { get, post } from "#lib/http.js";

  type Pkg = {
    name: string;
    requirement: string;
    present: boolean;
    version: string | null;
    why: string;
    needed_by: string[];
    size_mb: number;
    bulk: boolean;
  };
  type Deps = {
    python: string;
    interpreter: string;
    packages: Pkg[];
    missing: string[];
    required_missing: string[];
    job: { state: string; packages?: string[]; error?: string | null; note?: string };
    note: string;
    stub?: boolean;
  };

  let st = $state<Deps | null>(null);
  let busy = $state(false);
  let msg = $state("");
  let open = $state(false);

  async function load() {
    try {
      st = await get<Deps>("/api/deps");
    } catch {
      msg = "Dependency status did not load. Reload the page to try again.";
    }
  }

  async function install(names: string[]) {
    if (!names.length) return;
    busy = true;
    msg = "";
    try {
      const job = await post<any>("/api/deps/install", { packages: names });
      if (job.error) throw new Error(job.error);
      poll();
    } catch (e: any) {
      msg = e.message ?? "Install failed to start.";
      busy = false;
    }
  }

  function poll() {
    // pip is slow and the request would time out, so the install runs as a job and the
    // page watches its state instead of waiting on one response.
    const t = setInterval(async () => {
      try {
        const next = await get<Deps>("/api/deps");
        st = next;
        if (next.job.state !== "running") {
          clearInterval(t);
          busy = false;
          msg =
            next.job.state === "done"
              ? "Installed. Restart the app so the new packages load."
              : (next.job.error ?? "Install failed.");
          await load();
        }
      } catch {
        /* one failed poll is not a failed install */
      }
    }, 2000);
  }

  onMount(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  });

  let missing = $derived(st?.packages.filter((p) => !p.present && !p.bulk) ?? []);
  let small = $derived(missing.filter((p) => p.size_mb <= 40));
  let heavy = $derived(missing.filter((p) => p.size_mb > 40));
  let totalMb = $derived(missing.reduce((n, p) => n + p.size_mb, 0));
</script>

<div class="deps">
  <div class="deps-head">
    <button class="deps-toggle" onclick={() => (open = !open)} aria-expanded={open}>
      <span class="deps-dot" class:ok={missing.length === 0 && !st?.stub} class:warn={!st?.stub && missing.length > 0}></span>
      <span>
        {#if !st}
          Checking dependencies…
        {:else if st.stub}
          No dependency report: this build runs in the browser
        {:else if missing.length === 0}
          All dependencies installed
        {:else}
          {missing.length} package{missing.length === 1 ? "" : "s"} missing · about {totalMb} MB
        {/if}
      </span>
      <span class="deps-chev" class:rot={open}><Icon name="chevron" size={13} /></span>
    </button>
    {#if small.length > 0 && !busy && !st?.stub}
      <button class="btn btn-solid h-7" onclick={() => install(small.map((p) => p.name))}>
        Install the small ones ({small.reduce((n, p) => n + p.size_mb, 0)} MB)
      </button>
    {/if}
    {#if busy}
      <span class="deps-busy"
        >Installing {st?.job.packages?.join(", ") ?? "…"}. This can take a few minutes.</span
      >
    {/if}
  </div>

  {#if msg}<p class="deps-msg">{msg}</p>{/if}

  {#if open && st}
    {#if st.stub}
      <p class="deps-sub">
        No server or Python runtime is configured. This browser build answers every request from a stub in the page.
      </p>
    {:else}
      <p class="deps-sub">
        Python {st.python}. These are Python packages the app needs; models are separate and live
        under your home folder. Packages install into this interpreter:
        <code class="mono">{st.interpreter}</code>
      </p>

      <div class="deps-list">
        {#each st.packages as p}
          <div class="deps-row" class:absent={!p.present}>
            <span class="deps-mark" class:ok={p.present} class:warn={!p.present}>
              {p.present ? "ok" : "!"}
            </span>
            <div class="deps-body">
              <div class="deps-name">
                <code class="mono">{p.name}</code>
                {#if p.version}<span class="deps-ver">{p.version}</span>{/if}
                {#if p.bulk}<span class="deps-tag">large, opt-in</span>{/if}
              </div>
              <p class="deps-why">{p.why}</p>
              <p class="deps-meta">
                needs it: {p.needed_by.join(", ")} · {p.size_mb} MB
              </p>
            </div>
            {#if !p.present && !p.bulk}
              <button class="btn h-6 !text-[10.5px]" onclick={() => install([p.name])} disabled={busy}
                >Install</button
              >
            {/if}
          </div>
        {/each}
      </div>

      {#if heavy.length > 0}
        <p class="deps-note">
          {heavy.length} larger package{heavy.length === 1 ? "" : "s"} not installed ({heavy
            .map((p) => p.name)
            .join(", ")}). Features listed above need these packages. Use their Install buttons to
          download them.
        </p>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .deps {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    margin-bottom: 14px;
    overflow: hidden;
  }
  .deps-head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 13px;
  }
  .deps-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    color: var(--ink);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .deps-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex: none;
  }
  .deps-dot.ok {
    background: #43cb7a;
  }
  .deps-dot.warn {
    background: #e9c93a;
  }
  .deps-chev {
    color: var(--ink-3);
    display: flex;
    transition: transform 0.12s;
  }
  .deps-chev.rot {
    transform: rotate(180deg);
  }
  .deps-busy {
    font-size: 11px;
    color: #e9c93a;
  }
  .deps-msg {
    padding: 0 13px 10px;
    font-size: 11.5px;
    color: var(--ink-2);
  }
  .deps-sub {
    padding: 0 13px 10px;
    font-size: 11px;
    line-height: 1.6;
    color: var(--ink-3);
  }
  .deps-list {
    border-top: 1px solid var(--line);
  }
  .deps-row {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 9px 13px;
    border-bottom: 1px solid var(--line);
  }
  .deps-row:last-child {
    border-bottom: 0;
  }
  .deps-mark {
    font-family: var(--mono);
    font-size: 9.5px;
    padding: 1px 4px;
    border-radius: 3px;
    flex: none;
    margin-top: 1px;
  }
  .deps-mark.ok {
    color: #43cb7a;
    background: #10231a;
  }
  .deps-mark.warn {
    color: #e9c93a;
    background: #241f0e;
  }
  .deps-body {
    flex: 1;
    min-width: 0;
  }
  .deps-name {
    display: flex;
    align-items: baseline;
    gap: 7px;
    flex-wrap: wrap;
    font-size: 11.5px;
  }
  .deps-ver {
    font-family: var(--mono);
    font-size: 9.5px;
    color: var(--ink-3);
  }
  .deps-tag {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--ink-3);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 0 4px;
  }
  .deps-why {
    font-size: 11px;
    color: var(--ink-2);
    line-height: 1.5;
    margin-top: 2px;
  }
  .deps-meta {
    font-size: 10px;
    color: var(--ink-3);
    margin-top: 2px;
  }
  .deps-note {
    padding: 9px 13px;
    font-size: 10.5px;
    color: var(--ink-3);
    border-top: 1px solid var(--line);
  }
</style>

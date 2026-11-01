<script lang="ts">
  import View from "#lib/View.svelte";
  import { Icon } from "../../../shared/icons/index.js";
  import RecoveryNotice from "#lib/RecoveryNotice.svelte";
  import ModelCapabilities from "#lib/ModelCapabilities.svelte";
  import { get, post } from "#lib/http.js";
  import { onMount } from "svelte";
  import { readDraft, saveDraft } from "#lib/drafts.js";

  type Props = { onReload?: () => void };
  let { onReload = () => {} }: Props = $props();

  let cat = $state<any>(null);
  let job = $state<any>({ state: "idle" });
  let loading = $state(true);
  let err = $state("");

  // free-form input
  let repoInput = $state("");
  let probe = $state<any>(null);
  let probing = $state(false);
  let force = $state(false);
  let recommendations = $state<any>(null);
  let recommendationError = $state("");
  let recommendationTask = $state("decision");
  let recommendationDevice = $state("");
  let recommendationLoading = $state(false);
  let recommendationAction = $state("");
  let recommendationNotice = $state("");
  let recommendationVersion = 0;
  let mounted = true;
  let hydrated = $state(false);
  const recommendationTasks = [
    ["decision", "Typed decisions"],
    ["chat", "Chat"],
    ["speech", "Speech to text"],
    ["embedding", "Search by meaning"],
    ["vision", "Image understanding"],
  ];
  onMount(() => {
    mounted = true;
    const saved = readDraft<any>("model-recommendations", null);
    if (saved && recommendationTasks.some(([id]) => id === saved.task))
      recommendationTask = saved.task;
    if (saved && ["", "NPU", "GPU", "CPU"].includes(saved.device))
      recommendationDevice = saved.device;
    hydrated = true;
    refreshRecommendations();
    return () => {
      mounted = false;
      recommendationVersion++;
    };
  });
  $effect(() => {
    if (hydrated)
      saveDraft("model-recommendations", {
        task: recommendationTask,
        device: recommendationDevice,
      });
  });
  async function refreshRecommendations() {
    const version = ++recommendationVersion;
    recommendationLoading = true;
    recommendations = null;
    recommendationError = "";
    const query = new URLSearchParams({
      task: recommendationTask,
      ...(recommendationDevice ? { device: recommendationDevice } : {}),
    });
    try {
      const result = await get(`/api/models/recommendations?${query}`);
      if (!mounted || version !== recommendationVersion) return;
      if (result.error) throw new Error(result.error);
      recommendations = result;
    } catch (e) {
      if (mounted && version === recommendationVersion)
        recommendationError =
          e instanceof Error ? e.message : "Could not check model compatibility.";
    } finally {
      if (mounted && version === recommendationVersion) recommendationLoading = false;
    }
  }
  function recommendationDownload(row: any) {
    if (row.id === "laya-decision" && row.action?.payload?.repo === "rupeshs/laya-ov-int8")
      return { endpoint: "/api/models/download", payload: { repo: "rupeshs/laya-ov-int8" } };
    if (["qwen3-npu", "qwen3-general"].includes(row.id) && row.action?.payload?.model_id === row.id)
      return { endpoint: "/api/chat/download", payload: { model_id: row.id } };
    if (row.id === "minilm-embedding") return { endpoint: "/api/embeddings/install", payload: {} };
    return null;
  }
  async function downloadRecommendation(row: any) {
    const action = row && recommendationDownload(row);
    if (!action || recommendationAction) return;
    recommendationAction = row.id;
    recommendationError = "";
    recommendationNotice = "";
    try {
      const result = await post(action.endpoint, action.payload);
      if (!mounted) return;
      if (result.error) throw new Error(result.error);
      recommendationNotice =
        "Download requested. Open the task setup to follow its progress; check compatibility again when it finishes.";
      if (row.task === "decision") await loadModels();
      await refreshRecommendations();
    } catch (e) {
      if (mounted)
        recommendationError = e instanceof Error ? e.message : "The download could not start.";
    } finally {
      if (mounted) recommendationAction = "";
    }
  }

  async function loadModels() {
    loading = true;
    err = "";
    try {
      const r = await get("/api/models");
      const d = r;
      if (d.error) throw new Error(d.error);
      cat = d.catalogue ?? d;
      job = d.job ?? { state: "idle" };
    } catch (e) {
      err = String(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    loadModels();
  });

  // Poll only while something is downloading: a finished job never needs another fetch.
  $effect(() => {
    if (job?.state !== "running") return;
    const t = setInterval(async () => {
      try {
        const r = await post("/api/models/status", {});
        job = r;
        if (job.state !== "running") {
          clearInterval(t);
          loadModels();
        }
      } catch {
        /* keep polling; a single failed poll is not a failed download */
      }
    }, 1500);
    return () => clearInterval(t);
  });

  async function inspectRepo() {
    const repo = repoInput.trim();
    if (!repo) return;
    probing = true;
    probe = null;
    err = "";
    force = false;
    try {
      const r = await post("/api/models/inspect", { repo });
      const d = r;
      if (d.error) err = d.error;
      else probe = d;
    } catch (e) {
      err = String(e);
    } finally {
      probing = false;
    }
  }

  async function download(repo: string, allowForce = false) {
    err = "";
    try {
      const r = await post("/api/models/download", { repo, force: allowForce });
      const d = r;
      if (d.error) err = d.error;
      else job = d;
    } catch (e) {
      err = String(e);
    }
  }

  function mb(n: number | null | undefined) {
    if (!n) return "—";
    return n > 1000 ? `${(n / 1000).toFixed(1)} GB` : `${n} MB`;
  }
</script>

<View
  title="Models & downloads"
  icon="cpu"
  subtitle="Find a model that fits a task and a device, check what a repository actually contains, then download it. This build has no download route, so the lists below stay empty and say why."
>
  {#snippet actions()}
    <button class="btn h-7" onclick={loadModels} disabled={loading}>Refresh</button>
  {/snippet}

  {#if err}
    <RecoveryNotice message={err} retry={loadModels} retryLabel="Refresh models" />
  {/if}

  <section class="model-recommendations" aria-labelledby="recommendation-title">
    <h2 id="recommendation-title">Find a compatible model</h2>
    <div class="recommendation-controls">
      <label
        >Task<select
          class="field"
          bind:value={recommendationTask}
          onchange={refreshRecommendations}
          disabled={!!recommendationAction}
          >{#each recommendationTasks as [id, label]}<option value={id}>{label}</option
            >{/each}</select
        ></label
      >
      <label
        >Compute<select
          class="field"
          bind:value={recommendationDevice}
          onchange={refreshRecommendations}
          disabled={!!recommendationAction}
          ><option value="">Detected local devices</option
          >{#each ["NPU", "GPU", "CPU"] as device}<option value={device}>{device}</option
            >{/each}</select
        ></label
      >
      <button
        class="btn"
        onclick={refreshRecommendations}
        disabled={recommendationLoading || !!recommendationAction}
        >{recommendationLoading ? "Checking…" : "Check compatibility"}</button
      >
    </div>
    {#if recommendationError}<RecoveryNotice
        message={recommendationError}
        retry={refreshRecommendations}
        retryLabel="Check again"
      />{/if}
    {#if recommendationNotice}<p role="status" class="recommendation-note">
        {recommendationNotice}
      </p>{/if}
    {#if recommendations}<p class="recommendation-note">
        Detected: {recommendations.hardware.devices.join(" / ") || "no OpenVINO devices"}. Ranked by
        what is already prepared and installed, then by catalogue compatibility. This ranks
        compatibility, not model quality or speed.
      </p>
      {#if recommendations.hardware.runtime_error}<RecoveryNotice
          message={recommendations.hardware.runtime_error}
        />{/if}
      {#each recommendations.tasks as task}<p class="recommendation-note">{task.reason}</p>
        {#if !task.candidates.length}<p class="recommendation-note">
            No candidate was returned for this task. That means none is known to fit the task and
            the detected devices, not that every model would fail.
          </p>
        {/if}
        {#each task.candidates as row}<article class="recommendation-row">
            <div>
              <h3>
                {row.label}{#if task.recommended_id === row.id}<span class="chip"
                    >Recommended for this setup</span
                  >{/if}
              </h3>
              <details class="model-details">
                <summary>Compatibility details</summary>
                <p>{row.reason}</p>
                <p>{row.note}</p>
              </details>
              <ModelCapabilities capabilities={row.capabilities} compact /><span class="chip"
                >{row.readiness.replaceAll("_", " ")}</span
              >
            </div>
            <div class="recommendation-actions">
              <span
                >{row.installed
                  ? "Installed"
                  : row.download_mb
                    ? `${mb(row.download_mb)} download`
                    : "Size not supplied"}</span
              >
              {#if !row.installed && row.action && recommendationDownload(row) && !["incompatible", "unavailable", "unverified"].includes(row.readiness)}<button
                  class="btn"
                  disabled={!!recommendationAction}
                  onclick={() => downloadRecommendation(row)}
                  >{recommendationAction === row.id ? "Starting…" : "Download"}</button
                >{:else}<a
                  class="btn"
                  href={row.task === "chat"
                    ? "#chat"
                    : row.task === "speech"
                      ? "#transcribe"
                      : row.task === "embedding"
                        ? "#embeddings"
                        : "#setup"}>Open task setup</a
                >{/if}
            </div>
          </article>{/each}
      {/each}
      <p class="recommendation-note">
        This check starts no download and prepares no model. Installed bytes can exceed the
        download size, because graphs and device caches take extra disk space.
      </p>
    {/if}
  </section>
  <details class="advanced-models">
    <summary>Advanced · decision checkpoints & storage</summary>
    {#if cat?.current_model}
      <section class="mb-5" aria-label="Current decision model capabilities">
        <p class="mb-2 text-[12px] font-semibold">Current model · {cat.current_model.label}</p>
        <ModelCapabilities capabilities={cat.current_model.capabilities} />
        {#if cat.current_model.runtime_error}<RecoveryNotice
            message={`${cat.current_model.runtime_error}. Restart Laya from Server controls after checking installed packages.`}
          />{/if}
      </section>
    {/if}

    <!-- What a model directory must contain. Stated before the input, because the
       commonest mistake is pasting a plain PyTorch repo. -->
    <div class="card mb-4 p-4">
      <div class="mb-2 flex items-center gap-2">
        <span class="text-ink-3"><Icon name="help" size={13} /></span>
        <span class="text-[12.5px] font-semibold">What gets downloaded, and where</span>
      </div>
      <p class="mb-3 text-[11.5px] leading-relaxed text-ink-2">
        Files are saved under <code class="mono text-ink">{cat?.where ?? "unknown; no runtime reported a path"}</code>,
        one directory per model named after its repo. Nothing is written outside that folder, and no
        download starts before the repo has been checked.
      </p>
      <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {#each [["openvino_model.xml", "the compiled graph"], ["rl_agent_config.json", "question types, temperatures"], ["tokenizer/", "must match the graph"]] as [f, why]}
          <div class="rounded border border-line bg-panel-2 px-2.5 py-2">
            <div class="mono text-[10.5px] text-ink">{f}</div>
            <div class="mt-0.5 text-[10.5px] text-ink-3">{why}</div>
          </div>
        {/each}
      </div>
      <p class="mt-2.5 text-[11px] leading-relaxed text-ink-3">
        A repo with <code class="mono">.bin</code> and <code class="mono">config.json</code>
        but no <code class="mono">openvino_model.xml</code> is a PyTorch checkpoint. It will not
        load here; convert it with <code class="mono">laya.ov.export()</code> first.
      </p>
    </div>

    <!-- Best option -->
    <span class="label mb-2 block">Decision model catalogue</span>
    <div class="mb-5 flex flex-col gap-2.5">
      {#if loading}
        <p class="text-[11.5px] text-ink-3">Reading the catalogue…</p>
      {:else if !cat?.entries?.length}
        <p class="text-[11.5px] leading-relaxed text-ink-2">
          The catalogue is empty. This build has no runtime to report one, so the list above is the
          whole of it. The desktop app fills this in from its installed models.
        </p>
      {/if}
      {#each cat?.entries ?? [] as e}
        <div class="card p-4 {e.recommended ? 'ring-1 ring-white/20' : ''}">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-[13px] font-semibold">{e.label}</span>
              {#if e.recommended}
                <span class="chip mono !text-[9.5px]">catalogue export</span>
              {/if}
            </div>
            <span class="mono text-[10.5px] text-ink-3">{mb(e.size_mb)}</span>
          </div>
          <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">{e.why}</p>
          <div class="mt-2"><ModelCapabilities capabilities={e.capabilities} /></div>
          <div class="mt-2.5 flex flex-wrap items-center gap-2">
            <code class="mono text-[10.5px] text-ink-3">{e.repo}</code>
            <div class="ml-auto flex gap-1.5">
              <button
                class="btn h-6 !text-[11px]"
                onclick={() => download(e.repo)}
                disabled={job?.state === "running"}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>

    <!-- Free-form input -->
    <span class="label mb-2 block">Any Hugging Face repo</span>
    <div class="card mb-4 p-4">
      <div class="flex flex-wrap gap-2">
        <input
          class="mono h-8 min-w-0 flex-1 rounded border border-line bg-panel-2 px-2.5 text-[11.5px] text-ink placeholder:text-ink-3 focus:border-white/30 focus:outline-none"
          placeholder="owner/name, e.g. rupeshs/laya-ov-int8"
          aria-label="Hugging Face decision model repository"
          bind:value={repoInput}
          onkeydown={(e) => e.key === "Enter" && inspectRepo()}
          spellcheck="false"
          autocomplete="off"
        />
        <button class="btn h-8" onclick={inspectRepo} disabled={probing || !repoInput.trim()}>
          {probing ? "Checking…" : "Check"}
        </button>
      </div>
      <p class="mt-2 text-[10.5px] leading-relaxed text-ink-3">
        A check reads the repository file list over the network and downloads nothing, so a wrong
        format fails in a second rather than after 400 MB.
      </p>

      {#if probe}
        <div class="mt-3 rounded border border-line bg-panel-2 p-3">
          <div class="flex flex-wrap items-baseline gap-2">
            <span
              class="chip mono !text-[9.5px]"
              class:!text-emerald-400={probe.usable}
              class:!text-amber-400={!probe.usable}
            >
              {probe.usable ? "usable" : probe.kind}
            </span>
            <span class="mono text-[10.5px] text-ink-2">{probe.repo}</span>
            <span class="mono ml-auto text-[10px] text-ink-3">{mb(probe.size_mb)}</span>
          </div>
          <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">{probe.note}</p>
          <div class="mt-2"><ModelCapabilities capabilities={probe.capabilities} /></div>
          <p class="mono mt-1.5 text-[10px] text-ink-3">→ {probe.local_dir}</p>

          {#if probe.missing?.length}
            <p class="mt-1.5 text-[10.5px] text-ink-3">
              missing: <span class="mono">{probe.missing.join(", ")}</span>
            </p>
          {/if}

          <div class="mt-2.5 flex flex-wrap items-center gap-2">
            {#if probe.usable}
              <button
                class="btn h-7 !text-[11px]"
                onclick={() => download(probe.repo)}
                disabled={job?.state === "running"}
              >
                Download to this folder
              </button>
            {:else}
              <label class="flex items-center gap-1.5 text-[10.5px] text-ink-2">
                <input type="checkbox" bind:checked={force} />
                download anyway (I will convert it myself)
              </label>
              <button
                class="btn h-7 !text-[11px]"
                onclick={() => download(probe.repo, force)}
                disabled={!force || job?.state === "running"}
              >
                Download anyway
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </details>
  <!-- Job state -->
  {#if job?.state !== "idle"}
    <span class="label mb-2 block">Download</span>
    <div class="card mb-4 p-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <span class="mono text-[11.5px] text-ink">{job.repo}</span>
        <span
          class="chip mono !text-[9.5px]"
          class:!text-emerald-400={job.state === "done"}
          class:!text-red-400={job.state === "error"}>{job.state}</span
        >
      </div>
      {#if job.state === "running"}
        <p class="mt-1.5 text-[11px] text-ink-2">
          Fetching from Hugging Face. A 400 MB model takes a few minutes, and the page keeps
          polling until the job finishes.
        </p>
      {:else if job.state === "done"}
        <p class="mt-1.5 text-[11px] text-ink-2">
          Saved {mb(Math.round((job.bytes ?? 0) / 1e6))} to
          <code class="mono text-ink">{job.dir}</code>.
        </p>
        <p class="mt-1.5 text-[11px] leading-relaxed text-ink-3">
          The app loads a model once at startup, so a new file applies after a restart. Restart it
          from its shortcut after you point the configuration at the model directory. Downloading a
          different repo does not switch the active model.
        </p>
        <button class="btn mt-2 h-7 !text-[11px]" onclick={onReload}>Re-check backends</button>
      {:else if job.state === "error"}
        <p class="mt-1.5 text-[11px] text-red-400">{job.error}</p>
      {/if}
    </div>
  {/if}
</View>

<style>
  .model-recommendations {
    margin-bottom: 28px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--color-line);
    font-size: 12px;
    line-height: 1.6;
  }
  .model-recommendations h2 {
    font-size: 17px;
    font-weight: 600;
    margin: 0 0 12px;
  }
  .model-recommendations h3 {
    font-size: 13px;
    font-weight: 600;
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin: 0 0 6px;
  }
  .model-recommendations p {
    color: var(--color-ink-2);
    max-width: 75ch;
    margin: 5px 0;
  }
  .recommendation-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
  }
  .recommendation-controls label {
    display: grid;
    gap: 5px;
    min-width: 170px;
  }
  .recommendation-controls .btn {
    min-height: 34px;
  }
  .model-recommendations .recommendation-note {
    margin: 12px 0;
  }
  .recommendation-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 20px;
    padding: 16px 0;
    border-top: 1px solid var(--color-line);
  }
  .recommendation-row .chip {
    margin: 4px 6px 0 0;
  }
  .recommendation-actions {
    display: flex;
    flex-direction: column;
    align-items: end;
    gap: 8px;
    color: var(--color-ink-2);
    font-size: 11px;
  }
  .model-details {
    margin: 8px 0;
    color: var(--color-ink-2);
    font-size: 11px;
  }
  .advanced-models > summary {
    margin-bottom: 20px;
    font-size: 12px;
    color: var(--color-ink-2);
  }
  @media (max-width: 640px) {
    .recommendation-row {
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .recommendation-actions {
      align-items: start;
    }
    .recommendation-controls label {
      flex: 1 1 150px;
      min-width: 0;
    }
  }
</style>

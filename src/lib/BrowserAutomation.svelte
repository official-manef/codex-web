<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Icon } from "../../shared/icons/index.js";
  import RecoveryNotice from "#lib/RecoveryNotice.svelte";
  import ModelCapabilities from "#lib/ModelCapabilities.svelte";
  import PanelResizeHandle from "#lib/PanelResizeHandle.svelte";
  import { get, post, headers, runtimeFetch } from "#lib/http.js";
  import { readDraft, saveDraft } from "#lib/drafts.js";
  let {
    active = true,
    kind = "browser",
    backend = "",
    managedRunId = "",
  }: {
    active?: boolean;
    kind?: "browser" | "desktop";
    backend?: string;
    managedRunId?: string;
  } = $props();
  let base = $derived(`/api/${kind === "desktop" ? "desktop" : "browser"}-rpa`);
  let native = $derived(kind === "desktop");
  let storageKey = $derived(`laya-${kind}-rpa`);
  let status = $state<any>(null);
  let recipe = $state("");
  let query = $state("");
  let queryInitialized = $state(false);
  let studioWidth = $state(0);
  let timelineWidth = $state(270);
  let panelHydrated = $state("");
  let timelineMax = $derived(Math.min(400, Math.max(200, studioWidth - 308)));
  let splitTimeline = $derived(studioWidth >= 508);
  let run = $state<any>(null);
  let error = $state("");
  let requesting = $state(false);
  let reading = $state(false);
  let frameIndex = $state(0);
  let following = $state(true);
  let replaying = $state(false);
  let deleteConfirmation = $state("");
  let canvas = $state<HTMLCanvasElement | null>(null);
  let frameLoading = $state(false);
  let imageVersion = 0;
  let alive = true;
  let selectionVersion = 0;
  let statusVersion = 0;
  let runRequest = 0;
  let archived = $derived(!native && run?.recipe === "solitaire_demo");
  let computeLabel = $derived(
    managedRunId && run?.provenance?.device
      ? `${run.provenance.device} · recorded local AI`
      : /^local:(npu|gpu|cpu)$/.test(backend)
        ? `${backend.slice(6).toUpperCase()} · selected local AI`
        : "Choose local compute",
  );
  let recipeAvailable = $derived(status?.recipes?.some((item: any) => item.id === recipe) === true);
  let plan = $derived<string[]>(
    (run?.steps ?? status?.recipes?.find((item: any) => item.id === recipe)?.steps ?? []).map(
      (step: any) => step.label,
    ),
  );
  let running = $derived(["queued", "launching", "running", "waiting_user"].includes(run?.state));
  let frames = $derived<any[]>(run?.frames ?? []);
  let frame = $derived(frames[frameIndex]);
  let progress = $derived(
    (run?.steps ?? []).filter((step: any) => ["completed", "done"].includes(step.state)).length,
  );
  let duration = $derived(((run?.elapsed_ms ?? 0) / 1000).toFixed(1));
  function checked(value: any) {
    if (value.error && !value.run_id) throw new Error(value.error);
    return value;
  }
  async function refresh(syncRun = false) {
    const scope = base;
    const version = ++statusVersion;
    const selection = selectionVersion;
    const provided = managedRunId;
    try {
      const value = checked(await get(scope));
      if (!alive || scope !== base || version !== statusVersion) return;
      status = value;
      error = "";
      if (!queryInitialized) {
        query = status.recipes?.[0]?.query ?? "";
        queryInitialized = true;
      }
      if (!status.recipes?.some((item: any) => item.id === recipe) && !run)
        recipe = status.recipes?.[0]?.id ?? "";
      if (syncRun && selection === selectionVersion && !requesting && !reading) {
        let identifier = provided || value.active_run_id;
        if (!identifier && !run) {
          try {
            identifier = localStorage.getItem(storageKey);
          } catch {
            /* Optional history. */
          }
        }
        if (
          /^[a-f0-9]{24}$/.test(identifier ?? "") &&
          (provided ||
            value.active_run_id === identifier ||
            value.recordings?.some((item: any) => item.run_id === identifier)) &&
          (!run || run.run_id !== identifier || running)
        ) {
          const observed = checked(await post(`${scope}/run`, { run_id: identifier }));
          if (
            alive &&
            scope === base &&
            version === statusVersion &&
            selection === selectionVersion &&
            observed.run_id === identifier
          )
            receive(observed);
        }
      }
    } catch (e) {
      if (alive && scope === base && version === statusVersion)
        error =
          e instanceof Error
            ? e.message
            : "Automation status did not load. Reload the page to try again.";
    }
  }
  function receive(value: any) {
    if (
      run?.run_id === value.run_id &&
      ["completed", "failed", "cancelled"].includes(run.state) &&
      ["queued", "launching", "running", "waiting_user"].includes(value.state)
    )
      return;
    run = value;
    if (typeof value.query === "string" && value.query) query = value.query;
    recipe = value.recipe;
    if (following) frameIndex = Math.max(0, (value.frames?.length ?? 1) - 1);
    try {
      localStorage.setItem(storageKey, value.run_id);
    } catch {
      /* storage can be unavailable */
    }
  }
  onMount(() => {
    alive = true;
    return () => {
      alive = false;
      imageVersion++;
    };
  });
  $effect(() => {
    const scope = base;
    const key = storageKey;
    const provided = managedRunId;
    const version = ++selectionVersion;
    runRequest++;
    statusVersion++;
    status = null;
    recipe = "";
    run = null;
    error = "";
    requesting = false;
    reading = false;
    replaying = false;
    deleteConfirmation = "";
    following = true;
    frameIndex = 0;
    query = "";
    queryInitialized = false;
    try {
      const stored = readDraft<any>(`${kind}-rpa-controls`, null);
      if (typeof stored?.query === "string") {
        query = stored.query;
        queryInitialized = true;
      }
      const id = provided || localStorage.getItem(key);
      if (id)
        post(`${scope}/run`, { run_id: id })
          .then((value) => {
            if (alive && scope === base && version === selectionVersion && value.run_id === id)
              receive(value);
          })
          .catch(() => {});
    } catch {
      /* no saved run */
    }
  });
  $effect(() => {
    const scope = base;
    const provided = managedRunId;
    if (active)
      untrack(() => {
        void scope;
        void provided;
        refresh(true);
      });
  });
  $effect(() => {
    const key = `${kind}-rpa-panels`;
    const stored = readDraft<any>(key, null);
    timelineWidth = Number.isFinite(stored?.timelineWidth)
      ? Math.min(400, Math.max(200, stored.timelineWidth))
      : 270;
    panelHydrated = key;
  });
  $effect(() => {
    const key = `${kind}-rpa-panels`;
    if (panelHydrated === key) saveDraft(key, { timelineWidth });
  });
  $effect(() => {
    if (!native && queryInitialized) saveDraft("browser-rpa-controls", { query });
  });
  $effect(() => {
    if (!active || !running || !run?.run_id) return;
    const id = run.run_id;
    const scope = base;
    const version = selectionVersion;
    let polling = false;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (polling || requesting || reading) return;
      polling = true;
      const request = ++runRequest;
      try {
        const next = checked(await post(`${scope}/run`, { run_id: id }));
        if (
          !alive ||
          cancelled ||
          request !== runRequest ||
          scope !== base ||
          version !== selectionVersion ||
          run?.run_id !== id
        )
          return;
        receive(next);
        if (!["queued", "launching", "running", "waiting_user"].includes(next.state)) {
          await refresh();
        }
      } catch (e) {
        if (
          alive &&
          !cancelled &&
          request === runRequest &&
          scope === base &&
          version === selectionVersion &&
          run?.run_id === id
        )
          error = e instanceof Error ? e.message : "The workflow connection was interrupted.";
      } finally {
        polling = false;
      }
    }, 700);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  });
  $effect(() => {
    if (!replaying || !active || !frames.length) return;
    const timer = setInterval(() => {
      if (frameIndex >= frames.length - 1) {
        replaying = false;
        return;
      }
      frameIndex++;
    }, 700);
    return () => clearInterval(timer);
  });
  $effect(() => {
    const element = canvas,
      snapshot = frame;
    const version = ++imageVersion;
    if (!element) return;
    if (!snapshot?.url) {
      frameLoading = false;
      element.getContext("2d")?.clearRect(0, 0, element.width, element.height);
      return;
    }
    const controller = new AbortController();
    frameLoading = true;
    (async () => {
      let url = "";
      try {
        const frameUrl = new URL(snapshot.url, location.origin);
        const framePrefix = `${base}/frame/${run?.run_id}/`;
        if (
          frameUrl.origin !== location.origin ||
          !frameUrl.pathname.startsWith(framePrefix) ||
          !/^\d{6}$/.test(frameUrl.pathname.slice(framePrefix.length)) ||
          frameUrl.search ||
          frameUrl.hash
        )
          throw new Error("This recording does not contain a valid local frame URL.");
        const response = await runtimeFetch(frameUrl.pathname, {
          headers: headers(),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Recorded frame unavailable (HTTP ${response.status}).`);
        const blob = await response.blob();
        url = URL.createObjectURL(blob);
        const image = new Image();
        image.src = url;
        await image.decode();
        if (version !== imageVersion || !alive) return;
        element.width = image.naturalWidth;
        element.height = image.naturalHeight;
        const drawing = element.getContext("2d");
        drawing?.drawImage(image, 0, 0);
        if (drawing && snapshot.pointer?.action === "click") {
          const { x, y } = snapshot.pointer;
          drawing.strokeStyle = "#35a8ff";
          drawing.lineWidth = 3;
          drawing.beginPath();
          drawing.arc(x, y, 13, 0, Math.PI * 2);
          drawing.stroke();
          drawing.fillStyle = "#35a8ff";
          drawing.beginPath();
          drawing.arc(x, y, 3, 0, Math.PI * 2);
          drawing.fill();
        }
      } catch (e) {
        if (!controller.signal.aborted && alive && version === imageVersion)
          error = e instanceof Error ? e.message : "Could not render the recorded frame.";
      } finally {
        if (url) URL.revokeObjectURL(url);
        if (version === imageVersion) frameLoading = false;
      }
    })();
    return () => controller.abort();
  });
  async function start() {
    if (requesting || reading || running || !recipeAvailable || !status?.available) return;
    if (recipe === "google_search" && !query.trim()) return;
    if (native && !/^local:(npu|gpu|cpu)$/.test(backend)) return;
    const scope = base;
    const version = ++selectionVersion;
    requesting = true;
    error = "";
    following = true;
    replaying = false;
    frameIndex = 0;
    try {
      const value = checked(
        await post(`${scope}/start`, {
          recipe,
          ...(native ? { backend } : {}),
          ...(recipe === "google_search" ? { query } : {}),
          confirm: true,
        }),
      );
      if (alive && scope === base && version === selectionVersion) receive(value);
    } catch (e) {
      if (alive && scope === base && version === selectionVersion)
        error = e instanceof Error ? e.message : "Could not start the browser workflow.";
    } finally {
      if (alive && scope === base && version === selectionVersion) requesting = false;
    }
  }
  async function stop() {
    if (requesting || !running || !run?.run_id) return;
    const id = run.run_id;
    const scope = base;
    const version = selectionVersion;
    const request = ++runRequest;
    requesting = true;
    error = "";
    try {
      const value = checked(await post(`${scope}/cancel`, { run_id: id }));
      if (
        alive &&
        request === runRequest &&
        scope === base &&
        version === selectionVersion &&
        run?.run_id === id
      )
        receive(value);
    } catch (e) {
      if (alive && request === runRequest && scope === base && version === selectionVersion)
        error = e instanceof Error ? e.message : "Could not stop the workflow.";
    } finally {
      if (alive && scope === base && version === selectionVersion) requesting = false;
    }
  }
  async function resume() {
    if (requesting || run?.state !== "waiting_user") return;
    const id = run.run_id;
    const scope = base;
    const version = selectionVersion;
    const request = ++runRequest;
    requesting = true;
    error = "";
    try {
      const next = checked(await post(`${scope}/resume`, { run_id: id, confirm: true }));
      if (
        alive &&
        request === runRequest &&
        scope === base &&
        version === selectionVersion &&
        run?.run_id === id
      )
        receive(next);
    } catch (e) {
      if (alive && request === runRequest && scope === base && version === selectionVersion)
        error = e instanceof Error ? e.message : "The browser could not be rechecked.";
    } finally {
      if (alive && scope === base && version === selectionVersion) requesting = false;
    }
  }
  async function recording(id: string) {
    if (!id || requesting || reading || running) return;
    const version = ++selectionVersion;
    const scope = base;
    reading = true;
    error = "";
    replaying = false;
    deleteConfirmation = "";
    following = false;
    frameIndex = 0;
    try {
      const value = checked(await post(`${scope}/recording`, { run_id: id }));
      if (alive && scope === base && version === selectionVersion) receive(value);
    } catch (e) {
      if (alive && scope === base && version === selectionVersion)
        error = e instanceof Error ? e.message : "Could not open the recording.";
    } finally {
      if (alive && scope === base && version === selectionVersion) reading = false;
    }
  }
  function replay() {
    following = false;
    frameIndex = 0;
    replaying = true;
  }
  async function deleteRecording() {
    const id = run?.run_id;
    if (!id || deleteConfirmation !== id || requesting || reading || running) return;
    const scope = base;
    const version = ++selectionVersion;
    reading = true;
    error = "";
    replaying = false;
    try {
      checked(await post(`${scope}/delete`, { run_id: id, confirm: true }));
      if (!alive || scope !== base || version !== selectionVersion || run?.run_id !== id) return;
      run = null;
      frameIndex = 0;
      deleteConfirmation = "";
      try {
        if (localStorage.getItem(storageKey) === id) localStorage.removeItem(storageKey);
      } catch {
        /* deleting a recording does not require browser storage */
      }
      await refresh();
    } catch (e) {
      if (alive && scope === base && version === selectionVersion)
        error = e instanceof Error ? e.message : "Could not delete this recording.";
    } finally {
      if (alive && scope === base && version === selectionVersion) reading = false;
    }
  }
</script>

<section
  class="browser-automation"
  aria-label={native ? "Windows RPA studio" : "Browser workflow studio"}
>
  <div class="workflow-heading">
    <div>
      <h2>
        {archived ? "Archived browser demo" : native ? "Windows Solitaire" : "Browser automation"}
      </h2>
      <p>
        {#if archived}This saved recording came from the former HTML Solitaire demo in a browser.
          Choose Windows RPA above to use the Microsoft Solitaire installed on this computer.
        {:else if native}Local AI reads the existing game and may request one Hint. Your game is
          preserved.
        {:else}Search in a separate browser and record each real action.{/if}
      </p>
    </div>
    <div class="run-actions" hidden={!!managedRunId}>
      <label class="sr-only" for={`rpa-recipe-${kind}`}>Workflow recipe</label>
      <select
        id={`rpa-recipe-${kind}`}
        value={recipe}
        disabled={running || requesting || reading}
        onchange={(event) => {
          selectionVersion++;
          recipe = event.currentTarget.value;
          run = null;
          error = "";
          frameIndex = 0;
          replaying = false;
          deleteConfirmation = "";
        }}
      >
        {#if recipe && !recipeAvailable}<option value={recipe} disabled
            >{archived ? "Archived browser demo" : "Saved workflow · replay only"}</option
          >{/if}
        {#each status?.recipes ?? [] as item}<option value={item.id}>{item.label}</option>{/each}
      </select>
      {#if running}<button class="btn" onclick={stop}><Icon name="x" />Stop workflow</button
        >{:else}<button
          class="btn btn-solid"
          onclick={start}
          disabled={requesting ||
            reading ||
            !status?.available ||
            !recipeAvailable ||
            (recipe === "google_search" && !query.trim()) ||
            (native && !/^local:(npu|gpu|cpu)$/.test(backend))}
          ><Icon name="play" />{requesting
            ? "Starting…"
            : reading
              ? "Loading recording…"
              : native
                ? "Run Windows RPA"
                : "Run browser recipe"}</button
        >{/if}
    </div>
  </div>
  {#if !native && !managedRunId}<label class="search-query"
      >Search query
      <input
        class="field"
        bind:value={query}
        oninput={() => (queryInitialized = true)}
        maxlength={status?.limits?.max_query_chars}
        disabled={running || requesting || reading}
      />
      <small>This text is sent to Google only when you press Run or approve a workflow step.</small>
    </label>{/if}
  {#if run?.state === "waiting_user"}<section class="browser-handoff" role="status">
      <h3>Continue in the separate browser</h3>
      <p>{run.handoff?.message}</p>
      <p>
        The same browser stays open for up to {status?.limits?.max_handoff_seconds ?? "…"} seconds. Complete
        the prompt yourself, then recheck; no new search is submitted by Recheck.
      </p>
      {#if !managedRunId}<button
          class="btn btn-solid"
          onclick={resume}
          disabled={requesting || run.resume_requested}>I finished · recheck page</button
        >{/if}
    </section>{/if}
  {#if native}<div class="native-runtime">
      <span class="chip">{computeLabel}</span><ModelCapabilities
        capabilities={status?.model?.capabilities}
        compact
      />
      <p>
        Text perception and UI control are separate. Screenshots are not sent to a text-only model.
      </p>
    </div>{:else}<p class="recording-note">
      Deterministic browser recipe · no model inference
    </p>{/if}
  {#if status && !status.available}<RecoveryNotice
      message={status.reason ||
        (native
          ? "The installed Windows app is unavailable. Open Laya on its Windows host and check again."
          : "No supported browser is available. Install Microsoft Edge or Chrome, then check again.")}
      retry={refresh}
      retryLabel={native ? "Check Windows app" : "Check browser"}
    />{/if}
  {#if error}<RecoveryNotice message={error} retry={refresh} retryLabel="Check connection" />{/if}
  {#if native && status?.runtime_error}<RecoveryNotice
      message={`${status.runtime_error}. If the packages are installed, restart Laya from Server controls to refresh its runtime.`}
    />{/if}
  {#if run?.state === "failed"}<RecoveryNotice
      message={run.error ||
        "The workflow stopped before verification. Review its last captured frame and try again."}
      retry={recipeAvailable ? start : undefined}
      retryLabel="Run a new attempt"
    />{/if}

  <details class="plan-details">
    <summary>Preview steps ({plan.length})</summary>
    <div class="flow-plan" aria-label="Workflow steps">
      {#each plan as label, index}{@const step = run?.steps?.[index]}
        <div
          class="flow-step"
          class:step-done={step && ["completed", "done"].includes(step.state)}
          class:step-active={step?.state === "running"}
        >
          <span class="step-number"
            >{#if step && ["completed", "done"].includes(step.state)}<Icon
                name="check"
                size={12}
              />{:else}{index + 1}{/if}</span
          ><span>{label}</span>
          {#if index < plan.length - 1}<span class="step-connector" aria-hidden="true"
              ><Icon name="chevron" size={12} /></span
            >{/if}
        </div>{/each}
    </div>
  </details>

  <div
    class="studio"
    class:stacked-timeline={!splitTimeline}
    bind:clientWidth={studioWidth}
    style:--timeline-width={`${Math.min(timelineWidth, timelineMax)}px`}
  >
    <div class="screen-pane">
      <div class="screen-bar">
        <span class="screen-state"
          ><span class:live={running} class="record-dot"></span>{running
            ? native
              ? "Recording Windows app"
              : "Recording real browser"
            : run?.state === "completed"
              ? archived
                ? "Archived browser demo"
                : "Recorded run"
              : run?.state === "cancelled"
                ? "Stopped recording"
                : native
                  ? "Windows app canvas"
                  : "Browser canvas"}</span
        ><span class="screen-url"
          >{run?.observation?.title || run?.current_url || "Ready to run"}</span
        >
      </div>
      <div class="canvas-stage" class:empty={!frame}>
        <canvas
          bind:this={canvas}
          width="1280"
          height="720"
          aria-label={native
            ? "Actual recorded Windows app frame"
            : "Actual recorded browser frame"}>Recorded frames are listed in the timeline.</canvas
        >
        {#if !frames.length}<div class="canvas-empty">
            <Icon name="workflow" size={32} />
            <h3>
              {running
                ? native
                  ? "Observing the Windows app…"
                  : "Opening the browser…"
                : "See the actual application"}
            </h3>
            <p>
              {running
                ? "The first screenshot appears when the application is ready."
                : native
                  ? "Run Windows RPA to record the installed app and local AI perception."
                  : "Run the recipe to capture actual browser actions. No inference model is used."}
            </p>
          </div>{/if}
        {#if frameLoading && frames.length}<span class="frame-loading" role="status"
            >Loading frame…</span
          >{/if}
      </div>
      <div class="playback">
        <button
          class="btn playback-button"
          aria-label={replaying ? "Pause recording" : "Replay recording"}
          disabled={!frames.length || running}
          onclick={() => {
            if (replaying) replaying = false;
            else replay();
          }}><Icon name={replaying ? "x" : "play"} size={13} /></button
        >
        <input
          type="range"
          aria-label="Recorded frame"
          min="0"
          max={Math.max(0, frames.length - 1)}
          value={frameIndex}
          disabled={!frames.length}
          oninput={(event) => {
            following = false;
            replaying = false;
            frameIndex = Number(event.currentTarget.value);
          }}
        />
        <span>{frames.length ? `${frameIndex + 1} / ${frames.length}` : "0 frames"}</span>
        {#if running && !following}<button
            class="btn"
            onclick={() => {
              following = true;
              frameIndex = Math.max(0, frames.length - 1);
            }}>Go live</button
          >{/if}
      </div>
      <p class="recording-note">
        {replaying
          ? "Replay · reading saved screenshots; no actions are running."
          : run?.verified
            ? `Verified ${archived ? "archived browser capture" : native ? "Windows run" : "browser run"} · ${duration} s · ${frames.length} captured frames`
            : running
              ? `${progress} steps complete · real screenshots, captured locally`
              : "Replay reads saved screenshots. New actions require pressing Run."}
      </p>
    </div>
    {#if splitTimeline}<PanelResizeHandle
        bind:value={timelineWidth}
        min={200}
        max={timelineMax}
        label="Action timeline width"
      />{/if}
    <aside class="timeline-pane" aria-label="Action timeline">
      <h3>Action timeline</h3>
      <p class="timeline-description">The runner records each action and its outcome.</p>
      {#if run?.steps?.length}<ol class="action-timeline">
          {#each run.steps as step}<li
              class:action-complete={["completed", "done"].includes(step.state)}
            >
              <div><span>{step.label}</span><small>{step.state}</small></div>
              {#if step.detail}<p>{step.detail}</p>{/if}{#if step.finished_ms != null}<time
                  >{(step.finished_ms / 1000).toFixed(1)} s</time
                >{/if}
            </li>{/each}
        </ol>{:else}<ol class="action-timeline">
          {#each plan as label}<li><div><span>{label}</span><small>Waiting</small></div></li>{/each}
        </ol>{/if}
      <div class="recording-library">
        <label for={`recordings-${kind}`}>Saved recordings</label><select
          id={`recordings-${kind}`}
          value={run?.run_id || ""}
          onchange={(event) => recording(event.currentTarget.value)}
          disabled={running || requesting || reading}
          ><option value="">Choose a recorded run</option
          >{#each status?.recordings ?? [] as saved}<option value={saved.run_id}
              >{saved.recipe === "solitaire_demo" ? "Archived browser demo · " : ""}{saved.state} · {saved.started_at
                ? new Date(saved.started_at).toLocaleString()
                : saved.run_id.slice(0, 8)}</option
            >{/each}</select
        >
        <p>Stored locally with frame hashes. Replay never repeats an action.</p>
        {#if !status?.recordings?.length}<p>
            No recording is saved yet. A finished run appears in this list with the frames it
            captured.
          </p>{/if}
        {#if status?.limits?.max_runs}<p>
            {status.recordings?.length ?? 0} / {status.limits.max_runs} saved recordings
          </p>{/if}
        {#if run?.run_id && !running}
          {#if deleteConfirmation === run.run_id}<div class="recording-delete">
              <p>Delete this recording and the frames it captured?</p>
              <button class="btn" onclick={deleteRecording} disabled={requesting || reading}
                >{reading ? "Deleting…" : "Delete permanently"}</button
              ><button class="btn" onclick={() => (deleteConfirmation = "")} disabled={reading}
                >Keep recording</button
              >
            </div>{:else}<button
              class="btn"
              disabled={requesting || reading}
              onclick={() => (deleteConfirmation = run.run_id)}>Delete recording…</button
            >{/if}
        {/if}
      </div>
      {#if native && run?.ai_steps?.length}<section
          class="ai-observations"
          aria-label="Actual local AI perception"
        >
          <h3>Local AI perception</h3>
          <p>Actual model answers; Python decides whether an action is allowed.</p>
          {#each run.ai_steps as item}<details>
              <summary>{item.question} · {item.device} · {item.ms.toFixed(1)} ms</summary>
              <pre>{JSON.stringify(item.answer, null, 2)}</pre>
            </details>{/each}
        </section>{/if}
    </aside>
  </div>
  <details class="workflow-details">
    <summary>What this workflow controls</summary>
    {#if native && status?.perception}<p>
        OCR: {status.perception.ocr.engine} · {status.perception.ocr.device}. AI: selected local
        device. OCR text does not make the model image-capable.
      </p>{/if}
    <p>
      {#if archived}This archived workflow controlled a local HTML game in an isolated browser. Its
        screenshots remain available for replay. New game automation uses the installed Windows app.
      {:else if native}The installed Microsoft Solitaire app on this Windows computer. Local
        text and OCR observations go to the selected local model. The action policy stops when it
        cannot establish a control, and it never resets your game.{:else}Google search in an isolated
        browser profile. No existing profile or saved login is used. This is a deterministic browser
        recipe, separate from local AI decisions.{/if} In the desktop app a recording holds real
        screenshots of the app it drove and stays on that machine. This build records nothing.
    </p>
    {#if run?.provenance}<p>
        {run.provenance.app || run.provenance.browser || (native ? "Windows app" : "Chromium")} · {run
          .provenance.transport} · {run.provenance.screenshot_source}
      </p>{/if}
  </details>
</section>

<style>
  .browser-automation {
    container-type: inline-size;
    container-name: rpa;
    width: 100%;
    max-width: 1500px;
    font-size: 13px;
    line-height: 1.6;
  }
  .workflow-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
  }
  .search-query {
    display: grid;
    gap: 7px;
    max-width: 640px;
    margin: 0 0 18px;
    font-size: 12px;
  }
  .search-query small {
    color: var(--color-ink-2);
  }
  .browser-handoff {
    border-block: 1px solid var(--color-line);
    padding: 16px 0;
    margin-bottom: 18px;
  }
  .browser-handoff p {
    margin: 7px 0;
  }
  h2 {
    font-size: 19px;
    font-weight: 600;
    line-height: 1.4;
    margin: 0 0 7px;
  }
  h3 {
    font-size: 13px;
    font-weight: 600;
    margin: 0;
  }
  p {
    color: var(--color-ink-2);
    margin: 0;
    max-width: 76ch;
  }
  .run-actions {
    flex: none;
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 8px;
  }
  .plan-details {
    margin: 0 0 14px;
    color: var(--color-ink-2);
    font-size: 11px;
  }
  .plan-details summary {
    cursor: pointer;
    margin-bottom: 8px;
  }
  .run-actions .btn {
    min-height: 36px;
  }
  .native-runtime {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 18px;
  }
  .native-runtime p {
    flex-basis: 100%;
    font-size: 12px;
  }
  .ai-observations {
    margin-top: 22px;
  }
  .ai-observations p {
    margin: 6px 0 10px;
    font-size: 11px;
  }
  .ai-observations details {
    border-top: 1px solid var(--color-line);
    padding: 9px 0;
    font-size: 11px;
  }
  .ai-observations pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin-top: 7px;
    font-size: 10px;
  }
  .flow-plan {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 20px;
  }
  .flow-step {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 12px;
    border: 1px solid var(--color-line);
    border-radius: 9px;
    color: var(--color-ink-2);
    background: var(--color-panel);
    font-size: 12px;
  }
  .step-number {
    display: grid;
    place-items: center;
    width: 21px;
    height: 21px;
    flex: none;
    font-size: 11px;
    border-radius: 50%;
    border: 1px solid var(--color-line);
  }
  .step-connector {
    position: absolute;
    right: -14px;
    top: 14px;
    transform: rotate(-90deg);
  }
  .step-active {
    border-color: var(--color-ink-2);
    color: var(--color-ink);
  }
  .step-done .step-number {
    background: var(--color-ink);
    color: var(--color-page);
    border-color: var(--color-ink);
  }
  .studio {
    display: grid;
    grid-template-columns: minmax(300px, 1fr) 8px var(--timeline-width, 270px);
    border: 1px solid var(--color-line);
    border-radius: 12px;
    overflow: hidden;
  }
  .studio.stacked-timeline {
    grid-template-columns: minmax(0, 1fr);
  }
  .stacked-timeline .timeline-pane {
    border-left: 0;
    border-top: 1px solid var(--color-line);
  }
  .screen-pane {
    min-width: 0;
  }
  .screen-bar {
    display: flex;
    gap: 18px;
    align-items: center;
    justify-content: space-between;
    min-height: 41px;
    padding: 9px 14px;
    border-bottom: 1px solid var(--color-line);
    font-size: 11px;
    color: var(--color-ink-2);
  }
  .screen-state {
    display: flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
  }
  .record-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-ink-3);
  }
  .record-dot.live {
    background: #e15b5b;
  }
  .screen-url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .canvas-stage {
    position: relative;
    width: 100%;
    min-width: 0;
    aspect-ratio: 16 / 9;
    background: var(--color-panel-2);
  }
  .canvas-stage.empty {
    min-height: 230px;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }
  .canvas-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 9px;
    padding: 24px;
    text-align: center;
  }
  .canvas-empty :global(svg) {
    color: var(--color-ink-3);
    margin-bottom: 6px;
  }
  .canvas-empty h3 {
    font-size: 16px;
  }
  .canvas-empty p {
    max-width: 43ch;
    font-size: 12px;
  }
  .frame-loading {
    position: absolute;
    bottom: 10px;
    right: 12px;
    background: var(--color-panel);
    padding: 3px 7px;
    border-radius: 4px;
    font-size: 10px;
  }
  .playback {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-top: 1px solid var(--color-line);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .playback input {
    min-width: 0;
    flex: 1;
    accent-color: var(--color-ink);
  }
  .playback-button {
    width: 27px;
    height: 27px;
    padding: 0;
  }
  .playback span {
    flex: none;
  }
  .recording-note {
    font-size: 11px;
    padding: 0 14px 12px;
  }
  .timeline-pane {
    background: var(--color-panel);
    padding: 16px;
    min-width: 0;
  }
  .timeline-description {
    font-size: 11px;
    margin: 5px 0 16px;
  }
  .action-timeline {
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .action-timeline li {
    min-width: 0;
    padding: 11px 0;
    border-top: 1px solid var(--color-line);
  }
  .action-timeline li > div {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
  }
  .action-timeline li > div > span {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .action-timeline small {
    min-width: 0;
    color: var(--color-ink-3);
    font-size: 10px;
    overflow-wrap: anywhere;
  }
  .action-timeline p {
    font-size: 11px;
    margin-top: 5px;
    overflow-wrap: anywhere;
  }
  .action-timeline time {
    color: var(--color-ink-3);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .action-complete small {
    color: var(--color-ink);
  }
  .recording-library {
    margin-top: 24px;
  }
  .recording-library label {
    display: block;
    margin-bottom: 7px;
    font-size: 12px;
  }
  select {
    width: 100%;
    padding: 7px;
    border: 1px solid var(--color-line);
    border-radius: var(--radius-card);
    color: var(--color-ink);
    background: var(--color-panel-2);
    font: inherit;
    font-size: 11px;
  }
  .recording-library p {
    font-size: 11px;
    margin-top: 7px;
  }
  .recording-library .btn {
    margin: 8px 6px 0 0;
    font-size: 11px;
  }
  .workflow-details {
    margin-top: 18px;
    font-size: 12px;
  }
  summary {
    color: var(--color-ink-2);
    cursor: pointer;
  }
  .workflow-details p {
    margin-top: 9px;
  }
  @container rpa (max-width: 1100px) {
    .stacked-timeline .action-timeline {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      column-gap: 24px;
    }
  }
  @container rpa (max-width: 650px) {
    .workflow-heading {
      flex-direction: column;
      gap: 14px;
    }
    .flow-plan {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .step-connector {
      display: none;
    }
    .flow-step {
      padding: 9px;
      font-size: 11px;
    }
    .screen-url {
      display: none;
    }
    .stacked-timeline .action-timeline {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>

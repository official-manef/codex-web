<script lang="ts">
  import { onDestroy } from "svelte";
  import { get, post } from "#lib/http.js";
  type Props = { refresh?: number; onReplay?: (run: any, frame: number) => void };
  let { refresh = 0, onReplay = () => {} }: Props = $props();
  let runs = $state<any[]>([]);
  let chosen = $state<string[]>([]);
  let active = $state<any>(null);
  let frame = $state(0);
  let busy = $state(false);
  let error = $state("");
  let replaying = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const selected = $derived(runs.filter((run) => chosen.includes(run.id)));
  const comparable = $derived(
    selected.length < 2 || new Set(selected.map((run) => run.workload_id)).size === 1,
  );
  const fmt = (value: number | null | undefined) =>
    value == null ? "—" : `${value.toFixed(1)} ms`;

  $effect(() => {
    refresh;
    void load();
  });
  onDestroy(stopReplay);

  async function load() {
    try {
      const result: any = await get("/api/benchmarks");
      if (result.error) throw new Error(result.error);
      runs = result.runs || [];
      chosen = chosen.filter((id) => runs.some((run) => run.id === id));
    } catch (e: any) {
      error = e.message || "Run history is unavailable.";
    }
  }

  function select(id: string, checked: boolean) {
    chosen = checked ? [...chosen.slice(-2), id] : chosen.filter((value) => value !== id);
  }

  async function read(id: string) {
    const result: any = await post("/api/benchmarks/read", { id });
    if (result.error) throw new Error(result.error);
    return result.run;
  }

  async function open(id: string) {
    stopReplay();
    busy = true;
    error = "";
    try {
      active = await read(id);
      frame = 0;
      onReplay(active, frame);
    } catch (e: any) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  async function exportRun(id: string) {
    busy = true;
    error = "";
    try {
      const run = await read(id);
      const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `laya-snake-${id}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      error = e.message || "Export failed.";
    } finally {
      busy = false;
    }
  }

  async function importRun(event: Event) {
    const input = event.currentTarget as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    busy = true;
    error = "";
    try {
      if (file.size > 2000000) throw new Error("Choose a Snake recording smaller than 2 MB.");
      const run = JSON.parse(await file.text());
      const result: any = await post("/api/benchmarks/save", { run, imported: true });
      if (result.error) throw new Error(result.error);
      await load();
    } catch (e: any) {
      error = e.message || "This file is not a supported recording.";
    } finally {
      busy = false;
      input.value = "";
    }
  }

  async function remove(id: string) {
    busy = true;
    error = "";
    try {
      const result: any = await post("/api/benchmarks/delete", { id, confirm: true });
      if (result.error) throw new Error(result.error);
      if (active?.id === id) {
        stopReplay();
        active = null;
      }
      await load();
    } catch (e: any) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  function stopReplay() {
    replaying = false;
    if (timer) clearTimeout(timer);
    timer = undefined;
  }
  function seek() {
    stopReplay();
    if (active) onReplay(active, frame);
  }
  function playReplay() {
    if (!active?.frames.length) return;
    replaying = true;
    const next = () => {
      if (!replaying) return;
      onReplay(active, frame);
      if (frame < active.frames.length - 1) {
        frame++;
        timer = setTimeout(next, 180);
      } else replaying = false;
    };
    next();
  }
</script>

<section class="recordings" aria-labelledby="recordings-title">
  <div class="heading">
    <div>
      <h3 id="recordings-title">Recorded runs</h3>
      <p>
        Every completed, stopped or failed round is saved locally. Select up to three runs to
        compare their real measurements.
      </p>
    </div>
    <label class="import"
      >Import JSON<input
        type="file"
        accept=".json,application/json"
        onchange={importRun}
        disabled={busy}
      /></label
    >
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if !runs.length}<p class="empty">
      No recordings yet. Run one step or a round to create the first recording.
    </p>{:else}
    <div class="run-list">
      {#each runs as run}<div class="run-row">
          <label
            ><input
              type="checkbox"
              checked={chosen.includes(run.id)}
              onchange={(event) => select(run.id, event.currentTarget.checked)}
            /><span
              ><strong>{run.title}</strong><small
                >{new Date(run.created_at).toLocaleString()} · {run.steps}/{run.requested_steps} steps
                · {run.status}{run.provenance?.source === "imported"
                  ? " · imported, unverified"
                  : " · local recording"}</small
              ></span
            ></label
          >
          <div class="row-actions">
            <button class="btn" onclick={() => open(run.id)} disabled={busy}>Replay</button><button
              class="btn"
              onclick={() => exportRun(run.id)}
              disabled={busy}>Export</button
            >
            <details class="delete">
              <summary>More</summary><button
                class="btn"
                onclick={() => remove(run.id)}
                disabled={busy}>Delete recording</button
              >
            </details>
          </div>
        </div>{/each}
    </div>
  {/if}
  {#if selected.length}
    <div class="comparison">
      <h4>Compare selected recordings</h4>
      {#if !comparable}<p class="warning">
          Workloads differ. These runs have different states, board trajectories, seeds or
          questions, so their averages are not a controlled speed comparison.
        </p>{:else if selected.length > 1}<p class="hint">
          Exact recorded workload matches: same seed, question and board inputs.
        </p>{/if}
      <div class="table-wrap">
        <table>
          <caption class="sr-only">
            Recorded run comparison: samples, correctness, latency and hardware per engine
          </caption>
          <thead
            ><tr
              ><th>Run / device</th><th>Samples</th><th>Correct</th><th>Inference mean</th><th
                >Server mean</th
              ><th>HTTP mean</th><th>Hardware / model</th></tr
            ></thead
          ><tbody>
            {#each selected as run}{#each run.engines as engine}{@const mean =
                  run.means[engine.id]}<tr
                  ><th
                    >{run.title}<small
                      >{engine.label} · {run.provenance?.source === "imported"
                        ? "imported"
                        : "local"}</small
                    ></th
                  ><td>{mean.samples}</td><td>{mean.correct}/{mean.samples}</td><td
                    >{fmt(mean.infer_ms)}</td
                  ><td>{fmt(mean.server_ms)}</td><td>{fmt(mean.roundtrip_ms)}</td><td
                    >{run.hardware?.processor ||
                      run.hardware?.architecture ||
                      "Unreported hardware"}<small
                      >{engine.model} · OpenVINO {run.hardware?.openvino || "unknown"}</small
                    ></td
                  ></tr
                >{/each}{/each}
          </tbody>
        </table>
      </div>
      <p class="hint">
        Compare timing only when workload, model, hardware and background activity are comparable.
        Imported metadata is not independently verified.
      </p>
    </div>
  {/if}
  {#if active}
    <div class="replay">
      <h4>Replay: {active.title}</h4>
      <p>Displays recorded boards and answers. No inference runs during replay.</p>
      {#if active.frames.length}<div class="replay-controls">
          <button class="btn" onclick={() => (replaying ? stopReplay() : playReplay())}
            >{replaying ? "Pause replay" : "Play recording"}</button
          ><label for="snake-replay-frame"
            >Step {frame + 1}/{active.frames.length}<input
              id="snake-replay-frame"
              type="range"
              min="0"
              max={active.frames.length - 1}
              step="1"
              bind:value={frame}
              oninput={seek}
            /></label
          >
        </div>
        {@const current = active.frames[frame]}
        <p><strong>Recorded input:</strong> {current.state}</p>
        <div class="table-wrap">
          <table>
            <caption class="sr-only">
              Recorded measurements for this frame: answer, confidence and latency per engine
            </caption>
            <thead
              ><tr
                ><th>Device</th><th>Answer</th><th>Confidence</th><th>Policy move</th><th
                  >Inference</th
                ><th>HTTP</th></tr
              ></thead
            ><tbody
              >{#each current.measurements as item}<tr
                  ><th>{item.id.split(":")[1].toUpperCase()}</th><td>{item.answer}</td><td
                    >{(item.probability * 100).toFixed(1)}%</td
                  ><td
                    >{item.policy.direction || "Stop"}{item.policy.overridden
                      ? " (override)"
                      : ""}</td
                  ><td>{fmt(item.infer_ms)}</td><td>{fmt(item.roundtrip_ms)}</td></tr
                >{/each}</tbody
            >
          </table>
        </div>
      {:else}<p>No measured frames were completed before this run stopped.</p>{/if}
    </div>
  {/if}
</section>

<style>
  .recordings {
    border-top: 1px solid var(--color-line);
    padding-top: 24px;
    margin-top: 24px;
    font-size: 12px;
  }
  .heading {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 18px;
    margin-bottom: 16px;
  }
  h3 {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  h4 {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 10px;
  }
  p {
    color: var(--color-ink-2);
    max-width: 90ch;
    line-height: 1.6;
  }
  .import {
    display: grid;
    gap: 8px;
    white-space: nowrap;
  }
  .import input {
    max-width: 220px;
  }
  .run-list {
    max-height: 290px;
    overflow: auto;
    border-block: 1px solid var(--color-line);
  }
  .run-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--color-line);
  }
  .run-row > label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    min-height: 44px;
  }
  input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--color-ink);
  }
  strong {
    font-weight: 500;
  }
  small {
    display: block;
    color: var(--color-ink-2);
    font-weight: 400;
    margin-top: 3px;
  }
  .row-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .btn,
  .delete summary {
    min-height: 40px;
    padding: 10px;
  }
  .delete summary {
    cursor: pointer;
  }
  .delete[open] {
    border: 1px solid var(--color-line);
    padding: 6px;
    border-radius: var(--radius-card);
  }
  .comparison,
  .replay {
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid var(--color-line);
  }
  .warning,
  .error {
    padding: 12px;
    border: 1px solid #715b36;
    color: #f2d6a3;
    border-radius: var(--radius-card);
    margin-bottom: 12px;
  }
  .error {
    border-color: #7b3a3a;
    color: #ffb4b4;
  }
  .table-wrap {
    overflow: auto;
    margin: 12px 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 12px;
  }
  td,
  th {
    padding: 10px;
    border-bottom: 1px solid var(--color-line);
    white-space: nowrap;
  }
  th {
    font-weight: 500;
    color: var(--color-ink-2);
  }
  tbody th {
    color: var(--color-ink);
  }
  .hint,
  .empty {
    font-size: 12px;
    padding: 8px 0;
  }
  .replay-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    margin: 14px 0;
  }
  .replay-controls label {
    display: grid;
    gap: 8px;
    flex: 1;
    min-width: 160px;
  }
  input[type="range"] {
    width: 100%;
    accent-color: var(--color-ink);
  }
  @media (max-width: 650px) {
    .heading {
      flex-direction: column;
    }
    .import input {
      max-width: 100%;
    }
    .row-actions {
      width: 100%;
    }
  }
</style>

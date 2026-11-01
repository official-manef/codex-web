<script lang="ts">
  import RecoveryNotice from "#lib/RecoveryNotice.svelte";
  import { onDestroy, onMount, tick } from "svelte";
  import View from "#lib/View.svelte";
  import { Icon } from "../../../shared/icons/index.js";
  import { api } from "#lib/api.js";
  import { get, post } from "#lib/http.js";
  import { readDraft, saveDraft } from "#lib/drafts.js";
  import SnakeHistory from "#lib/SnakeHistory.svelte";
  import {
    SIZE,
    DIRECTIONS,
    createGame,
    advance,
    chooseMove,
    directionToFood,
    describeBoard,
    comparisonOrder,
    requestedDelay,
    SNAKE_SEED,
    SNAKE_RANDOM_REVISION,
    randomSeed,
    validSeed,
    SNAKE_QUESTION_REVISION,
    SNAKE_MODEL,
    SNAKE_QUESTIONS,
  } from "#lib/snake.js";

  type Props = {
    backend?: string;
    backends?: any[];
    comparison?: boolean;
    compareBackends?: string[];
  };
  let { backend = "", backends = [], comparison = false, compareBackends = [] }: Props = $props();
  let game = $state(createGame());
  let busy = $state(false);
  let playing = $state(false);
  let phase = $state("");
  let error = $state("");
  let moves = $state<any[]>([]);
  let stats = $state<Record<string, any>>({});
  let remaining = $state(0);
  let pace = $state<"fast" | "readable">("fast");
  let runLength = $state(20);
  let seed = $state(SNAKE_SEED);
  let maxSteps = $state<number | null>(null);
  let hydrated = $state(false);
  let uiMs = $state<number | null>(null);
  let elapsedMs = $state<number | null>(null);
  let intentionalMs = $state(0);
  let generation = 0;
  let controller: AbortController | null = null;
  const engines = $derived(
    comparison
      ? compareBackends.filter((id) => /^local:(npu|gpu|cpu)$/.test(id))
      : /^local:(npu|gpu|cpu)$/.test(backend)
        ? [backend]
        : [],
  );
  const last = $derived(moves[0]);
  const cells = Array.from({ length: SIZE * SIZE }, (_, i) => ({
    x: i % SIZE,
    y: Math.floor(i / SIZE),
  }));
  const label = (id: string) =>
    backends.find((item) => item.id === id)?.device ||
    id.split(":").pop()?.toUpperCase() ||
    "Device";
  const avg = (row: any, key: string) =>
    row?.count && row[key] !== null ? `${(row[key] / row.count).toFixed(1)} ms` : "—";
  let recordState = $state("");
  let historyRefresh = $state(0);
  let replaying = $state(false);
  let activeTrace: any = null;
  let savePending = $state(false);
  const snapshot = (value: any) => JSON.parse(JSON.stringify(value));

  onMount(() => {
    let alive = true;
    const saved = readDraft<any>("snake-controls", null);
    seed =
      saved && typeof saved.seed === "string" && validSeed(saved.seed) ? saved.seed : randomSeed();
    if (saved && Number.isInteger(saved.runLength) && saved.runLength >= 1)
      runLength = saved.runLength;
    if (saved?.pace === "fast" || saved?.pace === "readable") pace = saved.pace;
    game = createGame(seed);
    hydrated = true;
    get("/api/capabilities")
      .then((data) => {
        if (!alive) return;
        if (data.error) throw new Error(data.error);
        const value = data.benchmarks?.max_steps;
        // No reported limit is not a failure: the field is optional, and a run can still be
        // stepped by hand. Only a malformed value is worth a recovery notice.
        maxSteps = Number.isInteger(value) && value > 0 ? value : null;
      })
      .catch((e) => {
        if (alive) error = e.message;
      });
    return () => {
      alive = false;
    };
  });
  $effect(() => {
    if (hydrated) saveDraft("snake-controls", { seed, runLength, pace });
  });

  $effect(() => {
    backend;
    comparison;
    compareBackends.join(",");
    stop();
    stats = {};
    moves = [];
  });
  onDestroy(stop);

  function stop() {
    generation++;
    if (activeTrace) {
      void persistRecording("stopped");
    }
    controller?.abort();
    controller = null;
    playing = false;
    busy = false;
    remaining = 0;
    phase = "";
  }

  function reset() {
    stop();
    if (!validSeed(seed)) {
      error = "Use 1–64 letters, numbers, dots, underscores or hyphens for the seed.";
      return;
    }
    replaying = false;
    game = createGame(seed);
    moves = [];
    stats = {};
    error = "";
    uiMs = null;
    elapsedMs = null;
    intentionalMs = 0;
  }

  async function measure(id: string, state: string, signal: AbortSignal) {
    const start = performance.now();
    const result: any = await api.custom(state, SNAKE_QUESTIONS, { backend: id }, signal);
    const roundtrip_ms = performance.now() - start;
    if (result.error) throw new Error(result.error);
    const answer = result.answers?.find((item: any) => item.id === "food_direction");
    if (!answer || !DIRECTIONS.includes(answer.value))
      throw new Error("The model returned no valid food direction.");
    return { result, answer, roundtrip_ms };
  }

  async function waitForPace(ms: number, signal: AbortSignal) {
    const start = performance.now();
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Stopped", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return performance.now() - start;
  }

  async function run(steps: number) {
    if (busy || game.finished || !engines.length || savePending) return;
    // `maxSteps === null` means the server reported no ceiling, not that the round is refused.
    if (!Number.isInteger(steps) || steps < 1 || (maxSteps !== null && steps > maxSteps)) {
      error =
        maxSteps === null
          ? "Choose a whole number of steps, one or more."
          : `Choose a whole number of steps from 1 to ${maxSteps}.`;
      return;
    }
    const ids = [...engines];
    // A replay is inspection only; a fresh live round starts from the seed.
    if (replaying || seed !== (game.seed ?? SNAKE_SEED)) {
      if (!validSeed(seed)) {
        error = "Enter a valid seed before running.";
        return;
      }
      game = createGame(seed);
    }
    replaying = false;
    const request = ++generation;
    controller = new AbortController();
    const signal = controller.signal;
    busy = true;
    playing = steps > 1;
    remaining = steps;
    error = "";
    moves = [];
    stats = {};
    elapsedMs = null;
    uiMs = null;
    intentionalMs = 0;
    activeTrace = {
      schema_version: 1,
      kind: "snake",
      title: `${ids.map(label).join(" + ")} · ${steps} steps`,
      started_at: new Date().toISOString(),
      requested_steps: steps,
      engines: ids.map((id) => ({ id, label: label(id), model: SNAKE_MODEL })),
      initial_game: snapshot(game),
      frames: [],
      warmups: {},
      metadata: {
        seed: game.seed ?? SNAKE_SEED,
        random_revision: game.rng_state === undefined ? "legacy-fixed-v1" : SNAKE_RANDOM_REVISION,
        question_revision: SNAKE_QUESTION_REVISION,
        question_schema: SNAKE_QUESTIONS,
        comparison,
        pace,
        elapsed_ms: 0,
      },
    };
    try {
      // A separate unscored request warms each engine. Cold compilation is never
      // mixed with the measured means, including when an engine was already warm.
      for (const id of ids) {
        phase = `Warming ${label(id)}…`;
        try {
          const warm = await measure(id, describeBoard(game), signal);
          if (request !== generation) return;
          activeTrace.warmups[id] = {
            roundtrip_ms: warm.roundtrip_ms,
            cold_compile: warm.result.timings?.cold_compile ?? false,
          };
          stats = {
            ...stats,
            [id]: {
              count: 0,
              correct: 0,
              infer_ms: 0,
              server_ms: 0,
              roundtrip_ms: 0,
              queue_ms: 0,
              warmup_ms: warm.roundtrip_ms,
              cold_compile: warm.result.timings?.cold_compile ?? null,
              error: "",
            },
          };
        } catch (e: any) {
          if (signal.aborted) throw e;
          stats = { ...stats, [id]: { count: 0, error: e.message || "Warmup failed" } };
        }
      }
      const active = ids.filter((id) => !stats[id]?.error);
      if (active.length !== ids.length)
        throw new Error(
          "A selected engine failed warmup. Open Compute or deselect that engine; the comparison needs all engines ready.",
        );
      const started = performance.now();
      for (let index = 0; index < steps && !game.finished; index++) {
        if (signal.aborted || request !== generation) return;
        const current = game,
          text = describeBoard(current),
          expected = directionToFood(current);
        const measurements: any[] = [];
        const nextStats = { ...stats };
        // Sequential calls avoid competition for memory and CPU resources. Rotate
        // order each turn so one device is not always measured first.
        for (const id of comparisonOrder(active, index)) {
          phase = `Step ${index + 1}/${steps} · ${label(id)}`;
          try {
            const measured = await measure(id, text, signal);
            if (request !== generation) return;
            const { result, answer, roundtrip_ms } = measured;
            const policy = chooseMove(current, answer.value);
            const previous = nextStats[id];
            const infer = result.timings?.infer_ms;
            const queue = result.timings?.queue_ms;
            nextStats[id] = {
              ...previous,
              count: previous.count + 1,
              correct: previous.correct + Number(answer.value === expected),
              infer_ms:
                infer == null || previous.infer_ms === null ? null : previous.infer_ms + infer,
              queue_ms:
                queue == null || previous.queue_ms === null ? null : previous.queue_ms + queue,
              server_ms: previous.server_ms + result.ms,
              roundtrip_ms: previous.roundtrip_ms + roundtrip_ms,
              answer: answer.value,
              probability: answer.probability,
            };
            measurements.push({
              id,
              answer: answer.value,
              probability: answer.probability,
              server_ms: result.ms,
              infer_ms: infer,
              queue_ms: queue,
              tokenize_ms: result.timings?.tokenize_ms,
              decode_ms: result.timings?.decode_ms,
              roundtrip_ms,
              policy,
            });
          } catch (e: any) {
            if (signal.aborted) throw e;
            stats = { ...stats, [id]: { ...stats[id], error: e.message || "Request failed" } };
            throw new Error(
              `${label(id)}: ${e.message || "Request failed"}. The run stopped so sample counts stay comparable.`,
            );
          }
        }
        // Publish a turn atomically: a failed/cancelled partial turn contributes
        // no samples, keeping per-device sample counts directly comparable.
        stats = nextStats;
        // Comparison replays one reference trajectory. Every engine receives
        // exactly the same input, even when their answers disagree.
        const policy = comparison ? chooseMove(current, expected) : measurements[0].policy;
        const updateStart = performance.now();
        game = policy.direction
          ? advance(current, policy.direction)
          : { ...current, finished: true };
        moves = [{ turn: current.turns + 1, expected, text, policy, measurements }, ...moves];
        remaining = steps - index - 1;
        await tick();
        uiMs = performance.now() - updateStart;
        const delay = requestedDelay(pace);
        const frame = {
          turn: index + 1,
          state: text,
          expected,
          board: snapshot(current),
          board_after: snapshot(game),
          measurements: snapshot(measurements),
          policy,
          ui_ms: uiMs || 0,
          intentional_ms: 0,
        };
        if (activeTrace) activeTrace.frames.push(frame);
        if (delay && remaining > 0 && !game.finished) {
          phase = `Readable pace · ${delay} ms added pause`;
          frame.intentional_ms = await waitForPace(delay, signal);
          intentionalMs += frame.intentional_ms;
        }
        elapsedMs = performance.now() - started;
        if (activeTrace) activeTrace.metadata.elapsed_ms = elapsedMs;
      }
      phase = "Run complete";
      await persistRecording("completed");
    } catch (e: any) {
      if (!signal.aborted && request === generation) {
        error = e.message || "The model request failed. Check Compute and try again.";
        await persistRecording("failed");
      }
    } finally {
      if (request === generation) {
        busy = false;
        playing = false;
        remaining = 0;
        controller = null;
      }
    }
  }

  async function persistRecording(status: string) {
    const recording = activeTrace;
    if (!recording) return;
    activeTrace = null;
    recording.status = status;
    recordState = "Saving recording…";
    savePending = true;
    try {
      const response: any = await post("/api/benchmarks/save", { run: recording });
      if (response.error) throw new Error(response.error);
      recordState = `Saved ${recording.frames.length} measured step${recording.frames.length === 1 ? "" : "s"} · ${status}`;
      historyRefresh++;
    } catch (e: any) {
      recordState = `Recording was not saved: ${e.message || "server unavailable"}`;
    } finally {
      savePending = false;
    }
  }

  function replayFrame(run: any, index: number) {
    stop();
    replaying = true;
    const frame = run.frames[index];
    game = snapshot(frame ? frame.board_after : run.initial_game);
    phase = `Replay · ${index + 1}/${run.frames.length} recorded steps · no model requests`;
    if (frame) {
      moves = [
        {
          turn: frame.turn,
          text: frame.state,
          expected: frame.expected,
          policy: frame.policy,
          measurements: frame.measurements,
        },
      ];
      uiMs = frame.ui_ms;
    }
  }
</script>

<View
  title="Snake demo"
  icon="play"
  subtitle="Run a round at device speed, read the timing per device, or replay a saved round frame by frame. This build has no model and no device, so a run stops and says so."
>
  <div class="demo">
    <div class="toolbar">
      <label for="snake-pace"
        >Speed<select id="snake-pace" class="field" bind:value={pace} disabled={busy}
          ><option value="fast">Fast · no added pause</option><option value="readable"
            >Readable · 200 ms pause</option
          ></select
        ></label
      >
      <label for="snake-length"
        >Steps{maxSteps === null ? " · no limit reported" : ` · 1–${maxSteps}`}<input
          id="snake-length"
          class="field"
          type="number"
          min="1"
          max={maxSteps ?? undefined}
          step="1"
          bind:value={runLength}
          disabled={busy}
        /></label
      >
      <div class="controls">
        {#if busy}<button class="btn btn-solid" onclick={stop}>Stop</button>{:else}<button
            class="btn btn-solid"
            onclick={() => run(runLength)}
            disabled={game.finished ||
              !engines.length ||
              savePending ||
              !Number.isInteger(runLength) ||
              runLength < 1 ||
              (maxSteps !== null && runLength > maxSteps) ||
              !validSeed(seed)}><Icon name="play" size={13} /> Run {runLength} steps</button
          >{/if}
        <button
          class="btn"
          onclick={() => run(1)}
          disabled={busy || game.finished || !engines.length || !validSeed(seed)}>Next step</button
        >
        <button class="btn" onclick={reset}>Reset</button>
      </div>
    </div>
    <div class="seed-controls">
      <label for="snake-seed"
        >Food seed<input
          id="snake-seed"
          class="field mono"
          bind:value={seed}
          maxlength="64"
          disabled={busy}
        /></label
      >
      <button
        class="btn"
        disabled={busy}
        onclick={() => {
          seed = randomSeed();
          reset();
        }}>New random board</button
      >
      <button class="btn" disabled={busy || !validSeed(seed)} onclick={reset}
        >Replay this seed from start</button
      >
    </div>
    <p class="mode-note">
      Food is sampled from empty cells using the saved seed. Reuse a seed for a repeatable
      trajectory; select Compare to give every device the same board and food at each step. A round
      may end before its step limit when no legal move remains.
    </p>
    {#if !engines.length}<p class="error">
        Choose a CPU, NPU or GPU device in the header to record a Snake run.
      </p>{/if}
    <p class="mode-note">
      {#if comparison}Comparing {engines.map(label).join(" + ") || "no engines selected"}. All
        engines receive the same state. The board follows a reference policy; comparisons run
        sequentially in rotating order.{:else}{label(backend)} controls the snake through a collision
        policy. Fast mode makes the next request immediately after the UI updates.{/if}
    </p>
    {#if error}<RecoveryNotice message={error} />{/if}
    <div class="demo-layout">
      <section class="game-pane" aria-label="Snake game">
        <svg
          class="board"
          viewBox="0 0 360 360"
          role="img"
          aria-label="Snake board. Score {game.score}. Head at column {game.body[0].x +
            1}, row {game.body[0].y + 1}. Food at column {game.food.x + 1}, row {game.food.y + 1}."
        >
          <title>Snake controlled by Laya and a collision policy</title>
          <rect width="360" height="360" rx="8" fill="var(--color-panel)" />
          {#each cells as cell}<rect
              x={cell.x * 30 + 1}
              y={cell.y * 30 + 1}
              width="28"
              height="28"
              rx="2"
              fill="var(--color-panel-2)"
            />{/each}
          {#each game.body as part, i}<rect
              x={part.x * 30 + 3}
              y={part.y * 30 + 3}
              width="24"
              height="24"
              rx={i === 0 ? 6 : 3}
              fill={i === 0 ? "#e8f2ec" : "#6fa68a"}
            />{/each}
          <circle cx={game.food.x * 30 + 15} cy={game.food.y * 30 + 15} r="8" fill="#f5b96d" />
        </svg>
        <div class="score-row">
          <span><strong>{game.score}</strong> food collected</span><span
            ><strong>{game.turns}</strong> moves played</span
          >
        </div>
        <p class="hint status" role="status">
          {busy
            ? phase
            : game.finished
              ? "Round complete. Reset to try again."
              : phase ||
                (engines.length
                  ? "Ready. Every step calls the real model."
                  : "No device is selected, so a run cannot start here.")}{busy && remaining
            ? ` · ${remaining} remaining`
            : ""}
        </p>
      </section>
      <section class="decision-pane" aria-labelledby="snake-decision-title">
        <h3 id="snake-decision-title">Where the time goes</h3>
        <dl class="decision">
          <div>
            <dt>Last UI update</dt>
            <dd>{uiMs === null ? "—" : `${uiMs.toFixed(1)} ms`}</dd>
          </div>
          <div>
            <dt>Added pacing</dt>
            <dd>{requestedDelay(pace)} ms / step</dd>
          </div>
          <div>
            <dt>Actual pacing this round</dt>
            <dd>{intentionalMs.toFixed(0)} ms</dd>
          </div>
          <div>
            <dt>Measured round, excluding warmup</dt>
            <dd>{elapsedMs === null ? "—" : `${(elapsedMs / 1000).toFixed(2)} s`}</dd>
          </div>
        </dl>
        {#if last}<p>
            {comparison ? "Reference move" : "Policy played"}:
            <strong>{last.policy.direction || "Stop"}</strong>. {last.policy.reason}
          </p>
          <details>
            <summary>Text every device received</summary>
            <p>{last.text}</p>
          </details>{/if}
        <p class="hint">
          Inference is device execution. Server time also includes tokenisation, queueing and
          decoding. HTTP time includes the local request and response. UI update measures the DOM
          change; browser paint and OS compositing are not measured.
        </p>
        <p class="hint">
          Warmup is shown separately and excluded from means. Stop cancels browser requests and
          prevents new steps; work already running on a device may finish locally.
        </p>
      </section>
    </div>
    <section class="engine-results" aria-labelledby="snake-engines-title">
      <h3 id="snake-engines-title">
        {comparison ? "Selected device comparison" : "Selected device"}
      </h3>
      <div class="table-wrap">
        <table>
          <caption class="sr-only">
            Samples, correctness and latency per selected engine
          </caption>
          <thead
            ><tr
              ><th>Device</th><th>Samples</th><th>Correct</th><th>Inference mean</th><th
                >HTTP mean</th
              ><th>Last answer</th></tr
            ></thead
          ><tbody>
            {#each engines as id}{@const row = stats[id]}<tr
                ><th>{label(id)}</th><td>{row?.count || 0}</td><td
                  >{row?.count ? `${row.correct}/${row.count}` : "—"}</td
                ><td>{avg(row, "infer_ms")}</td><td>{avg(row, "roundtrip_ms")}</td><td
                  >{row?.error ||
                    (row?.answer
                      ? `${row.answer} · ${(row.probability * 100).toFixed(1)}%`
                      : "Ready")}</td
                ></tr
              >{/each}
          </tbody>
        </table>
      </div>
      {#if !engines.length}<p>Select at least one local engine in the header.</p>{/if}
      <details class="history">
        <summary>Warmup and timing breakdown</summary>
        <div class="table-wrap">
          <table>
            <caption class="sr-only">
              Server, queue and warmup latency per selected engine
            </caption>
            <thead
              ><tr><th>Device</th><th>Server mean</th><th>Queue mean</th><th>Warmup HTTP</th></tr
              ></thead
            ><tbody
              >{#each engines as id}{@const row = stats[id]}<tr
                  ><th>{label(id)}</th><td>{avg(row, "server_ms")}</td><td
                    >{avg(row, "queue_ms")}</td
                  ><td
                    >{row?.warmup_ms == null
                      ? "—"
                      : `${row.warmup_ms.toFixed(1)} ms`}{row?.cold_compile ? " (cold)" : ""}</td
                  ></tr
                >{/each}</tbody
            >
          </table>
        </div>
      </details>
    </section>
    {#if recordState}<p class="record-status" role="status">{recordState}</p>{/if}
    <SnakeHistory refresh={historyRefresh} onReplay={replayFrame} />
    <p class="scope">
      The browser computes relative food location and describes it in English. Laya classifies that
      sentence; a policy moves the snake. This measures a text-classification workload. It does not
      establish visual game understanding, spatial reasoning, power consumption or a win over Jev.
    </p>
    {#if moves.length}<details class="history">
        <summary>Inspect {moves.length} measured steps</summary>
        <div class="table-wrap">
          <table>
            <caption class="sr-only">
              Each measured step, its food direction and every selected engine's answer
            </caption>
            <thead
              ><tr
                ><th>Step</th><th>Food direction</th><th>Played</th>{#each engines as id}<th
                    >{label(id)} answer / HTTP</th
                  >{/each}</tr
              ></thead
            ><tbody
              >{#each moves as move}<tr
                  ><td>{move.turn}</td><td>{move.expected}</td><td
                    >{move.policy.direction || "Stop"}</td
                  >{#each engines as id}{@const result = move.measurements.find(
                      (row: any) => row.id === id,
                    )}<td
                      >{result
                        ? `${result.answer} / ${result.roundtrip_ms.toFixed(1)} ms`
                        : "—"}</td
                    >{/each}</tr
                >{/each}</tbody
            >
          </table>
        </div>
      </details>{/if}
  </div>
</View>

<style>
  .seed-controls {
    display: flex;
    align-items: end;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 12px;
  }
  .seed-controls label {
    display: grid;
    gap: 5px;
    font-size: 12px;
    flex: 1 1 250px;
    max-width: 430px;
  }
  .seed-controls input {
    width: 100%;
  }
  .demo {
    max-width: 1320px;
    width: 100%;
    font-size: 13px;
    line-height: 1.6;
  }
  .toolbar {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 16px;
    margin-bottom: 14px;
  }
  .toolbar label {
    display: grid;
    gap: 6px;
    font-size: 12px;
    color: var(--color-ink-2);
  }
  .record-status {
    margin: 18px 0;
    font-size: 12px;
  }
  .toolbar input {
    min-height: 44px;
    width: 120px;
  }
  .toolbar select {
    min-height: 44px;
    min-width: 150px;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-left: auto;
  }
  h3 {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--color-ink);
    margin-bottom: 12px;
  }
  p,
  dt {
    color: var(--color-ink-2);
  }
  .mode-note {
    max-width: 90ch;
    margin-bottom: 20px;
  }
  .demo-layout {
    display: grid;
    grid-template-columns: minmax(240px, 0.8fr) minmax(0, 1fr);
    border: 1px solid var(--color-line);
    border-radius: 12px;
    overflow: hidden;
  }
  .game-pane {
    padding: 20px;
  }
  .board {
    width: min(100%, 330px);
    display: block;
    margin: auto;
  }
  .score-row {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin: 16px 0;
    font-size: 12px;
    color: var(--color-ink-2);
  }
  .score-row strong {
    color: var(--color-ink);
    font-size: 16px;
    font-variant-numeric: tabular-nums;
    margin-right: 4px;
  }
  .btn {
    min-height: 44px;
    padding: 10px 14px;
  }
  .decision-pane {
    border-left: 1px solid var(--color-line);
    background: var(--color-panel);
    padding: 22px;
    min-width: 0;
  }
  .decision {
    display: grid;
    gap: 12px;
    margin: 18px 0;
  }
  .decision div {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
  }
  dd {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  summary {
    cursor: pointer;
    color: var(--color-ink-2);
    min-height: 44px;
    padding: 10px 0;
  }
  .hint {
    font-size: 12px;
    margin-top: 14px;
  }
  .status {
    min-height: 38px;
  }
  .error {
    padding: 12px;
    border: 1px solid #7b3a3a;
    border-radius: 8px;
    color: #ffb4b4;
    background: #241616;
    margin-bottom: 18px;
  }
  .engine-results {
    margin-top: 24px;
  }
  .scope {
    font-size: 12px;
    max-width: 100ch;
    margin: 18px 0;
  }
  .table-wrap {
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 12px;
  }
  th {
    font-weight: 500;
    color: var(--color-ink-2);
  }
  td,
  th {
    padding: 11px 12px;
    border-bottom: 1px solid var(--color-line);
    white-space: nowrap;
  }
  tbody th {
    color: var(--color-ink);
    font-weight: 600;
  }
  @media (max-width: 850px) {
    .demo-layout {
      grid-template-columns: 1fr;
    }
    .decision-pane {
      border-left: 0;
      border-top: 1px solid var(--color-line);
    }
    .controls {
      margin-left: 0;
    }
  }
  @media (max-width: 480px) {
    .game-pane,
    .decision-pane {
      padding: 16px;
    }
    .toolbar label {
      flex: 1;
    }
    .controls {
      width: 100%;
    }
    .controls .btn {
      flex: 1;
      justify-content: center;
    }
  }
</style>

<script lang="ts">
  import RecoveryNotice from "#lib/RecoveryNotice.svelte";
  import { onDestroy, onMount } from "svelte";
  import SpeechControls from "#lib/SpeechControls.svelte";
  import { readDraft, saveDraft } from "#lib/drafts.js";
  import View from "#lib/View.svelte";
  import { Icon } from "../../../shared/icons/index.js";
  import { get, postAudio } from "#lib/http.js";
  import Recorder from "#lib/Recorder.svelte";

  type Props = { backend?: string; active?: boolean };
  let { backend = "", active = true }: Props = $props();

  let meta = $state<any>(null);
  let result = $state<any>(null);
  let busy = $state(false);
  let error = $state("");
  let dragging = $state(false);
  let fileName = $state("");
  let task = $state("triage");
  let fileInput: HTMLInputElement;
  let audioUrl = $state("");
  let device = $state("");
  let language = $state("en");
  let draftReady = $state(false);
  onMount(() => {
    const saved = readDraft<any>("voice", null);
    if (typeof saved?.task === "string") task = saved.task;
    if (typeof saved?.fileName === "string") fileName = saved.fileName;
    if (saved?.result && typeof saved.result.transcript?.text === "string") result = saved.result;
    draftReady = true;
  });
  $effect(() => {
    if (draftReady) saveDraft("voice", { task, fileName, result });
  });
  onDestroy(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  });

  $effect(() => {
    get("/api/pipeline")
      .then((d) => {
        if (d.error) throw new Error(d.error);
        meta = d;
      })
      .catch(
        (e) => (error = `Could not check voice pipeline: ${e.message}. Retry by reopening Voice.`),
      );
  });

  async function upload(file: File) {
    if (!file || busy) return;
    if (!meta?.asr?.devices?.includes(device)) {
      error = "Choose an available transcription device first.";
      return;
    }
    if (
      !meta?.asr?.max_mb ||
      (!meta.asr.languages?.includes(language) && !(language === "auto" && meta.asr.multilingual))
    ) {
      error = "Choose a supported speech language after the model status loads.";
      return;
    }
    if (file.size > meta.asr.max_mb * 1024 * 1024) {
      error = `This file exceeds ${meta.asr.max_mb} MB. Trim or compress it, then choose it again.`;
      return;
    }
    busy = true;
    error = "";
    result = null;
    fileName = file.name;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(file);
    try {
      const buf = await file.arrayBuffer();
      const r = await postAudio("/api/voice", buf, {
        "Content-Type": "application/octet-stream",
        "X-Device": device,
        "X-Language": language,
        "X-Task": task,
      });
      const d = r;
      if (d.error) throw new Error(d.error);
      result = d;
    } catch (e: any) {
      error = String(e.message ?? e);
    } finally {
      busy = false;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) upload(f);
  }

  function onPick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (f) upload(f);
  }
</script>

<View
  title="Voice to action"
  icon="mic"
  subtitle="A recording in, a decision out: speech to text, then a classification, then a rule that picks the next step. This browser build has neither model, so the panels report that instead of pretending."
>
  {#snippet actions()}
    <select
      aria-label="Decision task for voice note"
      class="field h-7 w-auto text-[11.5px]"
      bind:value={task}
      disabled={busy}
    >
      {#each meta?.tasks ?? [] as t}
        <option value={t.id}>{t.label}</option>
      {/each}
    </select>
    <span class="chip mono">{device || "no device"}</span>
  {/snippet}
  <div class="mb-3">
    <SpeechControls bind:device bind:language status={meta?.asr} disabled={busy} />
    <p class="mb-3 text-[12px] text-ink-2">
      The speech language can differ from the decision language. The decision checkpoint expects
      English, so read a non-English transcript before trusting the decision that follows it.
    </p>
    <Recorder
      {active}
      disabled={busy || !meta?.asr?.devices?.includes(device) || meta?.asr?.present === false}
      onRecorded={upload}
      maxSeconds={meta?.asr?.max_seconds ?? 300}
      label="Record a voice note"
    />
  </div>

  <input
    bind:this={fileInput}
    type="file"
    aria-label="Voice note to process"
    accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm,.mp4"
    onchange={onPick}
    class="hidden"
  />
  {#if audioUrl}<div class="mb-3">
      <p class="mb-2 text-[12px] text-ink-2">Listen to {fileName}</p>
      <audio controls src={audioUrl} class="w-full" aria-label="Uploaded voice note playback"
      ></audio>
    </div>{/if}

  <div class="mb-3 flex shrink-0 flex-wrap items-center gap-1.5">
    {#each ["transcribe", "decide", "policy"] as stage, i}
      <span class="chip mono">{i + 1}. {stage}</span>
      {#if i < 2}<span class="text-[10px] text-ink-3">then</span>{/if}
    {/each}
    <span class="chip ml-auto">local in the desktop app</span>
  </div>

  <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
    <div
      class="card flex min-h-[240px] flex-col items-center justify-center p-6 text-center transition-colors
        {dragging ? 'border-ink/50 bg-panel-2' : ''}"
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={onDrop}
      role="region"
      aria-label="Voice note upload and transcript"
      aria-busy={busy}
    >
      {#if busy}
        <Icon name="mic" size={24} />
        <p class="mt-3 text-[13px]">Working on {fileName}…</p>
        <p class="mt-1 text-[11.5px] text-ink-3">transcribe, then decide</p>
      {:else if result}
        <div class="w-full text-left">
          <div class="mb-2 flex flex-wrap gap-1.5">
            <span class="chip mono">{result.transcript.seconds}s audio</span>
            <span class="chip mono">{result.timings.total_s}s total</span>
            <span class="chip mono">{result.realtime}x realtime</span>
          </div>
          <span class="label">Transcript</span>
          <textarea
            class="field mt-2 text-[13px] leading-relaxed"
            rows="5"
            aria-label="Review and edit voice transcript"
            bind:value={result.transcript.text}
            oninput={() => {
              result = {
                ...result,
                decision: null,
                action: "review",
                action_label: "Transcript edited · review required",
                review: true,
                stage: "review",
                reasons: [
                  "This edited transcript has not been sent to the decision model. Use English text in Decision simulation to evaluate a policy.",
                ],
              };
            }}></textarea>
          <button
            class="btn mt-2"
            onclick={() => {
              const url = URL.createObjectURL(
                new Blob([result.transcript.text], { type: "text/plain;charset=utf-8" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "voice-transcript.txt";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}>Download edited transcript</button
          >
          <button
            class="btn mt-3 h-6 text-[10.5px]"
            onclick={() => {
              result = null;
              error = "";
            }}
          >
            New file
          </button>
        </div>
      {:else}
        <Icon name="mic" size={24} />
        <p class="mt-3 text-[13px]">Drop a voice note</p>
        <p class="mt-1 text-[11.5px] text-ink-3">
          {#if meta?.asr?.max_mb && meta?.asr?.max_seconds}
            {meta.asr.formats?.join(", ") ?? "Supported formats load with the model"}. Up to
            {meta.asr.max_mb} MB and {meta.asr.max_seconds} seconds.
          {:else if meta}
            No file limit is reported: a speech model supplies it, and this build loads none.
          {:else}
            Waiting for the supported formats.
          {/if}
        </p>
        <button
          class="btn btn-solid mt-4"
          disabled={meta?.asr?.present === false}
          onclick={() => fileInput?.click()}>Choose file</button
        >
        {#if meta?.asr?.present === false}<p class="mt-2 text-[12px]">
            No speech model is loaded in this build. The desktop app reads one from Transcribe.
          </p>{/if}
      {/if}
    </div>

    <div class="flex min-h-0 flex-col gap-3">
      {#if error}
        <RecoveryNotice message={error} />
      {:else if !result}
        <div
          class="card flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-ink-3"
        >
          <Icon name="sparkles" size={22} />
          <p class="max-w-[260px] text-[12px]">
            The decision appears here with every answer and the rule that produced the action.
          </p>
        </div>
      {:else}
        <div
          class="min-h-0 flex-1 overflow-y-auto rounded-card border border-line bg-[#030303] p-3.5"
        >
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span class="text-[17px] font-semibold">{result.action_label}</span>
            <div class="flex gap-1.5">
              <span class="chip mono">{result.timings.asr_s}s asr</span>
              <span class="chip mono">{result.timings.decision_s}s decide</span>
              {#if result.review}<span class="chip" style="color:#e9c93a">review</span>{/if}
            </div>
          </div>

          <div class="mb-3 rounded-card border border-line-2 bg-panel-2 p-2.5">
            {#each result.reasons as r}
              <p class="mono text-[10.5px] leading-relaxed text-ink-3">· {r}</p>
            {/each}
          </div>

          {#if result.stage === "review"}<a class="btn mb-3" href="#playground"
              >Open English decision simulation</a
            >{/if}
          {#each result.decision?.answers ?? [] as a}
            <div class="mb-2 rounded-card border border-line-2 bg-panel-2 p-2.5">
              <div class="mb-1.5 flex items-baseline justify-between gap-2">
                <span class="label">{a.label}</span>
                <span class="text-[12px] font-semibold">
                  {a.type === "noul" ? (a.value ? "yes" : "no") : a.value}
                  <span class="mono ml-1 text-[10px] text-ink-3">p={a.probability.toFixed(2)}</span>
                </span>
              </div>
              {#if a.ranked}
                {#each a.ranked as r}
                  <div class="grid grid-cols-[1fr_80px_40px] items-center gap-2 text-[11px]">
                    <span class={r.name === a.value ? "font-semibold text-ink" : "text-ink-3"}
                      >{r.name}</span
                    >
                    <div class="h-1 overflow-hidden rounded bg-line">
                      <div class="h-full rounded bg-ink-2" style="width:{r.p * 100}%"></div>
                    </div>
                    <span class="mono text-right text-[9.5px] text-ink-3">{r.p.toFixed(2)}</span>
                  </div>
                {/each}
              {:else if a.type === "score"}
                <div class="flex gap-1">
                  {#each a.scale as lv, i}
                    <span
                      class="mono grid size-5 place-items-center rounded border text-[9px]
                      {i === Math.round(a.value)
                        ? 'border-ink bg-ink font-bold text-black'
                        : 'border-line text-ink-3'}">{i}</span
                    >
                  {/each}
                </div>
              {:else}
                <div class="h-1 overflow-hidden rounded bg-line">
                  <div class="h-full rounded bg-ink" style="width:{a.probability * 100}%"></div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</View>

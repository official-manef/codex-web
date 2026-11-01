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

  let available = $state<any>(null);
  let result = $state<any>(null);
  let busy = $state(false);
  let error = $state("");
  let dragging = $state(false);
  let fileName = $state("");
  let fileInput: HTMLInputElement;
  let audioUrl = $state("");
  let device = $state("");
  let language = $state("en");
  let draftReady = $state(false);
  onMount(() => {
    const saved = readDraft<any>("transcribe", null);
    if (typeof saved?.fileName === "string") fileName = saved.fileName;
    if (saved?.result && typeof saved.result.text === "string")
      result = { ...saved.result, restored: true };
    draftReady = true;
  });
  $effect(() => {
    if (draftReady) saveDraft("transcribe", { fileName, result });
  });
  onDestroy(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  });

  $effect(() => {
    get("/api/asr")
      .then((d) => {
        if (d.error) throw new Error(d.error);
        available = d;
      })
      .catch(
        (e) =>
          (error = `Could not check speech model: ${e.message}. Retry by reopening Transcribe.`),
      );
  });

  async function upload(file: File) {
    if (!file || busy) return;
    if (!available?.devices?.includes(device)) {
      error = "Choose an available transcription device first.";
      return;
    }
    if (
      !available?.max_mb ||
      (!available?.languages?.includes(language) &&
        !(language === "auto" && available?.multilingual))
    ) {
      error = "Choose a supported speech language after the model status loads.";
      return;
    }
    if (file.size > available.max_mb * 1024 * 1024) {
      error = `This file exceeds ${available.max_mb} MB. Trim or compress it, then choose it again.`;
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
      const r = await postAudio("/api/asr", buf, {
        "X-Device": device,
        "X-Language": language,
        "X-Timestamps": "true",
        "Content-Type": "application/octet-stream",
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

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.[^.]+$/, "") + ".txt";
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<View
  title="Transcribe"
  icon="mic"
  subtitle="Speech to text from a recording. The desktop app runs Whisper int8 on the device you pick, with no API key and no per-minute cost. This browser build has no speech model, so the panel stays closed and says why."
>
  {#snippet actions()}
    <button
      class="btn"
      disabled={busy || available?.present === false}
      onclick={() => fileInput?.click()}>Choose audio file</button
    >
    {#if available}<span class="chip mono"
        >{available.present ? "model ready" : "no speech model"}</span
      >{/if}
    <span class="chip mono">{device || "no device"}</span>
  {/snippet}
  <div class="mb-3">
    <SpeechControls bind:device bind:language status={available} disabled={busy} />
    <Recorder
      {active}
      disabled={busy || !available?.devices?.includes(device) || available?.present === false}
      onRecorded={upload}
      maxSeconds={available?.max_seconds ?? 300}
      label="Record and transcribe"
    />
  </div>
  {#if result?.restored}<p class="mb-3 text-[12px] text-ink-2">
      Transcript draft restored after a refresh. Re-select the audio file if you want to play it
      again.
    </p>{/if}

  <input
    bind:this={fileInput}
    type="file"
    aria-label="Audio file to transcribe"
    accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm,.mp4"
    onchange={onPick}
    class="hidden"
  />
  {#if audioUrl}<div class="mb-3">
      <p class="mb-2 text-[12px] text-ink-2">Playing {fileName}</p>
      <audio controls src={audioUrl} class="w-full" aria-label="Uploaded audio playback"></audio>
    </div>{/if}

  {#if available && !available.present}
    <div class="card mb-3 p-4">
      <span class="label">No speech model in this build</span>
      <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">
        The desktop app downloads whisper-base int8 and points an environment variable at it. Those
        steps apply to that build only: there is no filesystem and no runtime here to run them
        against.
      </p>
    </div>
  {/if}

  <div
    class="card flex flex-1 flex-col items-center justify-center p-8 text-center transition-colors
      {dragging ? 'border-ink/50 bg-panel-2' : ''}"
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
    role="region"
    aria-label="Audio upload and transcript"
    aria-busy={busy}
  >
    {#if busy}
      <Icon name="mic" size={26} />
      <p class="mt-3 text-[13px]">Transcribing {fileName}…</p>
      <p class="mt-1 text-[11.5px] text-ink-3">
        On {device}. A first run compiles the model, so it takes longer than the rest.
      </p>
    {:else if result}
      <div class="w-full max-w-[720px] text-left">
        <div class="mb-3 flex flex-wrap items-center gap-1.5">
          <span class="chip mono">{result.seconds}s audio</span>
          <span class="chip mono">{result.infer_s}s infer</span>
          <span class="chip mono">{result.speedup}x realtime</span>
          <span class="chip mono">{result.device}</span>
          <button class="btn ml-auto h-6 text-[10.5px]" onclick={download}>Download .txt</button>
        </div>
        <label for="transcript-editor" class="mb-2 block text-[13px] font-semibold"
          >Review and edit transcript</label
        >
        <textarea
          id="transcript-editor"
          class="field min-h-[180px] text-[14px] leading-relaxed"
          rows="7"
          bind:value={result.text}></textarea>
        <p class="mt-2 text-[12px] text-ink-2">
          Your edits are included in the downloaded text.
        </p>
      </div>
    {:else}
      <Icon name="mic" size={26} />
      <p class="mt-3 text-[13px]">Drop an audio file here</p>
      <p class="mt-1 text-[11.5px] text-ink-3">or choose one</p>
      <button
        class="btn btn-solid mt-4"
        disabled={available?.present === false}
        onclick={() => fileInput?.click()}>Choose file</button
      >
      <p class="mt-2 text-[11.5px] text-ink-3">
        {#if available?.max_mb && available?.max_seconds}
          Up to {available.max_mb} MB and {available.max_seconds} seconds.
        {:else if available}
          No file limit is reported: a speech model supplies it, and this build loads none.
        {:else}
          Waiting for the speech model status. Nothing is sent anywhere in this build.
        {/if}
      </p>
    {/if}
  </div>

  {#if error}
    <RecoveryNotice message={error} />
  {/if}

  <div class="card mt-3 p-4">
    <span class="label">About the timings</span>
    <p class="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">
      This build ships no saved speech measurements. When a transcript does come back, the numbers
      above describe that one file on that one device, not a benchmark.
    </p>
  </div>
</View>

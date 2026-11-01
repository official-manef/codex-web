<script lang="ts">
  import View from "#lib/View.svelte";

  const ROWS = [
    { label: "NPU", ms: "—", compile: "—", status: "Placeholder · unmeasured" },
    { label: "GPU", ms: "—", compile: "—", status: "Placeholder · unmeasured" },
    { label: "CPU", ms: "—", compile: "—", status: "Placeholder · unmeasured" },
  ];

  const SPEECH_ROWS = [
    { device: "NPU", s: "—", realtime: "—", status: "Placeholder · unmeasured" },
    { device: "GPU", s: "—", realtime: "—", status: "Placeholder · unmeasured" },
    { device: "CPU", s: "—", realtime: "—", status: "Placeholder · unmeasured" },
  ];
</script>

<View
  title="Benchmarks"
  icon="gauge"
  subtitle="This template ships no saved measurements. There is no active benchmark data source or recorded run on this machine."
>
  <div class="card mb-4 p-4">
    <p class="text-[12px] leading-relaxed text-ink-2">
      No benchmark figures are currently recorded for this installation. Previous numbers were recorded on external hardware and are not representative of this system.
    </p>
  </div>

  <h2 class="mb-2 text-[15px] font-semibold">Decision benchmarks (unmeasured)</h2>
  <div class="card overflow-x-auto">
    <table class="w-full min-w-[420px] text-left text-[13px]">
      <caption class="sr-only">Decision benchmarks placeholder table</caption><thead
        class="bg-panel-2 text-ink-2"
        ><tr
          ><th scope="col" class="px-4 py-3 font-medium">Device</th><th
            scope="col"
            class="px-4 py-3 font-medium">Warm question</th
          ><th scope="col" class="px-4 py-3 font-medium">First compile</th
          ><th scope="col" class="px-4 py-3 font-medium">Status</th></tr
        ></thead
      ><tbody
        >{#each ROWS as r}<tr class="border-t border-line"
            ><th scope="row" class="px-4 py-3 font-medium">{r.label}</th><td
              class="mono px-4 py-3 text-ink-2">{r.ms}</td
            ><td class="mono px-4 py-3 text-ink-2">{r.compile}</td><td
              class="px-4 py-3 text-[11px] text-ink-3">{r.status}</td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>

  <h2 class="mt-6 mb-2 text-[15px] font-semibold">Whisper speech recognition (unmeasured)</h2>
  <div class="card overflow-x-auto">
    <table class="w-full min-w-[420px] text-left text-[13px]">
      <caption class="sr-only">Speech benchmark placeholder table</caption><thead
        class="bg-panel-2 text-ink-2"
        ><tr
          ><th scope="col" class="px-4 py-3 font-medium">Device</th><th
            scope="col"
            class="px-4 py-3 font-medium">Inference time</th
          ><th scope="col" class="px-4 py-3 font-medium">Realtime factor</th
          ><th scope="col" class="px-4 py-3 font-medium">Status</th></tr
        ></thead
      ><tbody
        >{#each SPEECH_ROWS as r}<tr class="border-t border-line"
            ><th scope="row" class="px-4 py-3 font-medium">{r.device}</th><td
              class="mono px-4 py-3 text-ink-2">{r.s}</td
            ><td class="mono px-4 py-3 text-ink-2">{r.realtime}</td><td
              class="px-4 py-3 text-[11px] text-ink-3">{r.status}</td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>

  <p class="mt-4 text-[12px] leading-relaxed text-ink-2">
    Chat generation is a separate generative workload; <a class="text-link" href="#chat"
      >Local chat</a
    > reports actual response time and token speed when a model is connected.
  </p>
</View>

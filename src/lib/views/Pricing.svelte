<script lang="ts">
  import View from "#lib/View.svelte";
  const ROWS = [
    [
      "Local decisions",
      "No per-request fee",
      "In the desktop app the classifier runs on the device you select, so no provider bills per request. This browser build runs no inference at all.",
    ],
    [
      "Local transcription",
      "No per-minute fee",
      "In the desktop app speech recognition runs on the same device, so nothing is metered per minute. This build has no speech model.",
    ],
    [
      "Chat",
      "No per-token fee",
      "In the desktop app a generative model you installed writes replies on that device. This build has no such model and says so instead of replying.",
    ],
    [
      "Model downloads",
      "Internet and storage",
      "Fetching a model costs bandwidth and disk space. No price is quoted here because it depends on the model and your connection, and this build downloads nothing.",
    ],
    [
      "Hardware and power",
      "Your running costs",
      "You supply the computer, the electricity and any upgrade it needs. Nothing in this repository can measure those.",
    ],
    [
      "Your own endpoint",
      "Provider-side billing",
      "That provider charges your account for its own requests. This app neither meters nor resells it, and no endpoint is connected in this build.",
    ],
  ];
</script>

<View
  title="Costs"
  icon="tag"
  subtitle="Informational overview, not a bill. This browser build has no billing route and no metering, and no endpoint is connected. The rows below describe the desktop app this workspace is copied from."
>
  <p class="mb-4 max-w-[70ch] text-[12px] leading-relaxed text-ink-2">
    A row marked <em>provider-side</em> applies only when you connect your own endpoint. No price
    list is shown because nothing in this repository would back one.
  </p>
  <dl class="card overflow-hidden">
    {#each ROWS as [item, cost, detail], i}<div
        class="grid grid-cols-1 gap-1 px-4 py-4 sm:grid-cols-[1fr_1.1fr_2fr] sm:gap-4 {i
          ? 'border-t border-line'
          : ''}"
      >
        <dt class="text-[13px] font-semibold">{item}</dt>
        <dd class="text-[12px]">{cost}</dd>
        <dd class="max-w-[70ch] text-[12px] leading-relaxed text-ink-2">{detail}</dd>
      </div>{/each}
  </dl>
  <div class="mt-6 max-w-[70ch]">
    <h2 class="text-[15px] font-semibold">Compare costs for your own workload</h2>
    <p class="mt-2 text-[13px] leading-relaxed text-ink-2">
      Use the same task, input size and quality requirement when comparing local inference with a
      hosted service. A short classification and a generated chat reply do different jobs and are
      not interchangeable per-token numbers. Check your provider's current pricing and measure the
      round trip on your own machine in
      <a class="text-link" href="#playground">Decision simulation</a>.
    </p>
    <a class="btn mt-3" href="#playground">Open Decision simulation</a>
  </div>
</View>

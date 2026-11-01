<script lang="ts">
  import View from "#lib/View.svelte";
  const ROWS = [
    [
      "Local decisions",
      "No per-request fee",
      "Laya classifies on the device you select; the desktop app this shell is copied from bills nothing per request.",
    ],
    [
      "Local transcription",
      "No per-minute fee",
      "Whisper runs on the same device; no provider is in the path, so nothing is metered per minute.",
    ],
    [
      "Local chat",
      "No per-token fee",
      "A generative model you installed writes replies on that device. This browser build has no such model and says so instead of replying.",
    ],
    [
      "Model downloads",
      "Internet and storage",
      "Fetching a model costs bandwidth and disk space; no price is quoted here because it depends on the model and your connection.",
    ],
    [
      "Hardware and power",
      "Your running costs",
      "You supply the computer, the electricity and any upgrade it needs. Nothing in this repository can measure those.",
    ],
    [
      "Your own endpoint",
      "Provider-side billing",
      "That provider charges your account for its own requests; this app neither meters nor resells it.",
    ],
  ];
</script>

<View
  title="Costs"
  icon="tag"
  subtitle="Informational overview, not a bill. This browser build has no billing route and no metering: nothing here charges for local inference and no subscription exists. The rows describe the laya-npu desktop app this shell is copied from."
>
  <p class="mb-4 max-w-[70ch] text-[12px] leading-relaxed text-ink-2">
    A row marked <em>provider-side</em> applies only when you connect your own endpoint. No price
    list is shown because none would be backed by anything in this repository.
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
      hosted service. A short classification and a generated chat reply perform different jobs.
      Check your provider’s current pricing and measure throughput on your own laptop.
    </p>
    <a class="btn mt-3" href="#playground">Compare engines on this machine</a>
  </div>
</View>

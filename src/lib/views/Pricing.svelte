<script lang="ts">
  import View from "#lib/View.svelte";
  const ROWS = [
    ["Local decisions", "No per-request fee", "Laya runs on your selected local device."],
    ["Local transcription", "No per-minute fee", "Whisper processes audio on your laptop."],
    [
      "Local chat",
      "No per-token fee",
      "The installed generative model runs on your selected local device.",
    ],
    [
      "Model downloads",
      "Internet and storage",
      "Downloading models uses bandwidth and disk space. Chat model size appears during setup.",
    ],
    [
      "Hardware and power",
      "Your running costs",
      "You supply the computer, electricity and any hardware upgrades.",
    ],
    [
      "Your own endpoint",
      "Provider billing",
      "A BYOK service may charge for requests or tokens under your contract.",
    ],
  ];
</script>

<View
  title="Costs"
  icon="tag"
  subtitle="Informational overview. This template has no billing backend or live metering data source. The app does not meter local inference or charge a subscription."
>
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
    <a class="btn mt-3" href="#performance">See benchmarks</a>
  </div>
</View>

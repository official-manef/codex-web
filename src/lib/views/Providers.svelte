<script lang="ts">
  import View from "#lib/View.svelte";
  type Props = { backends?: any[] };
  let { backends = [] }: Props = $props();
  const stub = $derived(backends.some((b) => (b as any).stub));
</script>

<View
  title="Providers"
  icon="server"
  subtitle="The compute backends this build can see. A device being present does not mean a model on it will compile; run one example in Decision simulation to find out."
>
  {#if backends.length}
    <div class="card overflow-x-auto">
      <table class="w-full min-w-[520px] text-left text-[12px]">
        <caption class="sr-only">Decision providers, device and status</caption><thead
          class="bg-panel-2 text-ink-2"
          ><tr
            >{#each ["Provider", "Device", "Latency", "Status"] as heading}<th
                scope="col"
                class="px-4 py-3 font-medium">{heading}</th
              >{/each}</tr
          ></thead
        ><tbody
          >{#each backends as b}<tr class="border-t border-line"
              ><th scope="row" class="px-4 py-3 font-medium">{b.label}</th><td
                class="px-4 py-3 mono text-ink-2">{b.device}</td
              ><td class="px-4 py-3 mono text-ink-2"
                >{b.latency_ms != null ? b.latency_ms + " ms" : "Not measured"}</td
              ><td class="px-4 py-3 text-ink-2"
                >{(b as any).stub
                  ? "Not configured"
                  : b.ready
                    ? "Ready"
                    : (b.reason ?? "Unknown")}</td
              ></tr
            >{/each}</tbody
    >
      </table>
    </div>
  {:else}
    <p class="mt-4 text-[13px] text-ink-2" role="status">
      No provider data. Reconnect a runtime, then open <a class="text-link" href="#setup"
        >Setup check</a
      >.
    </p>
  {/if}
  <p class="mt-4 max-w-[70ch] text-[12px] leading-relaxed text-ink-2">
    {#if stub}
      The single row above is the browser stub that keeps the composer usable. No model is loaded,
      nothing is measured, and an empty latency column means exactly that. The desktop app is the
      build that reports real devices here.
    {:else}
      Latency appears only when a device reports a measurement. The chat has its own model and
      device selection in <a class="text-link" href="#chat">Chat</a>.
    {/if}
  </p>
  <a class="btn mt-4 self-start" href="#backends">Configure devices and endpoint</a>
</View>

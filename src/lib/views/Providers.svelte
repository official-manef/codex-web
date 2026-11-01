<script lang="ts">
  import View from "#lib/View.svelte";
  type Props = { backends?: any[] };
  let { backends = [] }: Props = $props();
</script>

<View
  title="Providers"
  icon="server"
  subtitle="Decision backends reported by the local server. Device presence does not guarantee that every model will compile successfully."
>
  <div class="card overflow-x-auto">
    <table class="w-full min-w-[520px] text-left text-[12px]">
      <caption class="sr-only">Decision providers and availability</caption><thead
        class="bg-panel-2 text-ink-2"
        ><tr
          >{#each ["Provider", "Device", "Measured latency", "Status"] as heading}<th
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
                ? "Template stub · not configured"
                : b.ready
                  ? "Available"
                  : (b.reason ?? "Unknown")}</td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>
  {#if !backends.length}<p class="mt-4 text-[13px] text-ink-2" role="status">
      No provider data yet. Reconnect the local server, then open <a class="text-link" href="#setup"
        >Setup check</a
      >.
    </p>{/if}
  <p class="mt-4 max-w-[70ch] text-[12px] leading-relaxed text-ink-2">
    Latency is shown only when a device reports a measurement. Chat uses a separate generative
    model and its own device selection in <a class="text-link" href="#chat">Local chat</a>.
  </p>
  <a class="btn mt-4 self-start" href="#backends">Configure devices and endpoint</a>
</View>

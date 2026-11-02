<script lang="ts">
  import View from "#lib/View.svelte";
  import { Icon } from "../../../shared/icons/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Checkbox } from "#lib/components/ui/checkbox/index.js";
  import { WORKSPACE_VIEWS } from "#lib/registry.js";
  import { surfaceReason } from "#lib/config/surface.js";
  import { ALWAYS_ENABLED, FEATURE_ACCESS, accessLabel } from "#lib/feature_access.js";
  import { featureSettings } from "#lib/feature_settings.svelte.js";
  import { deviceTools } from "#lib/device_tools.svelte.js";
  import McpManager from "#lib/cloud/components/mcp-manager.svelte";
  import { env } from "$env/dynamic/public";
  import { onMount } from "svelte";
  import { useQuery } from "convex-svelte";
  import { api } from "../../convex/_generated/api.js";

  const uid = $props.id();
  const cloudUrl = env.PUBLIC_CONVEX_URL;

  /**
   * Device tools are a second switch, separate from the feature list: a tool can be visible
   * here and still stay off until the user turns it on, and it needs a paired device of its
   * kind before it can do anything.
   */
  type PairedRow = { kind: string; revokedAt?: number };
  const paired = cloudUrl ? useQuery(api.devices.list, () => ({})) : null;
  const deviceRows = $derived(
    ((paired?.data ?? []) as PairedRow[]).filter((row) => !row.revokedAt),
  );
  const deviceToolRows = $derived([
    {
      id: "terminal" as const,
      label: "Terminal",
      needs: "terminal",
      reason: "Runs a shell on a paired device. Off until you enable it, and needs a terminal device paired first.",
    },
    {
      id: "browser" as const,
      label: "Remote browser view",
      needs: "browser",
      reason: "Uses the paired device's own browser session. Off until you enable it.",
    },
  ]);
  let toolsStarted = $state(false);
  onMount(() => {
    deviceTools.start();
    toolsStarted = true;
  });
  const pairedKinds = $derived(new Set(deviceRows.map((row) => row.kind)));
  const hasDevice = (kind: string) => pairedKinds.has(kind);
  const surface = $derived(featureSettings.surface);
  const rows = $derived(
    WORKSPACE_VIEWS.filter(
      (view) => Object.hasOwn(FEATURE_ACCESS, view.id) && view.id !== "terminal",
    ).map((view) => ({
      id: view.id,
      label: view.label,
      icon: view.icon,
      requirement: FEATURE_ACCESS[view.id],
      locked: ALWAYS_ENABLED.includes(view.id),
    })),
  );
  const localRows = $derived(rows.filter((row) => row.requirement === "local-runtime"));
  const anyRows = $derived(rows.filter((row) => row.requirement === "any"));
  const groups = $derived([
    { heading: "Needs a runtime on this machine", rows: localRows },
    { heading: "Works without a runtime", rows: anyRows },
  ]);
  const canShowAll = $derived(featureSettings.hidden().length > 0);
  const canHideLocal = $derived(
    localRows.some((row) => !row.locked && featureSettings.isEnabled(row.id)),
  );
  const reasonId = (id: string) => `${uid}-${id}-reason`;

  function showAll() {
    for (const id of featureSettings.hidden()) featureSettings.setEnabled(id, true);
  }
  function hideLocalOnly() {
    for (const row of localRows) {
      if (!row.locked) featureSettings.setEnabled(row.id, false);
    }
  }
</script>

<View
  title="Tools"
  icon="sliders"
  subtitle={`${surfaceReason(surface)} A switch here changes what the rail and the tab strip show. It changes nothing the app is allowed to do.`}
>
  <div class="mb-4 flex flex-wrap items-center gap-2">
    <Button size="sm" variant="outline" disabled={!canShowAll} onclick={showAll}>
      Show all
    </Button>
    <Button size="sm" variant="outline" disabled={!canHideLocal} onclick={hideLocalOnly}>
      Hide local-only tools
    </Button>
  </div>

  {#each groups as group (group.heading)}
    <h2 class="mb-2 text-[13px] font-semibold">{group.heading}</h2>
    {#if group.rows.length === 0}
      <p class="mb-5 text-[11.5px] leading-relaxed text-ink-3" role="status">
        No tool in this build falls in this group.
      </p>
    {:else}
    <ul class="mb-5 flex flex-col gap-2">
      {#each group.rows as row (row.id)}
        <li class="card flex min-w-0 items-start gap-3 px-4 py-3">
          <Checkbox
            id={`${uid}-${row.id}`}
            class="mt-0.5 shrink-0"
            checked={featureSettings.isEnabled(row.id)}
            disabled={row.locked}
            aria-describedby={row.locked ? reasonId(row.id) : undefined}
            onCheckedChange={(value) => featureSettings.setEnabled(row.id, value === true)}
          />
          <div class="min-w-0 flex-1">
            <label
              for={`${uid}-${row.id}`}
              class="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium"
            >
              <span class="shrink-0 text-ink-3"><Icon name={row.icon} size={13} /></span>
              <span class="truncate">{row.label}</span>
            </label>
            <p class="mt-0.5 text-[11px] leading-relaxed text-ink-3">
              {accessLabel(row.requirement, surface)}
            </p>
            {#if row.locked}
              <p id={reasonId(row.id)} class="mt-0.5 text-[11px] leading-relaxed text-ink-3">
                Always available here, so a hosted session can still reach the tools it needs.
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    {/if}
  {/each}

  <h2 class="mb-2 text-[13px] font-semibold">Paired-device tools</h2>
  <ul class="mb-5 flex flex-col gap-2">
    {#each deviceToolRows as row (row.id)}
      <li class="card flex min-w-0 items-start gap-3 px-4 py-3">
        <Checkbox
          id={`${uid}-device-${row.id}`}
          class="mt-0.5 shrink-0"
          checked={toolsStarted && deviceTools.isEnabled(row.id)}
          disabled={!toolsStarted || !hasDevice(row.needs)}
          aria-describedby={`${uid}-device-${row.id}-reason`}
          onCheckedChange={(value) => deviceTools.setEnabled(row.id, value === true)}
        />
        <div class="min-w-0 flex-1">
          <label
            for={`${uid}-device-${row.id}`}
            class="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium"
          >
            <span class="truncate">{row.label}</span>
          </label>
          <p id={`${uid}-device-${row.id}-reason`} class="mt-0.5 text-[11px] leading-relaxed text-ink-3">
            {#if !toolsStarted}
              Reading this tab's tool switches.
            {:else if !cloudUrl}
              Cloud mode is not configured, so no device can be paired in this build.
            {:else if paired?.isLoading}
              Reading your paired devices. This switch stays off until the list answers.
            {:else if paired?.error}
              The paired device list did not load, so this switch cannot tell whether a {row.needs}
              device exists. Reload the page to read it again.
            {:else if !hasDevice(row.needs)}
              Pair a {row.needs} device on <a class="underline" href="#devices">Paired devices</a> first.
            {:else}
              {row.reason}
            {/if}
          </p>
          {#if toolsStarted && row.id === "terminal" && hasDevice("terminal")}
            <p class="mt-1 text-[11px] leading-relaxed text-ink-3">
              {#if deviceTools.isEnabled("terminal")}
                A terminal device is paired and this switch is on.
                <a class="underline" href="#terminal">Open terminal</a>.
              {:else}
                A terminal device is paired. Turn this switch on, then
                <a class="underline" href="#terminal">open terminal</a>.
              {/if}
            </p>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <McpManager />
</View>

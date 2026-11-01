<script lang="ts">
  import View from "#lib/View.svelte";
  import { Icon } from "../../../shared/icons/index.js";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { env } from "$env/dynamic/public";
  import { onMount } from "svelte";
  import { useMutation, useQuery, useAuth } from "convex-svelte";
  import { api } from "../../convex/_generated/api.js";
  import type { Id } from "../../convex/_generated/dataModel.js";
  import { detectSurface } from "#lib/config/surface.js";
  import { classifyEndpoint, displayEndpoint } from "#lib/runtime/endpoint.js";
  import { deviceTools } from "#lib/device_tools.svelte.js";
  import { page } from "$app/state";
  import { isSignInError } from "#lib/auth_state.js";

  /**
   * Paired devices.
   *
   * The pairing token is created here and never leaves this tab in plaintext: Convex only
   * receives its SHA-256. A bridge on the user's machine verifies the plaintext token at its
   * own endpoint; this template does not ship that bridge, so "Test connection" reports the
   * exact result of a real `/v1/health` request instead of assuming it works.
   */
  const cloudUrl = env.PUBLIC_CONVEX_URL;
  const uid = $props.id();

  type DeviceRow = {
    _id: Id<"devices">;
    name: string;
    kind: string;
    lastSeenAt: number;
    revokedAt?: number;
    endpoint?: string;
  };

  const paired = cloudUrl ? useQuery(api.devices.list, () => ({})) : null;
  // `useAuth()` throws without `setupAuth()`, which only runs when a deployment URL exists.
  const auth = cloudUrl ? useAuth() : null;
  // A missing session also explains an auth-shaped error whose wording we do not recognise.
  const signInBlocked = $derived(isSignInError(paired?.error) || auth?.isAuthenticated !== true);
  const registerDevice = cloudUrl ? useMutation(api.devices.register) : null;
  const revokeDevice = cloudUrl ? useMutation(api.devices.revoke) : null;

  const devices = $derived(((paired?.data ?? []) as DeviceRow[]).filter((row) => !row.revokedAt));

  let origin = $state("");
  let surface = $state<"local" | "cloud">("cloud");
  onMount(() => {
    origin = window.location.origin;
    surface = detectSurface({ url: window.location.href, override: env.PUBLIC_SURFACE ?? null });
    deviceTools.start();
  });

  let name = $state("");
  let endpoint = $state("");
  let kind = $state<"terminal" | "browser" | "npu">("terminal");
  let token = $state("");
  let tokenCopied = $state(false);
  let busy = $state(false);
  let pairingError = $state("");
  let pairingNote = $state("");
  let testResult = $state<{ id: Id<"devices">; ok: boolean; text: string } | null>(null);

  const endpointCheck = $derived(endpoint.trim() ? classifyEndpoint(endpoint) : null);

  function base64url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }

  function hex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function generateToken() {
    pairingError = "";
    pairingNote = "";
    tokenCopied = false;
    try {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      token = base64url(bytes);
    } catch (error) {
      pairingError = `Could not generate a token: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token);
      tokenCopied = true;
    } catch (error) {
      pairingError = `Clipboard unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function clearToken() {
    token = "";
    tokenCopied = false;
  }

  async function register() {
    if (!registerDevice || busy) return;
    pairingError = "";
    pairingNote = "";
    const check = classifyEndpoint(endpoint);
    if (check.kind === "invalid" || !check.origin) {
      pairingError = check.reason ?? "That endpoint is not valid.";
      return;
    }
    if (!token) {
      pairingError = "Generate a pairing token first. Only its SHA-256 is stored.";
      return;
    }
    busy = true;
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      await registerDevice({
        name: name.trim() || "This device",
        kind,
        tokenHash: hex(new Uint8Array(digest)),
        endpoint: check.origin,
      });
      pairingNote = `${name.trim() || "This device"} registered. Run the bridge on that machine with the token above; it is kept in this tab only until you clear it or reload.`;
      name = "";
    } catch (error) {
      pairingError = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function testConnection(row: DeviceRow) {
    if (!row.endpoint) {
      testResult = { id: row._id, ok: false, text: "This device has no endpoint." };
      return;
    }
    if (!token) {
      testResult = {
        id: row._id,
        ok: false,
        text: "No pairing token in this tab. Generate a new one and run the bridge with it.",
      };
      return;
    }
    testResult = { id: row._id, ok: false, text: "Checking…" };
    try {
      const response = await fetch(`${row.endpoint}/v1/health`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      const body = (await response.text()).slice(0, 300);
      testResult = {
        id: row._id,
        ok: response.ok,
        text: response.ok
          ? `HTTP ${response.status}${body ? ` · ${body}` : ""}`
          : `HTTP ${response.status} ${response.statusText}${body ? ` · ${body}` : ""}`,
      };
    } catch (error) {
      testResult = {
        id: row._id,
        ok: false,
        text: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
    }
  }

  async function revoke(row: DeviceRow) {
    if (!revokeDevice) return;
    try {
      await revokeDevice({ id: row._id });
    } catch (error) {
      pairingError = error instanceof Error ? error.message : String(error);
    }
  }

  const kindLabel: Record<string, string> = {
    terminal: "Terminal",
    browser: "Browser view",
    npu: "NPU runtime",
    runtime: "Runtime",
  };
</script>

<View
  title="Paired devices"
  icon="cpu"
  subtitle="Pair a machine you own so the tools a browser cannot run can use it: the Terminal, and a browser session driven from that machine. The bridge on it is yours to host; this build ships no bridge and cannot pair anything."
>
  <section class="mb-6" aria-labelledby={`${uid}-browser`}>
    <h2 id={`${uid}-browser`} class="mb-2 text-[13px] font-semibold">This browser</h2>
    <ul class="flex flex-col gap-2">
      <li class="card flex min-w-0 flex-col gap-1 px-4 py-3 text-[12.5px]">
        <span class="font-medium">Surface: {surface}</span>
        <span class="text-ink-3">Origin: {origin || "resolved on the client"}</span>
        {#if origin}
          <span class="text-ink-3">Endpoint: {displayEndpoint(origin)}</span>
        {/if}
        <span class="text-ink-3">
          Runs this workspace in the tab you have open. A shell command or a driven browser session
          has to run on a paired device, and nothing is paired in this build.
        </span>
      </li>
    </ul>
  </section>

  <section class="mb-6" aria-labelledby={`${uid}-paired`}>
    <h2 id={`${uid}-paired`} class="mb-2 text-[13px] font-semibold">Paired devices</h2>
    {#if !cloudUrl}
      <p class="text-[12.5px] leading-relaxed text-ink-2">
        Cloud mode is not configured. Set <code>PUBLIC_CONVEX_URL</code> to your own Convex
        deployment to pair a device; this build keeps everything in this browser.
      </p>
    {:else if paired?.error}
      {#if signInBlocked}
        <p class="text-[12.5px] leading-relaxed text-ink-2" role="status">
          Sign in to read your paired devices.
          {#if page.data.auth?.enabled === true}
            <a class="underline" href="/auth/login">Sign in</a>
          {/if}
        </p>
      {:else}
        <p class="text-[12.5px] leading-relaxed text-ink-2" role="alert">
          Could not read paired devices: {paired.error.message}
        </p>
      {/if}
    {:else if paired?.isLoading}
      <p class="text-[12.5px] text-ink-3">Loading paired devices…</p>
    {:else if devices.length === 0}
      <p class="text-[12.5px] leading-relaxed text-ink-2">
        No paired devices. A row stores the SHA-256 of its pairing token and the validated endpoint
        origin, and nothing else.
      </p>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each devices as row (row._id)}
          <li class="card flex min-w-0 flex-wrap items-start gap-3 px-4 py-3">
            <div class="min-w-0 flex-1">
              <p class="flex items-center gap-1.5 text-[12.5px] font-medium">
                <span class="shrink-0 text-ink-3"><Icon name="cpu" size={13} /></span>
                <span class="truncate">{row.name}</span>
                <span class="text-ink-3">· {kindLabel[row.kind] ?? row.kind}</span>
              </p>
              <p class="mt-0.5 text-[11px] leading-relaxed text-ink-3">
                {row.endpoint ? displayEndpoint(row.endpoint) : "No endpoint stored"} · last seen
                {row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : "never"}
              </p>
              {#if testResult?.id === row._id}
                <p
                  class="mt-1 text-[11px] leading-relaxed"
                  class:text-red-400={!testResult.ok}
                  role={testResult.ok ? undefined : "alert"}
                >
                  {testResult.text}
                </p>
              {/if}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!row.endpoint}
                onclick={() => void testConnection(row)}
              >
                Test connection
              </Button>
              <Button size="sm" variant="destructive" onclick={() => void revoke(row)}>
                Revoke
              </Button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="mb-6" aria-labelledby={`${uid}-add`}>
    <h2 id={`${uid}-add`} class="mb-2 text-[13px] font-semibold">Add a device</h2>
    <div class="card flex flex-col gap-3 px-4 py-4">
      <label class="flex flex-col gap-1 text-[12.5px]">
        <span class="font-medium">Name</span>
        <Input bind:value={name} placeholder="Studio laptop" maxlength={80} />
      </label>
      <label class="flex flex-col gap-1 text-[12.5px]">
        <span class="font-medium">Endpoint</span>
        <Input bind:value={endpoint} placeholder="http://127.0.0.1:8649" />
        {#if endpointCheck}
          <span class="text-[11px] leading-relaxed text-ink-3">
            {#if endpointCheck.kind === "invalid"}
              <span class="text-red-400">{endpointCheck.reason}</span>
            {:else}
              {displayEndpoint(endpointCheck.origin ?? "")}. The bridge must answer
              <code>/v1/health</code> and <code>/v1/terminal</code> on this origin.
            {/if}
          </span>
        {/if}
      </label>
      <label class="flex flex-col gap-1 text-[12.5px]">
        <span class="font-medium">Kind</span>
        <select
          class="h-8 rounded-lg border border-border bg-background px-2 text-[12.5px]"
          bind:value={kind}
        >
          <option value="terminal">terminal</option>
          <option value="browser">browser</option>
          <option value="npu">npu</option>
        </select>
      </label>

      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onclick={() => void generateToken()}>
          Generate pairing token
        </Button>
        <Button
          size="sm"
          disabled={busy || !cloudUrl || !endpoint.trim()}
          onclick={() => void register()}
        >
          Register device
        </Button>
      </div>

      {#if token}
        <div class="flex flex-col gap-2 rounded-lg border border-border px-3 py-3">
          <p class="text-[11px] font-medium" role="alert">
            Shown once. Copy it now: this page never stores it and only its SHA-256 is sent to
            Convex.
          </p>
          <code class="break-all rounded bg-muted px-2 py-1 text-[11.5px]">{token}</code>
          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onclick={() => void copyToken()}
              >{tokenCopied ? "Copied" : "Copy token"}</Button
            >
            <Button size="sm" variant="ghost" onclick={clearToken}>Clear token</Button>
          </div>
          <p class="text-[11px] leading-relaxed text-ink-3">
            Kept in this tab's memory so Test connection can use it. It is never written to
            storage, logs or Convex in plaintext.
          </p>
        </div>
      {/if}

      {#if pairingError}
        <p class="text-[11.5px] leading-relaxed text-red-400" role="alert">{pairingError}</p>
      {/if}
      {#if pairingNote}
        <p class="text-[11.5px] leading-relaxed text-ink-2">{pairingNote}</p>
      {/if}

      <div class="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
        <span
          >Terminal and browser view stay off until you enable them in
          <a class="underline" href="#tools">Tools</a>.</span
        >
      </div>
    </div>
  </section>

  <section aria-labelledby={`${uid}-setup`}>
    <h2 id={`${uid}-setup`} class="mb-2 text-[13px] font-semibold">Bridge setup on your machine</h2>
    <details class="card px-4 py-3 text-[12px] leading-relaxed">
      <summary class="cursor-pointer font-medium">Three transports</summary>
      <div class="mt-3 flex flex-col gap-3">
        <div>
          <p class="font-medium">SSH tunnel (no public exposure)</p>
          <pre class="mt-1 overflow-x-auto rounded bg-muted px-2 py-1 text-[11.5px]"><code
              >ssh -N -L 8649:127.0.0.1:8649 user@host</code
            ></pre>
          <p class="mt-1 text-ink-3">
            Then pair <code>http://127.0.0.1:8649</code> from the browser running next to the
            tunnel.
          </p>
        </div>
        <div>
          <p class="font-medium">Tailscale serve (tailnet only)</p>
          <pre class="mt-1 overflow-x-auto rounded bg-muted px-2 py-1 text-[11.5px]"><code
              >tailscale serve --bg https / http://127.0.0.1:8649</code
            ></pre>
          <p class="mt-1 text-ink-3">
            Pair the <code>*.ts.net</code> origin it prints. Plain http to a MagicDNS name is
            still inside the encrypted tailnet, but https is preferred.
          </p>
        </div>
        <div>
          <p class="font-medium">Tailscale funnel (public)</p>
          <pre class="mt-1 overflow-x-auto rounded bg-muted px-2 py-1 text-[11.5px]"><code
              >tailscale funnel --bg https / http://127.0.0.1:8649</code
            ></pre>
          <p class="mt-1 text-ink-3">
            Funnel makes the bridge public, so pair it over <code>https:</code> only. Anyone who
            reaches the origin still needs the pairing token.
          </p>
        </div>
        <p class="text-ink-3">
          None of these commands were run or verified in this build. The bridge itself
          (<code>/v1/health</code>, <code>/v1/terminal</code>) is not part of this template.
        </p>
      </div>
    </details>
  </section>
</View>

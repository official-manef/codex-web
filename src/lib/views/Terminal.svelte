<script lang="ts">
  import View from "#lib/View.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { env } from "$env/dynamic/public";
  import { onDestroy, onMount } from "svelte";
  import { useQuery, useAuth } from "convex-svelte";
  import { api } from "../../convex/_generated/api.js";
  import { deviceTools } from "#lib/device_tools.svelte.js";
  import { classifyEndpoint } from "#lib/runtime/endpoint.js";
  import { page } from "$app/state";
  import { isSignInError } from "#lib/auth_state.js";
  import {
    createTerminal,
    type Terminal,
    type TerminalStatus,
  } from "#lib/runtime/terminal.js";
  import {
    MAX_OUTPUT_CHARS,
    RESIZE_DELAY_MS,
    appendOutput,
    createResizeDebouncer,
    gridFromBox,
    isAttachedToBottom,
  } from "#lib/terminal_buffer.js";
  import {
    clearBridgeToken,
    readBridgeToken,
    saveBridgeToken,
  } from "#lib/runtime/bridge_token.js";

  /**
   * Terminal on the user's own device.
   *
   * The bridge is out of scope, so this screen never pretends a shell exists: without the
   * Tools switch and a paired `terminal` device it shows one sentence naming what is missing.
   * When both are present it opens a real WebSocket to `<endpoint>/v1/terminal` and paints the
   * text frames it receives. See docs/terminal.md for the bridge contract.
   */
  const cloudUrl = env.PUBLIC_CONVEX_URL;

  type DeviceRow = {
    _id: string;
    name: string;
    kind: string;
    revokedAt?: number;
    endpoint?: string;
  };

  const paired = cloudUrl ? useQuery(api.devices.list, () => ({})) : null;
  // `useAuth()` throws without `setupAuth()`, which only runs when a deployment URL exists.
  const auth = cloudUrl ? useAuth() : null;
  // A missing session also explains an auth-shaped error whose wording we do not recognise.
  const signInBlocked = $derived(
    isSignInError(paired?.error) || auth?.isAuthenticated !== true,
  );
  const terminalDevices = $derived(
    ((paired?.data ?? []) as DeviceRow[]).filter(
      (row) => row.kind === "terminal" && !row.revokedAt,
    ),
  );

  let mounted = $state(false);
  onMount(() => {
    deviceTools.start();
    mounted = true;
  });

  // `deviceTools` holds module state, so this stays reactive if the switch changes in Tools.
  const toolsEnabled = $derived(mounted && deviceTools.isEnabled("terminal"));
  const pairingMissing = $derived(
    mounted && !(paired?.isLoading ?? false) && terminalDevices.length === 0,
  );
  const toolMissing = $derived(mounted && !toolsEnabled);
  const ready = $derived(mounted && toolsEnabled && terminalDevices.length > 0);

  let deviceId = $state("");
  let endpoint = $state("");
  // The bridge token: component memory only. Never stored, never in a URL, never logged.
  let token = $state("");
  // Set once a connection is attempted; the input then hides the value behind a placeholder.
  let sessionToken = "";
  let tokenSaved = $state(false);
  let status = $state<TerminalStatus>("idle");
  let statusDetail = $state("");
  let output = $state("");
  let dropped = $state(false);
  let attached = $state(true);
  let copied = $state(false);
  let draft = $state("");
  let outputBox = $state<HTMLPreElement>();
  let terminal: Terminal | null = null;

  const resize = createResizeDebouncer(
    (cols, rows) => terminal?.resize(cols, rows),
    RESIZE_DELAY_MS,
  );

  function resetSession() {
    terminal?.close();
    terminal = null;
    sessionToken = "";
    tokenSaved = false;
    token = "";
    output = "";
    dropped = false;
    status = "idle";
    statusDetail = "";
    attached = true;
    draft = "";
  }

  function selectDevice(value: string) {
    if (value === deviceId) return;
    deviceId = value;
    const row = terminalDevices.find((entry) => entry._id === value);
    endpoint = row?.endpoint ?? "";
    resetSession();
    // A token saved for this device in this tab is restored, so a reload does not force the
    // user to paste their own credential again. It stays in tab memory from here on.
    const remembered = value ? readBridgeToken(value) : "";
    if (remembered) {
      sessionToken = remembered;
      tokenSaved = true;
    }
  }

  $effect(() => {
    // A row can be revoked while the panel is open; drop the stale selection and its socket.
    if (deviceId && !terminalDevices.some((row) => row._id === deviceId)) {
      clearBridgeToken(deviceId);
      deviceId = "";
      endpoint = "";
      resetSession();
    }
  });

  /** Monospace cell size, measured once per font; falls back to the font size. */
  function cellSize(box: HTMLPreElement): { width: number; height: number } {
    const style = getComputedStyle(box);
    const probe = document.createElement("span");
    probe.textContent = "M".repeat(40);
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "pre";
    probe.style.fontFamily = style.fontFamily;
    probe.style.fontSize = style.fontSize;
    probe.style.lineHeight = style.lineHeight;
    probe.style.letterSpacing = style.letterSpacing;
    (box.parentElement ?? box).appendChild(probe);
    const width = probe.getBoundingClientRect().width / 40;
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return {
      width: Number.isFinite(width) && width > 0 ? width : 8,
      height: Number.isFinite(height) && height > 0 ? height : 16,
    };
  }

  function reportGrid() {
    const box = outputBox;
    if (!box) return;
    const style = getComputedStyle(box);
    const paddingX =
      Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const paddingY =
      Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const grid = gridFromBox(
      {
        width: box.clientWidth - (paddingX || 0),
        height: box.clientHeight - (paddingY || 0),
      },
      cellSize(box),
    );
    resize.push(grid.cols, grid.rows);
  }

  $effect(() => {
    if (!outputBox) return;
    reportGrid();
    const observer = new ResizeObserver(() => reportGrid());
    observer.observe(outputBox);
    return () => {
      observer.disconnect();
      resize.cancel();
    };
  });

  onDestroy(() => {
    terminal?.close();
    terminal = null;
    resize.cancel();
  });

  function onData(chunk: string) {
    const next = appendOutput(output, chunk);
    output = next.text;
    if (next.dropped) dropped = true;
  }

  function onScroll() {
    if (outputBox) attached = isAttachedToBottom(outputBox);
  }

  $effect(() => {
    // Follow new output only while the user is already at the bottom.
    void output;
    if (!outputBox || !attached) return;
    outputBox.scrollTop = outputBox.scrollHeight;
  });

  function jumpToLatest() {
    attached = true;
    if (outputBox) outputBox.scrollTop = outputBox.scrollHeight;
  }

  function connect() {
    const check = classifyEndpoint(endpoint);
    if (check.kind === "invalid" || !check.origin) {
      status = "error";
      statusDetail = check.reason ?? "That endpoint is not valid.";
      return;
    }
    if (check.kind === "public" && location.protocol !== "https:") {
      status = "error";
      statusDetail =
        "That endpoint is public but this page is not https, so the pairing token would cross a cleartext connection. Load this workspace over https first.";
      return;
    }
    const candidate = tokenSaved ? sessionToken : token;
    if (!candidate) {
      status = "error";
      statusDetail = "Enter the pairing token generated for this device on the Devices screen.";
      return;
    }

    terminal?.close();
    output = "";
    dropped = false;
    attached = true;
    status = "idle";
    statusDetail = "";
    sessionToken = candidate;
    tokenSaved = true;
    token = "";
    // Remembered for this tab and this device only; cleared when the device is revoked.
    if (deviceId) saveBridgeToken(deviceId, sessionToken);

    terminal = createTerminal({
      endpoint: check.origin,
      token: sessionToken,
      onData,
      onStatus: (next, detail) => {
        status = next;
        statusDetail = detail ?? "";
        if (next === "open") reportGrid();
      },
    });
  }

  function send() {
    if (status !== "open" || !terminal) return;
    terminal.send(`${draft}\n`);
    draft = "";
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    send();
  }

  async function copyOutput() {
    copied = false;
    try {
      await navigator.clipboard.writeText(output);
      copied = true;
    } catch (error) {
      status = "error";
      statusDetail = `Clipboard unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  function clearOutput() {
    output = "";
    dropped = false;
    attached = true;
  }
</script>

<View
  title="Terminal"
  icon="code"
  subtitle="Runs a real shell on a device you paired. The bridge on that machine is yours; this panel only implements the client half."
>
  {#if !ready}
    <p class="text-[12.5px] leading-relaxed text-ink-2">
      {#if !mounted || (paired?.isLoading ?? false)}
        Reading paired devices…
      {:else if !cloudUrl}
        No terminal can open yet: this build has no backend, so no device can be paired. Set
        <code>PUBLIC_CONVEX_URL</code> and pair a terminal device on
        <a class="underline" href="#devices">Devices</a>, then enable the tool in
        <a class="underline" href="#tools">Tools</a>.
      {:else if toolMissing && pairingMissing}
        No terminal can open yet: you have not paired a terminal device on
        <a class="underline" href="#devices">Devices</a>, and the Terminal switch is off in
        <a class="underline" href="#tools">Tools</a>.
      {:else if pairingMissing}
        No terminal can open yet: no device of kind <code>terminal</code> is paired. Pair one on
        <a class="underline" href="#devices">Devices</a>.
      {:else}
        No terminal can open yet: the Terminal switch is off. Turn it on in
        <a class="underline" href="#tools">Tools</a>.
      {/if}
    </p>
    {#if paired?.error}
      {#if signInBlocked}
        <p class="mt-2 text-[12px] leading-relaxed text-ink-2" role="status">
          Sign in to read your paired devices.
          {#if page.data.auth?.enabled === true}
            <a class="underline" href="/auth/login">Sign in</a>
          {/if}
        </p>
      {:else}
        <p class="mt-2 text-[12px] leading-relaxed text-red-400" role="alert">
          Could not read paired devices: {paired.error.message}
        </p>
      {/if}
    {/if}
  {:else}
    <div class="flex min-w-0 flex-col gap-3">
      <div class="flex min-w-0 flex-wrap items-end gap-2">
        <label class="flex min-w-0 flex-1 flex-col gap-1 text-[12px]">
          <span class="font-medium">Device</span>
          <select
            class="h-8 w-full min-w-0 rounded-lg border border-border bg-background px-2 text-[12.5px]"
            value={deviceId}
            onchange={(event) => selectDevice(event.currentTarget.value)}
          >
            <option value="">Choose a paired terminal device</option>
            {#each terminalDevices as row (row._id)}
              <option value={row._id}>{row.name}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="flex min-w-0 flex-wrap items-end gap-2">
        <label class="flex min-w-0 flex-1 flex-col gap-1 text-[12px]">
          <span class="font-medium">Bridge endpoint</span>
          <Input bind:value={endpoint} placeholder="http://127.0.0.1:8649" />
        </label>
        <label class="flex min-w-0 flex-1 flex-col gap-1 text-[12px]">
          <span class="font-medium">Pairing token</span>
          <!--
            The token is sent only as the WebSocket subprotocol `bearer.<token>` inside
            createTerminal. It is never put in a URL, a query string, localStorage or a log,
            and it is cleared from the field once a connection is attempted.
          -->
          <Input
            type="password"
            autocomplete="off"
            spellcheck={false}
            disabled={tokenSaved}
            placeholder={tokenSaved ? "Token restored for this tab" : "Paste the pairing token"}
            bind:value={token}
          />
        </label>
        <Button size="sm" disabled={status === "connecting"} onclick={connect}>
          {tokenSaved ? "Reconnect" : "Connect"}
        </Button>
        {#if tokenSaved}
          <Button
            size="sm"
            variant="ghost"
            onclick={() => {
              terminal?.close();
              terminal = null;
              sessionToken = "";
              tokenSaved = false;
              token = "";
              status = "idle";
              statusDetail = "";
              // Forget it for this device too: "use another" means stop reusing this one.
              if (deviceId) clearBridgeToken(deviceId);
            }}
          >
            Use another token
          </Button>
        {/if}
      </div>

      {#if deviceId && !endpoint}
        <p class="text-[11.5px] leading-relaxed text-ink-3">
          This device row has no stored endpoint. Enter the origin its bridge listens on.
        </p>
      {/if}

      <p class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
        <span class="font-medium text-ink-2">{status}</span>
        {#if statusDetail}<span class="min-w-0 break-words">{statusDetail}</span>{/if}
        {#if status === "error"}
          <Button size="sm" variant="outline" onclick={connect}>Reconnect</Button>
        {/if}
      </p>

      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!output} onclick={() => void copyOutput()}>
          {copied ? "Copied" : "Copy output"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!output} onclick={clearOutput}>
          Clear
        </Button>
        <span class="text-[11px] text-ink-3">
          Clear empties this panel only; the remote shell keeps its scrollback.
        </span>
      </div>

      {#if dropped}
        <p class="text-[11px] leading-relaxed text-ink-3">
          Older output was dropped to keep the last {MAX_OUTPUT_CHARS.toLocaleString()} characters.
        </p>
      {/if}

      <div class="relative min-w-0">
        <pre
          bind:this={outputBox}
          aria-live="polite"
          aria-label="Terminal output"
          class="m-0 h-[45vh] min-h-[160px] w-full min-w-0 overflow-auto rounded-lg border border-border bg-muted px-3 py-2 text-[12px] leading-[1.45] whitespace-pre"
          onscroll={onScroll}
        >{output}</pre>
        {#if !attached}
          <Button
            size="sm"
            variant="outline"
            class="absolute right-2 bottom-2"
            onclick={jumpToLatest}
          >
            Jump to latest
          </Button>
        {/if}
      </div>

      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <Input
          class="min-w-0 flex-1"
          bind:value={draft}
          disabled={status !== "open"}
          placeholder={status === "open" ? "Type a command and press Enter" : "Connect to type"}
          aria-label="Terminal input"
          onkeydown={onKeydown}
        />
        <Button size="sm" disabled={status !== "open" || !draft} onclick={send}>Send</Button>
      </div>

      <p class="text-[11px] leading-relaxed text-ink-3">
        The bridge must answer <code>GET /v1/health</code> with <code>Authorization: Bearer</code>
        and accept a <code>WebSocket /v1/terminal</code> with the <code>bearer.&lt;token&gt;</code>
        subprotocol. Text frames are shell output; a
        <code>{'{type:"resize",cols:N,rows:N}'}</code> JSON frame carries the column and row
        count.
      </p>
    </div>
  {/if}
</View>

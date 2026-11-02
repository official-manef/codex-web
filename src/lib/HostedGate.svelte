<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { setHostedDraftScope } from "#lib/drafts.js";
  import {
    isHostedWorkspace,
    runtimeConnection,
    pairRuntime,
    disconnectRuntime,
  } from "#lib/http.js";
  let {
    children,
    onConnected = () => {},
    onWorkspaceActive = () => {},
  }: {
    children: Snippet;
    onConnected?: () => void;
    onWorkspaceActive?: (active: boolean) => void;
  } = $props();
  const hosted = isHostedWorkspace();
  let connected = $state(!hosted);
  let manage = $state(false);
  let busy = $state(false);
  let error = $state("");
  let code = $state("");
  let address = $state("http://127.0.0.1:8649");
  let advanced = $state(false);
  let user = $state<any>(null);
  let csrf = "";
  let alive = true;
  let scope = $state("");
  let sessionExpiry: ReturnType<typeof setTimeout>;
  let checkingSession = false;
  $effect(() => {
    onWorkspaceActive(connected && !manage);
  });
  async function sessionFailed() {
    connected = false;
    setHostedDraftScope("");
    await disconnectRuntime().catch(() => {});
    error = "Portal sign-in could not be checked. Reload this page to reconnect.";
  }

  async function session() {
    if (!hosted) return true;
    const response = await fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    if (!alive) return false;
    if (!response.ok || !result.authenticated || (user && user.id !== result.user?.id)) {
      connected = false;
      setHostedDraftScope("");
      await disconnectRuntime().catch(() => {});
      location.assign("/login");
      return false;
    }
    user = result.user;
    csrf = result.csrf_token;
    clearTimeout(sessionExpiry);
    const delay = Math.max(0, Number(result.expires_at) * 1000 - Date.now());
    if (!Number.isFinite(delay) || delay <= 0 || delay > 1800_000)
      throw new Error("Portal session expiry is invalid.");
    sessionExpiry = setTimeout(() => {
      connected = false;
      sessionFailed();
    }, delay);
    return true;
  }
  async function connect() {
    if (busy) return;
    busy = true;
    error = "";
    try {
      if (!(await session())) return;
      const result = await pairRuntime(address, code);
      if (!alive) {
        await disconnectRuntime();
        return;
      }
      scope = result.allowActions ? "Local AI and reviewed actions" : "Local AI";
      setHostedDraftScope(user.id + "@" + result.baseUrl);
      code = "";
      connected = true;
      manage = false;
      onConnected();
    } catch (reason) {
      error =
        reason instanceof Error
          ? reason.message
          : "Connection failed. Run the connector and try again.";
      if (error.includes("fetch") || error.includes("Network"))
        error =
          "The browser could not reach Laya. Start the local connector, allow this site's local-network prompt, then try again. Browser settings can block this connection.";
    } finally {
      busy = false;
    }
  }
  async function disconnect() {
    busy = true;
    connected = false;
    setHostedDraftScope("");
    try {
      await disconnectRuntime();
    } catch {
      error =
        "The runtime could not confirm revocation. Run laya disconnect on this computer to revoke every portal connection.";
    } finally {
      connected = false;
      manage = false;
      busy = false;
    }
  }
  async function logout() {
    busy = true;
    connected = false;
    setHostedDraftScope("");
    try {
      await disconnectRuntime().catch(() => {});
      const response = await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csrf_token: csrf }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Sign out failed. Reload this portal and try again.");
      location.assign("/login");
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "Sign out failed.";
    } finally {
      connected = false;
      busy = false;
    }
  }
  onMount(() => {
    if (!hosted) return;
    const disconnected = () => {
      connected = false;
      setHostedDraftScope("");
      manage = false;
    };
    const settings = () => {
      manage = true;
    };
    window.addEventListener("laya:disconnected", disconnected);
    window.addEventListener("laya:connection-settings", settings);
    session().catch(sessionFailed);
    const timer = setInterval(() => {
      if (connected && !runtimeConnection().connected) disconnect();
      if (!checkingSession) {
        checkingSession = true;
        session()
          .catch(sessionFailed)
          .finally(() => {
            checkingSession = false;
          });
      }
    }, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearTimeout(sessionExpiry);
      window.removeEventListener("laya:disconnected", disconnected);
      window.removeEventListener("laya:connection-settings", settings);
    };
  });
</script>

{#if !hosted || connected}
  <div style:display={manage ? "none" : "contents"} inert={manage}>{@render children()}</div>
{/if}
{#if hosted && (!connected || manage)}
  <main class="hosted-connection" aria-labelledby="connection-heading">
    <section>
      <a class="brand" href="/">Laya NPU</a>
      <h1 id="connection-heading">
        {connected ? "This computer is connected" : "Connect your local AI"}
      </h1>
      <p>
        {connected
          ? scope
          : "Your models run on this computer. This website provides the interface."}
      </p>
      {#if user}<p class="account">Signed in as {user.email || user.name || "Laya user"}</p>{/if}
      {#if connected}
        <p class="connection-address">{runtimeConnection().baseUrl}</p>
        <button class="btn btn-solid" onclick={() => (manage = false)}>Return to workspace</button>
        <button class="btn" onclick={disconnect} disabled={busy}>Disconnect this browser</button>
      {:else}
        <p>Start the connector on this computer, then enter its one-use code.</p>
        <code>.\connect.cmd</code>
        <form
          onsubmit={(event) => {
            event.preventDefault();
            connect();
          }}
        >
          <label for="pair-code">Pairing code</label>
          <input
            class="field"
            id="pair-code"
            bind:value={code}
            placeholder="AB12-CD34-EF56"
            autocomplete="off"
            spellcheck="false"
            maxlength="16"
            disabled={busy}
            required
          />
          <details bind:open={advanced}>
            <summary>Runtime address</summary>
            <label for="runtime-address">On this computer</label><input
              class="field"
              id="runtime-address"
              bind:value={address}
              disabled={busy}
            />
          </details>
          <button class="btn btn-solid" type="submit" disabled={busy || !code.trim()}
            >{busy ? "Connecting…" : "Connect this computer"}</button
          >
        </form>
        <p class="privacy">
          The connection expires after one hour and is forgotten on refresh. Text, audio and files
          go directly to your local runtime.
        </p>
      {/if}
      {#if error}<p class="connection-error" role="alert">{error}</p>{/if}
      <button class="sign-out" onclick={logout} disabled={busy}>Sign out of this portal</button>
    </section>
  </main>
{/if}

<style>
  .hosted-connection {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    background: var(--color-page);
    color: var(--color-ink);
    padding: 32px 20px;
  }
  section {
    width: 100%;
    max-width: 460px;
  }
  .brand {
    font-size: 16px;
    font-weight: 600;
    color: var(--color-ink);
  }
  h1 {
    font-size: 28px;
    font-weight: 500;
    line-height: 1.25;
    margin: 34px 0 16px;
  }
  p {
    color: var(--color-ink-2);
    font-size: 14px;
    line-height: 1.7;
    margin: 0 0 18px;
  }
  .account,
  .privacy {
    font-size: 12px;
  }
  code {
    display: block;
    padding: 13px 16px;
    background: var(--color-composer);
    border-radius: 8px;
    margin: 0 0 25px;
    font-size: 13px;
  }
  form {
    display: grid;
    gap: 10px;
    margin-bottom: 20px;
  }
  label {
    font-size: 13px;
  }
  details {
    margin: 3px 0 14px;
    font-size: 12px;
    color: var(--color-ink-2);
  }
  details input {
    margin-top: 8px;
  }
  summary {
    cursor: pointer;
    margin-bottom: 10px;
  }
  a {
    color: var(--color-ink-2);
    font-size: 13px;
    text-underline-offset: 4px;
  }
  a:hover {
    text-decoration: underline;
  }
  .sign-out {
    display: block;
    margin-top: 25px;
    font-size: 12px;
    color: var(--color-ink-2);
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .connection-error {
    margin-top: 16px;
    padding: 12px;
    border: 1px solid var(--color-line);
    border-radius: 8px;
    color: var(--color-ink);
  }
  .connection-address {
    font-family: var(--font-mono);
    font-size: 12px;
  }
</style>

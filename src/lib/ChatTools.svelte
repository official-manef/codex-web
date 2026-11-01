<script lang="ts">
  import RecoveryNotice from "#lib/RecoveryNotice.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Textarea } from "#lib/components/ui/textarea/index.js";
  import { onMount, tick, untrack } from "svelte";
  import { api, get } from "#lib/http.js";
  import { toggleAvailableTool } from "#lib/composer_commands.js";
  type Props = {
    sessionId?: string;
    selectedTools?: string[];
    onTools?: (ids: string[]) => void;
    onAttach?: (text: string) => void;
    onResult?: () => void;
    mode?: "tools" | "mcp" | "skills";
    embedded?: boolean;
    active?: boolean;
    initialConnection?: string;
    initialTool?: string;
    initialSkill?: string;
    initialTab?: "plugins" | "mcp" | "skills";
    onResourcesChange?: () => void;
  };
  let {
    sessionId = "",
    selectedTools = [],
    onTools = () => {},
    onAttach = () => {},
    onResult = () => {},
    mode = "tools",
    embedded = false,
    active = true,
    initialConnection = "",
    initialTool = "",
    initialSkill = "",
    initialTab,
    onResourcesChange = () => {},
  }: Props = $props();
  let status = $state<any>(null);
  let connection = $state("");
  let tools = $state<any[]>([]);
  let toolsConnection = $state("");
  let firstActivation = true;
  $effect(() => {
    const current = active;
    if (firstActivation) firstActivation = false;
    else if (current)
      untrack(() => {
        if (!busy && !resourceLoading) refresh();
      });
  });
  let tool = $state("");
  let argumentsText = $state("{}");
  let approval = $state<any>(null);
  let result = $state<any>(null);
  let error = $state("");
  let busy = $state(false);
  let resourceLoading = $state(true);
  let resourcesError = $state("");
  let alive = false;
  let refreshVersion = 0;
  let toolsVersion = 0;
  let actionVersion = 0;
  let name = $state("");
  let url = $state("");
  let token = $state("");
  let allowLocal = $state(false);
  const RESOURCE_TABS = ["plugins", "mcp", "skills"] as const;
  let resourceTab = $state<"plugins" | "mcp" | "skills">("mcp");
  let connectionSettings = $state(false);
  let resources = $state<any>(null);
  let maxTools = $state<number | null>(null);
  let toolFilter = $state("");
  let focusedSkill = $state("");
  let visibleTools = $derived(
    tools.filter((item) =>
      `${item.name} ${item.description ?? ""}`.toLowerCase().includes(toolFilter.toLowerCase()),
    ),
  );
  async function onResourceTabKey(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % RESOURCE_TABS.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + RESOURCE_TABS.length) % RESOURCE_TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = RESOURCE_TABS.length - 1;
    else return;
    event.preventDefault();
    resourceTab = RESOURCE_TABS[next];
    await tick();
    if (!alive) return;
    document.getElementById(`resource-tab-${resourceTab}`)?.focus();
  }
  function checked(d: any) {
    if (d?.error) throw new Error(d.error);
    return d;
  }
  async function refresh() {
    const version = ++refreshVersion;
    resourceLoading = true;
    error = "";
    resourcesError = "";
    try {
      const values = await Promise.allSettled([
        api.mcpStatus(),
        get("/api/chat/resources"),
        api.capabilities(),
      ]);
      if (!alive || version !== refreshVersion) return;
      if (values[1].status === "fulfilled" && !values[1].value.error) resources = values[1].value;
      else {
        resources = null;
        resourcesError =
          "The installed resource catalogue could not be loaded. Refresh to try again.";
      }
      maxTools =
        values[2].status === "fulfilled" && !values[2].value?.error
          ? (values[2].value?.mcp?.max_selected_tools ?? null)
          : null;
      if (values[0].status === "rejected" || values[0].value?.error) {
        status = null;
        tools = [];
        toolsConnection = "";
        approval = null;
        result = null;
        throw values[0].status === "rejected" ? values[0].reason : new Error(values[0].value.error);
      }
      status = checked(values[0].value);
      const availableConnections = new Set((status.connections ?? []).map((item: any) => item.id));
      const remaining = selectedTools.filter((id) => availableConnections.has(id.split("::")[0]));
      if (remaining.length !== selectedTools.length) onTools(remaining);
      if (connection && !availableConnections.has(connection)) connection = "";
      if (
        !connection &&
        initialConnection &&
        status.connections?.some((item: any) => item.id === initialConnection)
      )
        connection = initialConnection;
      if (!connection && status.connections?.length) {
        connection = status.connections[0].id;
      }
      // Installed skills are already available; a slow MCP discovery must not
      // keep their independent tab behind a catalogue loading screen.
      resourceLoading = false;
      await loadTools();
    } catch (e: any) {
      if (alive && version === refreshVersion) error = e.message;
    } finally {
      if (alive && version === refreshVersion) resourceLoading = false;
    }
  }
  async function loadTools() {
    const version = ++toolsVersion;
    const target = connection;
    const previousTool = toolsConnection === target ? tool : "";
    tools = [];
    toolsConnection = "";
    tool = "";
    approval = null;
    result = null;
    if (!target) {
      tools = [];
      busy = false;
      return;
    }
    busy = true;
    error = "";
    try {
      const d = checked(await api.mcpTools(target));
      if (!alive || version !== toolsVersion || target !== connection) return;
      tools = d.tools ?? [];
      toolsConnection = target;
      tool = tools.some((item) => item.name === previousTool)
        ? previousTool
        : target === initialConnection && tools.some((item) => item.name === initialTool)
          ? initialTool
          : (tools[0]?.name ?? "");
    } catch (e: any) {
      if (alive && version === toolsVersion && target === connection) {
        error = e.message;
        tools = [];
      }
    } finally {
      if (alive && version === toolsVersion && target === connection) busy = false;
    }
  }
  function chooseTool() {
    approval = null;
    result = null;
    argumentsText = "{}";
  }
  async function preview() {
    if (busy || resourceLoading) return;
    if (toolsConnection !== connection || !tools.some((item) => item.name === tool)) {
      error = "The tool list changed. Refresh this connection before previewing a call.";
      return;
    }
    const version = ++actionVersion,
      target = connection,
      targetTool = tool,
      targetSession = sessionId;
    busy = true;
    error = "";
    approval = null;
    result = null;
    try {
      const args = JSON.parse(argumentsText);
      if (!args || Array.isArray(args) || typeof args !== "object")
        throw new Error("Tool arguments must be a JSON object.");
      const prepared = checked(
        await api.mcpPrepare({
          connection_id: connection,
          tool,
          arguments: args,
          session_id: sessionId || undefined,
        }),
      );
      if (
        alive &&
        version === actionVersion &&
        target === connection &&
        targetTool === tool &&
        targetSession === sessionId
      )
        approval = prepared;
    } catch (e: any) {
      if (alive && version === actionVersion) error = e.message;
    } finally {
      if (alive && version === actionVersion) busy = false;
    }
  }
  async function execute() {
    if (!approval || busy) return;
    const version = ++actionVersion,
      targetSession = sessionId;
    busy = true;
    error = "";
    try {
      const completed = checked(await api.mcpCall(approval.approval_id));
      if (!alive || version !== actionVersion || targetSession !== sessionId) return;
      result = completed;
      approval = null;
      onResult();
    } catch (e: any) {
      if (alive && version === actionVersion) {
        error = e.message;
        approval = null;
      }
    } finally {
      if (alive && version === actionVersion) busy = false;
    }
  }
  async function connect() {
    if (busy) return;
    const version = ++actionVersion;
    busy = true;
    error = "";
    try {
      const d = checked(await api.mcpConnect({ name, url, token, allow_local: allowLocal }));
      if (!alive || version !== actionVersion) return;
      token = "";
      connection = d.connection?.id ?? "";
      await refresh();
      if (alive && version === actionVersion) onResourcesChange();
    } catch (e: any) {
      if (alive && version === actionVersion) error = e.message;
    } finally {
      if (alive && version === actionVersion) busy = false;
    }
  }
  async function disconnect(id: string) {
    if (busy) return;
    const version = ++actionVersion;
    busy = true;
    error = "";
    try {
      checked(await api.mcpDelete(id));
      if (!alive || version !== actionVersion) return;
      if (connection === id) {
        connection = "";
        tools = [];
      }
      await refresh();
      if (alive && version === actionVersion) onResourcesChange();
    } catch (e: any) {
      if (alive && version === actionVersion) error = e.message;
    } finally {
      if (alive && version === actionVersion) busy = false;
    }
  }
  function toggleTool(toolName: string, enabled: boolean) {
    if (busy || resourceLoading) return;
    try {
      onTools(
        toggleAvailableTool(
          selectedTools,
          connection,
          toolsConnection,
          tools.map((item) => item.name),
          toolName,
          enabled,
          maxTools,
        ),
      );
    } catch (e) {
      error = e instanceof Error ? e.message : "Refresh this connection before selecting a tool.";
    }
  }
  onMount(() => {
    alive = true;
    resourceTab = mode === "skills" ? "skills" : (initialTab ?? "mcp");
    connectionSettings = mode === "mcp";
    focusedSkill = initialSkill;
    refresh();
    return () => {
      alive = false;
      refreshVersion++;
      toolsVersion++;
      actionVersion++;
    };
  });
</script>

<section class="chat-inspector-section">
  <div class="inspector-heading">
    <h2 class:sr-only={embedded}>Tools</h2>
    <Button variant="outline" class="btn" onclick={refresh} disabled={busy || resourceLoading}
      >Refresh</Button
    >
  </div>
  <div class="resource-tabs" role="tablist" aria-label="Tool categories">
    {#each RESOURCE_TABS as tab, index}<button
        id={`resource-tab-${tab}`}
        class="btn"
        role="tab"
        aria-selected={resourceTab === tab}
        aria-controls={`resource-panel-${tab}`}
        tabindex={resourceTab === tab ? 0 : -1}
        onkeydown={(event) => onResourceTabKey(event, index)}
        onclick={() => (resourceTab = tab)}
        >{tab === "mcp" ? "MCP" : tab === "skills" ? "Skills" : "Plugins"}</button
      >{/each}
  </div>
  {#if error}<RecoveryNotice
      message={error}
      retry={refresh}
      retryLabel="Refresh connections"
    />{/if}
  {#each RESOURCE_TABS as tab}<div
      id={`resource-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`resource-tab-${tab}`}
      hidden={resourceTab !== tab}
    >
      {#if resourceTab === tab}
        {#if resourceLoading}<p class="inspector-description" role="status">
            Loading available tools and installed skills…
          </p>
        {:else if resourcesError && resourceTab !== "mcp"}<RecoveryNotice
            message={resourcesError}
            retry={refresh}
            retryLabel="Refresh resources"
          />
        {:else if resourceTab === "plugins"}
          {#if resources?.plugins?.length}<div class="resource-list">
              {#each resources.plugins as plugin}<article>
                  <h3>{plugin.name}</h3>
                  <p>{plugin.description}</p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onclick={() => {
                      resourceTab = "mcp";
                      connectionSettings = false;
                      connection = plugin.connection_id ?? "";
                      if (connection) loadTools();
                    }}>Open plugin tools</Button
                  >
                </article>{/each}
            </div>{:else}<p class="inspector-description">
              Plugin tools use an MCP connection and appear in the MCP tab. Plugins installed in
              your host app are not shared automatically.
            </p>
            <Button
              variant="outline"
              onclick={() => {
                resourceTab = "mcp";
                connectionSettings = true;
              }}>Connect an MCP server</Button
            >{/if}
        {:else if resourceTab === "skills"}
          {#if resources?.skills?.length}<div class="resource-list">
              {#each resources.skills as skill}<article
                  class:resource-focused={focusedSkill === skill.id}
                >
                  <h3>{skill.name}</h3>
                  <p>
                    {String(skill.description ?? "").length > 160
                      ? String(skill.description).slice(0, 157) + "..."
                      : skill.description}
                  </p>
                  <details open={focusedSkill === skill.id}>
                    <summary>Read guidance</summary>
                    {#if String(skill.description ?? "").length > 160}<p>
                        {skill.description}
                      </p>{/if}
                    <pre>{skill.instructions ??
                        skill.summary ??
                        "No guidance text is available."}</pre>
                    {#if skill.excerpt}<p>This is a bounded excerpt of the installed skill.</p>{/if}
                  </details>
                  <Button
                    variant="outline"
                    disabled={!skill.instructions && !skill.summary}
                    onclick={() =>
                      onAttach(`Skill: ${skill.name}\n${skill.instructions ?? skill.summary}`)}
                    >Attach guidance to message</Button
                  >
                </article>{/each}
            </div>{:else}<p class="inspector-description">
              No skill guidance is installed. Refresh after adding one to the project.
            </p>{/if}
        {:else}
          <div class="mcp-view-switch">
            <button
              class="btn"
              class:control-active={!connectionSettings}
              onclick={() => (connectionSettings = false)}>Tools</button
            ><button
              class="btn"
              class:control-active={connectionSettings}
              onclick={() => (connectionSettings = true)}>Connections</button
            >
          </div>
          {#if connectionSettings}
            <p class="inspector-description">
              Connect a Streamable HTTP MCP server. Credentials stay in memory for this run. Every
              tool call waits for your approval.
            </p>
            <div class="mcp-connections">
              {#if !status?.connections?.length}<p class="inspector-description">
                  No MCP server is connected. A connection added below appears in this list, and
                  this build keeps no connections between reloads.
                </p>
              {/if}
              {#each status?.connections ?? [] as item}<div>
                  <strong>{item.name}</strong><span>{item.url}</span><small
                    >{item.state ?? "Connected"} · {item.tool_count ?? 0} tools</small
                  >{#if item.id !== "local-laya" && !item.builtin}<Button
                      variant="outline"
                      class="btn"
                      onclick={() => disconnect(item.id)}
                      disabled={busy}>Disconnect</Button
                    >{/if}
                </div>{/each}
            </div>
            <form
              class="inspector-form"
              onsubmit={(e) => {
                e.preventDefault();
                connect();
              }}
            >
              <h3>Add a server</h3>
              <label
                >Name<Input
                  class="field"
                  bind:value={name}
                  required
                  maxlength={80}
                  placeholder="My MCP server"
                /></label
              ><label
                >Server URL<Input
                  class="field"
                  type="url"
                  bind:value={url}
                  required
                  placeholder="https://example.com/mcp"
                /></label
              ><label
                >Access token<Input
                  class="field"
                  type="password"
                  bind:value={token}
                  autocomplete="off"
                  placeholder="Optional bearer token"
                /></label
              ><label class="checkbox-label"
                ><input type="checkbox" bind:checked={allowLocal} />Allow this private or local
                server address</label
              ><Button
                variant="outline"
                class="btn btn-solid"
                disabled={busy || !name.trim() || !url.trim()}
                type="submit">Connect server</Button
              >
            </form>
            <details class="inspector-details">
              <summary>Use Laya from another MCP client</summary>
              <p>Connect your agent to this app’s HTTP MCP endpoint:</p>
              <code class="break-all"
                >{status?.incoming?.url ?? "No endpoint is configured in this build."}</code
              >{#if status?.incoming?.stdio}<pre>{JSON.stringify(
                    status.incoming.stdio,
                    null,
                    2,
                  )}</pre>{/if}
              <p>{status?.note}</p>
            </details>
          {:else}
            <p class="inspector-description">
              Select tools for this chat. Calls always wait for your approval.
            </p>
            <label class="inspector-field"
              >Connection<select
                class="field"
                bind:value={connection}
                onchange={loadTools}
                disabled={busy}
                ><option value="">Choose a connection</option
                >{#each status?.connections ?? [] as item}<option value={item.id}
                    >{item.name}</option
                  >{/each}</select
              ></label
            >
            {#if tools.length}<label class="inspector-field"
                >Find a tool<Input
                  class="field"
                  bind:value={toolFilter}
                  placeholder="Search available tools"
                /></label
              >
              <div class="available-tool-list">
                {#each visibleTools as item}<label
                    ><input
                      type="checkbox"
                      disabled={busy || resourceLoading || toolsConnection !== connection}
                      checked={selectedTools.includes(`${connection}::${item.name}`)}
                      onchange={(e) => toggleTool(item.name, e.currentTarget.checked)}
                    /><span
                      ><strong>{item.name}</strong><small
                        >{String(item.description ?? "MCP tool").slice(0, 160)}</small
                      ></span
                    ></label
                  >{/each}
              </div>
              {#if !visibleTools.length}<p class="inspector-description" role="status">
                  No matching tool. Try another name.
                </p>{/if}
              <details class="inspector-details" open={!!initialTool}>
                <summary>Run a tool manually</summary><label class="inspector-field"
                  >Tool<select class="field" bind:value={tool} onchange={chooseTool} disabled={busy}
                    >{#each tools as item}<option value={item.name}>{item.name}</option
                      >{/each}</select
                  ></label
                >
                <details>
                  <summary>Argument schema</summary>
                  <pre>{JSON.stringify(
                      tools.find((item) => item.name === tool)?.inputSchema ?? {},
                      null,
                      2,
                    )}</pre>
                </details>
                <label class="inspector-field"
                  >Arguments · JSON<Textarea
                    class="field mono"
                    rows={7}
                    bind:value={argumentsText}
                    oninput={() => {
                      approval = null;
                      result = null;
                    }}
                    disabled={busy}
                  ></Textarea></label
                ><Button variant="outline" class="btn" onclick={preview} disabled={busy || !tool}
                  >Preview tool call</Button
                >
              </details>
            {:else}<p class="inspector-description" role="status">
                {busy && connection
                  ? "Loading this connection's tools…"
                  : connection
                    ? "No tools are available for this connection. Refresh its list or check the server connection."
                    : "Choose an MCP connection to see its tools."}
              </p>{/if}
            {#if approval}<div class="tool-approval">
                <h3>Review this tool call</h3>
                <p>{approval.tool} on {approval.connection_id}</p>
                <pre>{JSON.stringify(approval.arguments, null, 2)}</pre>
                <p>
                  The server may perform actions on your behalf. Approve only the arguments shown.
                </p>
                <Button variant="outline" class="btn btn-solid" onclick={execute} disabled={busy}
                  >Approve and run tool</Button
                ><Button
                  variant="outline"
                  class="btn"
                  onclick={() => (approval = null)}
                  disabled={busy}>Cancel</Button
                >
              </div>{/if}
            {#if result}<div class="tool-result">
                <h3>Tool result</h3>
                <pre>{JSON.stringify(result.result ?? result, null, 2)}</pre>
                <Button
                  variant="outline"
                  class="btn"
                  onclick={() =>
                    onAttach(
                      `Tool result from ${result.tool ?? tool}:\n${JSON.stringify(result.result ?? result, null, 2)}`,
                    )}>Attach result to message</Button
                >
              </div>{/if}
          {/if}
        {/if}
      {/if}
    </div>{/each}
</section>

<style>
  .resource-tabs,
  .mcp-view-switch {
    display: flex;
    gap: 6px;
    margin: 12px 0 18px;
  }
  .resource-tabs button {
    flex: 1;
  }
  .resource-tabs button[aria-selected="true"],
  .mcp-view-switch .control-active {
    background: var(--color-nav-active);
    color: var(--color-ink);
  }
  .resource-list {
    display: grid;
    gap: 18px;
    font-size: 12px;
  }
  .resource-list article {
    padding-block: 12px;
    border-bottom: 1px solid var(--color-line);
  }
  .resource-list p {
    color: var(--color-ink-2);
    margin: 8px 0 12px;
    line-height: 1.6;
  }
  .resource-list details {
    margin: 12px 0;
  }
  .resource-list pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 11px;
    line-height: 1.6;
    padding: 10px 0;
    max-height: 300px;
    overflow-y: auto;
  }
  .resource-focused {
    outline: 1px solid var(--color-line);
    outline-offset: 8px;
  }
</style>

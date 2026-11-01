<script lang="ts">
  import { onMount, tick } from "svelte";
  import View from "#lib/View.svelte";
  import { Icon } from "../../../shared/icons/index.js";
  import AppSelect from "#lib/AppSelect.svelte";
  import BrowserAutomation from "#lib/BrowserAutomation.svelte";
  import WorkflowStudio from "#lib/WorkflowStudio.svelte";
  import { readDraft, saveDraft } from "#lib/drafts.js";
  import RecoveryNotice from "#lib/RecoveryNotice.svelte";
  import { get, post } from "#lib/http.js";

  type Props = {
    backend?: string;
    backends?: any[];
    onPick?: (id: string) => void;
    active?: boolean;
  };
  let { backend = "", backends = [], onPick = () => {}, active = true }: Props = $props();
  let config = $state<any>(null);
  type Mode = "studio" | "desktop" | "browser" | "documents";
  const MODES: { id: Mode; label: string }[] = [
    { id: "browser", label: "Browser RPA" },
    { id: "desktop", label: "Windows RPA" },
    { id: "studio", label: "Workflows" },
    { id: "documents", label: "Documents" },
  ];
  let mode = $state<Mode>("browser");
  let draftReady = $state(false);
  let filename = $state("northwind-invoice.txt");
  let text = $state(
    "Invoice INV-42 from Northwind Supplies. Amount due: USD 480. Payment is due in 30 days. This invoice requests payment for office supplies.",
  );
  let busy = $state("");
  let error = $state("");
  let preview = $state<any>(null);
  let saved = $state<any>(null);
  let copied = $state(false);
  let workspace = $state("");
  let minConfidence = $state(0.85);
  let folders = $state<Record<string, string>>({});
  let artifact = $state<any>(null);
  let readVersion = 0;
  let stateVersion = 0;
  let operationVersion = 0;
  let configVersion = 0;
  let alive = false;
  let restoredConfidence: unknown;
  const selected = $derived(backends.find((b) => b.id === backend));
  const local = $derived(/^local:(npu|gpu|cpu)$/.test(backend));
  const extensions = $derived<string[]>(config?.extensions ?? []);
  const maxBytes = $derived<number | null>(config?.max_bytes ?? null);
  const fileLimit = $derived(
    maxBytes === null ? "Loading file limits…" : `${(maxBytes / 1000).toLocaleString()} KB`,
  );
  let localOptions = $derived(
    backends
      .filter((item) => item.kind === "local")
      .map((item) => ({ value: item.id, label: item.device, disabled: !item.ready })),
  );
  async function tabKey(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % MODES.length;
    else if (event.key === "ArrowLeft") next = (index + MODES.length - 1) % MODES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = MODES.length - 1;
    else return;
    event.preventDefault();
    mode = MODES[next].id;
    await tick();
    document.getElementById(`automation-tab-${mode}`)?.focus();
  }

  onMount(() => {
    alive = true;
    const stored = readDraft<any>("workflow-adapters", null);
    if (["studio", "desktop", "browser", "documents"].includes(stored?.mode)) mode = stored.mode;
    if (typeof stored?.text === "string") text = stored.text;
    if (typeof stored?.filename === "string") filename = stored.filename;
    if (typeof stored?.workspace === "string") workspace = stored.workspace;
    if (stored?.folders && typeof stored.folders === "object" && !Array.isArray(stored.folders))
      folders = Object.fromEntries(
        Object.entries(stored.folders).filter(([, value]) => typeof value === "string"),
      ) as Record<string, string>;
    if (
      Number.isFinite(stored?.minConfidence) &&
      stored.minConfidence >= 0.5 &&
      stored.minConfidence <= 0.99
    )
      minConfidence = stored.minConfidence;
    draftReady = true;
    restoredConfidence = stored?.minConfidence;
    refreshConfig();
    return () => {
      alive = false;
      readVersion++;
      stateVersion++;
      operationVersion++;
      configVersion++;
    };
  });
  async function refreshConfig() {
    const version = ++configVersion;
    try {
      const value = await get("/api/automation/status");
      if (!alive || version !== configVersion) return;
      config = value;
      if (config.error) error = config.error;
      else {
        folders = { ...config.policy.folders, ...folders };
        if (
          typeof restoredConfidence !== "number" ||
          !Number.isFinite(restoredConfidence) ||
          restoredConfidence < 0.5 ||
          restoredConfidence > 0.99
        )
          minConfidence = config.policy.min_confidence;
        error = "";
      }
    } catch {
      if (alive && version === configVersion)
        error = "Automation status did not load. Reload the page to try again.";
    }
  }
  $effect(() => {
    if (draftReady)
      saveDraft("workflow-adapters", { mode, text, filename, workspace, folders, minConfidence });
  });

  $effect(() => {
    backend;
    clearResult();
  });

  function clearResult() {
    stateVersion++;
    readVersion++;
    preview = null;
    saved = null;
    error = "";
    copied = false;
    artifact = null;
  }

  async function chooseFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    clearResult();
    const version = ++readVersion;
    const suffix = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (maxBytes === null || !extensions.length) {
      error = "Document limits did not load. Reload the page to try again.";
      input.value = "";
      return;
    }
    if (!extensions.includes(suffix) || file.size > maxBytes) {
      error = `Choose ${extensions.join(", ")} text smaller than ${fileLimit}.`;
      input.value = "";
      return;
    }
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (!alive || version !== readVersion) return;
      filename = file.name;
      text = content;
    } catch {
      if (alive && version === readVersion)
        error = "This file is not UTF-8 text. Save it as UTF-8 and choose it again.";
    }
  }

  async function prepare() {
    if (busy || !config?.available || !local) return;
    clearResult();
    const version = stateVersion;
    const operation = ++operationVersion;
    busy = "preview";
    try {
      const result = await post<any>("/api/automation/preview", {
        backend,
        filename,
        text,
        workspace,
        min_confidence: minConfidence,
        folders,
      });
      if (result.error) throw new Error(result.error);
      if (!alive || version !== stateVersion || operation !== operationVersion) return;
      preview = result;
    } catch (e: any) {
      if (alive && version === stateVersion && operation === operationVersion)
        error =
          e.message ||
          "Could not prepare the automation. Check the backend in Compute and try again.";
    } finally {
      if (alive && operation === operationVersion) busy = "";
    }
  }

  async function saveCopy() {
    if (!preview || busy) return;
    const version = stateVersion;
    const operation = ++operationVersion;
    const approved = preview.preview_id;
    busy = "save";
    error = "";
    try {
      const result = await post<any>("/api/automation/execute", {
        preview_id: approved,
        confirm: true,
      });
      if (result.error) throw new Error(result.error);
      if (
        !alive ||
        version !== stateVersion ||
        operation !== operationVersion ||
        preview?.preview_id !== approved
      )
        return;
      saved = result;
      artifact = { ...result, matches_preview: result.verified };
    } catch (e: any) {
      if (alive && version === stateVersion && operation === operationVersion)
        error = e.message || "Could not save the document. Run the preview again.";
    } finally {
      if (alive && operation === operationVersion) busy = "";
    }
  }

  async function verifySaved() {
    if (!saved?.preview_id || busy) return;
    const version = stateVersion;
    const operation = ++operationVersion;
    const identifier = saved.preview_id;
    busy = "verify";
    error = "";
    try {
      const result = await post<any>("/api/automation/artifact", { preview_id: identifier });
      if (result.error) throw new Error(result.error);
      if (
        !alive ||
        version !== stateVersion ||
        operation !== operationVersion ||
        saved?.preview_id !== identifier
      )
        return;
      artifact = result;
    } catch (e: any) {
      if (alive && version === stateVersion && operation === operationVersion)
        error = e.message || "Could not read the saved file.";
    } finally {
      if (alive && operation === operationVersion) busy = "";
    }
  }

  function downloadArtifact() {
    if (!artifact) return;
    const url = URL.createObjectURL(
      new Blob([artifact.content], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(saved?.path || config?.output_root || "");
      copied = true;
    } catch {
      error = "Clipboard access is unavailable. Select and copy the path shown below.";
    }
  }
</script>

<View
  title="Automation"
  icon="grid"
  subtitle="Four recipes that change something outside this page, or preview a change: a browser run, the installed Windows app, a workflow, and a document save. Each one shows what it will do before it does it."
>
  <p class="workflow-distinction">
    Every action waits for your approval. Testing an answer changes nothing, so use <a
      href="#playground"
      class="text-link">Decision simulation</a
    > for that.
  </p>
  <div class="recipe-tabs" role="tablist" aria-label="Automation tools">
    {#each MODES as item, index}<button
        class="btn"
        role="tab"
        id={`automation-tab-${item.id}`}
        aria-controls={`automation-panel-${item.id}`}
        aria-selected={mode === item.id}
        tabindex={mode === item.id ? 0 : -1}
        onclick={() => (mode = item.id)}
        onkeydown={(event) => tabKey(event, index)}>{item.label}</button
      >{/each}
  </div>
  {#if mode === "desktop" || mode === "documents"}<label class="automation-compute"
      >Local AI device<AppSelect
        value={backend}
        options={localOptions}
        label="Automation local compute"
        disabled={!!busy}
        onchange={onPick}
      /></label
    >{/if}
  <div
    class="workflow-content"
    role="tabpanel"
    id="automation-panel-studio"
    aria-labelledby="automation-tab-studio"
    hidden={mode !== "studio"}
    inert={mode !== "studio"}
  >
    <WorkflowStudio active={active && mode === "studio"} />
  </div>
  <div
    class="workflow-content"
    role="tabpanel"
    id="automation-panel-desktop"
    aria-labelledby="automation-tab-desktop"
    hidden={mode !== "desktop"}
    inert={mode !== "desktop"}
  >
    <BrowserAutomation kind="desktop" {backend} active={active && mode === "desktop"} />
  </div>
  <div
    class="workflow-content"
    role="tabpanel"
    id="automation-panel-browser"
    aria-labelledby="automation-tab-browser"
    hidden={mode !== "browser"}
    inert={mode !== "browser"}
  >
    <BrowserAutomation active={active && mode === "browser"} />
  </div>
  <div
    class="workflow-content"
    role="tabpanel"
    id="automation-panel-documents"
    aria-labelledby="automation-tab-documents"
    hidden={mode !== "documents"}
    inert={mode !== "documents"}
  >
    <div class="automation">
      <section class="recipe-intro" aria-labelledby="recipe-title">
        <div>
          <h3 id="recipe-title">Organise a text document</h3>
          <p>
            Choose a file or paste English text. Invoices, receipts and meeting notes each go to
            their own folder under <strong>Documents / Laya Automations</strong>.
          </p>
        </div>
        <span class="chip">{selected?.device || "Local device"} · runs locally</span>
      </section>

      {#if !local}
        <div role="status" class="notice">
          Select NPU, GPU or CPU in Compute &amp; devices to run this local recipe. An endpoint is not
          used for document automation.
        </div>
      {/if}
      {#if error}<RecoveryNotice
          message={error}
          retry={config?.available ? prepare : refreshConfig}
          retryLabel={config?.available ? "Preview again" : "Reconnect"}
        />{/if}

      <ol class="progress" aria-label="Automation progress">
        <li class:complete={!!text.trim()}>Choose document</li>
        <li class:complete={!!preview || !!saved}>Review exact output</li>
        <li class:complete={!!saved}>Approve save</li>
        <li class:complete={!!artifact?.matches_preview}>Verify saved content</li>
      </ol>
      <div class="workspace">
        <section class="document-pane" aria-labelledby="document-title">
          <h3 id="document-title">Choose your document</h3>
          <label for="automation-file" class="field-label"
            >Open a text file <span>{extensions.join(", ")} · up to {fileLimit}</span></label
          >
          <input
            id="automation-file"
            type="file"
            accept={extensions.join(",")}
            onchange={chooseFile}
            disabled={!!busy || !config?.available}
          />
          <label for="automation-filename" class="field-label">Filename for the copy</label>
          <input
            id="automation-filename"
            class="field"
            bind:value={filename}
            oninput={clearResult}
            disabled={!!busy}
            maxlength="120"
          />
          <label for="automation-text" class="field-label">Document text</label>
          <textarea
            id="automation-text"
            class="field document-text"
            rows="10"
            bind:value={text}
            oninput={clearResult}
            disabled={!!busy}
            aria-describedby="automation-limit"></textarea>
          <p id="automation-limit" class="hint">
            Laya classifies English text. The first part of a long document determines the folder;
            the saved copy includes all your text.
          </p>
          <details class="policy-editor">
            <summary>Edit the folder policy</summary>
            <label for="automation-workspace" class="field-label"
              >Project folder inside the output root · optional</label
            >
            <input
              id="automation-workspace"
              class="field"
              bind:value={workspace}
              oninput={clearResult}
              disabled={!!busy}
              placeholder="For example: Finance"
              maxlength="60"
            />
            <p class="hint">
              Root: <span class="mono">{config?.output_root || "Loading…"}</span>. The recipe
              accepts folder names inside this root, rather than arbitrary system paths.
            </p>
            <label for="automation-threshold" class="field-label"
              >Minimum confidence · {(minConfidence * 100).toFixed(0)}%</label
            >
            <input
              id="automation-threshold"
              type="range"
              min="0.5"
              max="0.99"
              step="0.01"
              bind:value={minConfidence}
              oninput={clearResult}
              disabled={!!busy || !config?.available}
            />
            {#each Object.entries(config?.policy?.folders || {}) as [id, label]}<label
                for={"automation-folder-" + id}
                class="field-label">{label} go to</label
              ><input
                id={"automation-folder-" + id}
                class="field"
                bind:value={folders[id]}
                oninput={clearResult}
                maxlength="60"
                disabled={!!busy}
              />{/each}
            <p class="hint">
              Below the threshold, files go to {config?.policy?.review_folder || "Needs review"}.
              The policy determines the folder; Laya only classifies the text.
            </p>
          </details>
          <button
            class="btn btn-solid"
            onclick={prepare}
            disabled={!!busy || !config?.available || !local || !text.trim() || !filename.trim()}
          >
            <Icon name="play" size={13} />
            {busy === "preview" ? "Reading document…" : "Preview automation"}
          </button>
          {#if busy === "preview"}<p class="hint" role="status">
              The first run may need to compile the model. Keep this page open.
            </p>{/if}
        </section>

        <section
          class="review-pane"
          aria-labelledby="review-title"
          aria-live="polite"
          aria-busy={!!busy}
        >
          <h3 id="review-title">Review and save</h3>
          {#if saved}
            <div class="success">
              <Icon name="check" size={18} /><strong>Your document is organised.</strong>
            </div>
            <p>A new copy was saved on this computer. Your original file is unchanged.</p>
            <label for="automation-saved" class="field-label">Saved file</label>
            <input id="automation-saved" class="field mono path" readonly value={saved.path} />
            <div class="result-actions">
              <button class="btn" onclick={copyPath}
                >{copied ? "Path copied" : "Copy file path"}</button
              ><button class="btn" onclick={verifySaved} disabled={!!busy}
                >{busy === "verify" ? "Reading file…" : "Read back file"}</button
              ><button class="btn" onclick={downloadArtifact} disabled={!artifact}
                >Download exact content</button
              >
            </div>
            {#if artifact}<div class="verified" role="status">
                {artifact.matches_preview
                  ? "Read-back verified: saved bytes match the approved preview."
                  : "The file changed after saving. This content differs from the approved preview."}
              </div>
              <label for="automation-readback" class="field-label"
                >Actual content read from the saved file</label
              ><textarea
                id="automation-readback"
                class="field exact-content"
                readonly
                rows="8"
                value={artifact.content}></textarea>
              <p class="hash">SHA-256: {artifact.sha256}</p>{/if}
            <p class="hint">
              Paste this path into File Explorer to open the file. Preview another document to run
              the recipe again.
            </p>
          {:else if preview}
            <dl class="details">
              <div>
                <dt>Laya recognised</dt>
                <dd>{preview.category_label}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{(preview.confidence * 100).toFixed(1)}%</dd>
              </div>
              <div>
                <dt>Actual inference</dt>
                <dd>{preview.ms} ms · {preview.device}</dd>
              </div>
            </dl>
            {#if preview.requires_review}<p class="notice">
                Confidence is below {(preview.policy.min_confidence * 100).toFixed(0)}%. The policy
                will save this document to <strong>Needs review</strong> so you can check it.
              </p>{/if}
            <label for="automation-destination" class="field-label"
              >Destination on this computer</label
            >
            <input
              id="automation-destination"
              class="field mono path"
              readonly
              value={preview.destination}
            />
            <div class="file-change" aria-label="Exact file operation preview">
              <h4>Before → after</h4>
              <div class="tree-pair">
                <div>
                  <span>Before · existing files</span>
                  <pre>{preview.tree.before.length
                      ? preview.tree.before.join("\n")
                      : "(Folder empty or not created yet)"}</pre>
                </div>
                <div>
                  <span>After · one new copy</span>
                  <pre>{preview.tree.after.join("\n")}</pre>
                </div>
              </div>
              <p class="hint">
                Folder: <span class="mono">{preview.tree.folder}</span>{preview.tree.truncated
                  ? " · first 30 existing filenames shown"
                  : ""}
              </p>
              <label for="automation-exact-preview" class="field-label"
                >Exact UTF-8 content to save · unchanged from your input</label
              ><textarea
                id="automation-exact-preview"
                class="field exact-content"
                rows="8"
                readonly
                value={preview.content}></textarea>
              <p class="hash">{preview.bytes} bytes · SHA-256: {preview.sha256}</p>
              <details>
                <summary>Inspect the operation payload</summary>
                <pre class="payload">{JSON.stringify(
                    {
                      operation: preview.operation,
                      destination: preview.destination,
                      policy: preview.policy,
                      bytes: preview.bytes,
                      sha256: preview.sha256,
                    },
                    null,
                    2,
                  )}</pre>
              </details>
            </div>
            <ol class="steps">
              {#each preview.steps as step}<li>{step}</li>{/each}
            </ol>
            <p class="hint">
              The path and content above are exactly what will be saved. Existing files are
              preserved. If this destination becomes occupied after preview, the save stops and asks
              you to preview again. The preview expires after 10 minutes.
            </p>
            <button class="btn btn-solid" onclick={saveCopy} disabled={!!busy}
              >{busy === "save" ? "Saving copy…" : "Approve and save copy"}</button
            >
          {:else}
            <div class="empty">
              <Icon name="folder" size={28} />
              <p><strong>See the destination before anything happens.</strong></p>
              <p>
                Preview the example already loaded, or choose your own document. Then approve the
                save here.
              </p>
            </div>
          {/if}
        </section>
      </div>

      <details class="scope">
        <summary>What can this automation do?</summary>
        <p>
          This recipe performs a real file operation on the computer running Laya. It saves text
          copies in a fixed output folder after review. It does not yet click through arbitrary
          apps, send email, move original files, or read PDF and image contents.
        </p>
        <p>
          For custom decision rules and an invoice workflow preview, <a
            class="text-link"
            href="#playground">open Decision simulation</a
          >. That RPA preview is a simulation; no ERP action is sent.
        </p>
        {#if config?.output_root}<p>
            Output folder: <span class="mono">{config.output_root}</span>
          </p>{/if}
      </details>
    </div>
  </div>
</View>

<style>
  .automation-compute {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    color: var(--color-ink-2);
    font-size: 12px;
  }
  .recipe-tabs {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 20px;
  }
  .workflow-distinction {
    flex-shrink: 0;
    margin: 0 0 16px;
    color: var(--color-ink-2);
    font-size: 12px;
    line-height: 1.6;
    max-width: 80ch;
  }
  .recipe-tabs [aria-selected="true"] {
    background: var(--color-ink);
    color: var(--color-page);
  }
  .workflow-content {
    flex-shrink: 0;
    min-width: 0;
  }
  .automation {
    max-width: 1320px;
    width: 100%;
    font-size: 13px;
    line-height: 1.6;
  }
  .recipe-intro {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 24px;
    margin-bottom: 24px;
  }
  h3 {
    color: var(--color-ink);
    font-size: 16px;
    font-weight: 600;
    line-height: 1.4;
    margin-bottom: 8px;
  }
  p {
    color: var(--color-ink-2);
    max-width: 72ch;
  }
  .recipe-intro .chip {
    white-space: nowrap;
  }
  .progress {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 0 0 20px;
    padding: 0;
    counter-reset: step;
  }
  .progress li {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--color-ink-2);
    counter-increment: step;
  }
  .progress li::before {
    content: counter(step);
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--color-line);
    border-radius: 50%;
    font-size: 11px;
  }
  .progress li.complete::before {
    color: var(--color-page);
    background: var(--color-ink);
    border-color: var(--color-ink);
  }
  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.9fr);
    border: 1px solid var(--color-line);
    border-radius: 12px;
    overflow: hidden;
  }
  .document-pane,
  .review-pane {
    padding: 24px;
    min-width: 0;
  }
  .review-pane {
    background: var(--color-panel);
    border-left: 1px solid var(--color-line);
  }
  .field-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-ink);
    margin: 20px 0 7px;
  }
  .field-label span {
    display: block;
    font-weight: 400;
    color: var(--color-ink-2);
  }
  .policy-editor {
    margin: 18px 0;
    border-block: 1px solid var(--color-line);
    padding: 10px 0;
  }
  .policy-editor summary,
  .file-change summary {
    cursor: pointer;
    min-height: 44px;
    padding: 10px 0;
    color: var(--color-ink-2);
  }
  .policy-editor input[type="range"] {
    width: 100%;
    accent-color: var(--color-ink);
  }
  .file-change {
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid var(--color-line);
  }
  .file-change h4 {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 14px;
  }
  .tree-pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .tree-pair span {
    display: block;
    font-size: 11px;
    color: var(--color-ink-2);
    margin-bottom: 8px;
  }
  .tree-pair pre {
    font-size: 11px;
    overflow: auto;
    min-height: 90px;
    max-height: 150px;
    padding: 12px;
    background: var(--color-panel-2);
    border-radius: 6px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .exact-content {
    font-size: 12px;
    line-height: 1.6;
    min-height: 180px;
    resize: vertical;
  }
  .hash {
    font-size: 10px;
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
    margin: 10px 0;
  }
  .payload {
    overflow: auto;
    max-height: 240px;
    font-size: 11px;
  }
  .result-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
  }
  .verified {
    font-size: 12px;
    padding: 12px 0;
    color: #9cddb4;
  }
  .document-text {
    min-height: 220px;
    resize: vertical;
    line-height: 1.6;
  }
  input[type="file"] {
    max-width: 100%;
    font-size: 12px;
  }
  input[type="file"]::file-selector-button {
    border: 1px solid var(--color-line);
    border-radius: 6px;
    padding: 10px 12px;
    margin-right: 12px;
    cursor: pointer;
    background: var(--color-panel-2);
    color: var(--color-ink);
  }
  .hint {
    font-size: 12px;
    margin: 10px 0 16px;
  }
  .btn {
    min-height: 44px;
    padding: 10px 14px;
  }
  .notice {
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 8px;
    margin-bottom: 16px;
  }
  .notice {
    color: var(--color-ink);
    background: var(--color-panel-2);
  }
  .details {
    display: grid;
    gap: 10px;
    margin: 20px 0;
  }
  .details div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
  }
  dt {
    color: var(--color-ink-2);
  }
  dd {
    font-weight: 600;
  }
  .path {
    font-size: 11px;
    min-height: 42px;
  }
  .steps {
    list-style: decimal;
    padding-left: 22px;
    margin: 20px 0;
    color: var(--color-ink-2);
  }
  .steps li {
    padding-left: 4px;
    margin-bottom: 8px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    min-height: 300px;
    gap: 12px;
    color: var(--color-ink-3);
  }
  .empty strong {
    color: var(--color-ink);
  }
  .success {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #9cddb4;
    margin: 28px 0 14px;
  }
  .scope {
    margin-top: 24px;
    border-top: 1px solid var(--color-line);
    padding-top: 16px;
  }
  .scope summary {
    cursor: pointer;
    color: var(--color-ink-2);
    min-height: 44px;
  }
  .scope p {
    margin: 0 0 12px;
  }
  .text-link {
    text-decoration: underline;
    text-underline-offset: 3px;
    color: var(--color-ink);
  }
  @media (max-width: 900px) {
    .workspace {
      grid-template-columns: 1fr;
    }
    .review-pane {
      border-left: 0;
      border-top: 1px solid var(--color-line);
    }
    .recipe-intro {
      flex-direction: column;
      gap: 12px;
    }
  }
  @media (max-width: 480px) {
    .document-pane,
    .review-pane {
      padding: 18px;
    }
    .btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>

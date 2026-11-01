<script lang="ts">
  import RecoveryNotice from "#lib/RecoveryNotice.svelte";
  import { onMount } from "svelte";
  import View from "#lib/View.svelte";
  import { Icon } from "../../../shared/icons/index.js";
  import { get, post, api } from "#lib/http.js";
  import AttachmentPreview from "#lib/AttachmentPreview.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Input } from "#lib/components/ui/input/index.js";
  import { Textarea } from "#lib/components/ui/textarea/index.js";
  import { readDraft, saveDraft } from "#lib/drafts.js";

  type Props = { backend?: string; backends?: any[] };
  let { backend = "", backends = [] }: Props = $props();
  let status = $state<any>(null);
  let capabilities = $state<any>(null);
  let installing = $state(false);
  let installRequest = $state(false);
  let searchVersion = 0;
  let query = $state("How do I get my money back?");
  let documents = $state<string[]>([
    "To request a refund, open Billing and select the payment you want returned.",
    "To change your password, open Account settings and choose Security.",
    "Delivery usually takes three to five business days after your order ships.",
  ]);
  let busy = $state(false);
  let loading = $state(true);
  let attachmentBusy = $state(false);
  let attachments = $state<any[]>([]);
  let error = $state("");
  let result = $state<any>(null);
  let selection = $state(-1);
  let roundtrip = $state<number | null>(null);
  let hydrated = $state(false);
  let alive = true;
  const device = $derived(backends.find((item) => item.id === backend)?.device || "");
  const vector = $derived(
    selection === -1
      ? result?.query_vector || []
      : result?.results?.find((item: any) => item.index === selection)?.vector || [],
  );
  const previewVector = $derived(vector.slice(0, 64));
  const vectorScale = $derived(
    Math.max(0.00001, ...previewVector.map((value: number) => Math.abs(value))),
  );
  const best = $derived(result?.results?.[0]);
  const canRun = $derived(
    !!status?.installed && !installing && !installRequest && status?.devices?.includes(device),
  );
  const maxDocuments = $derived(status?.limits?.max_documents ?? 0);
  const attachmentLimits = $derived(capabilities?.attachments);
  const hasTruncation = $derived(
    !!result &&
      ((result.truncated_count || 0) > 0 ||
        (result.truncation?.omitted_chunks || 0) > 0 ||
        (result.truncation?.files_without_text?.length || 0) > 0),
  );
  const sourceLabel = (item: any) =>
    item?.source?.kind === "attachment"
      ? `${item.source.name || "Uploaded file"}${item.source.chunk != null ? ` · section ${item.source.chunk}` : ""}`
      : `Document ${(item?.source?.document_index ?? item?.index ?? 0) + 1}`;
  const dimensions = $derived(result?.dimensions || status?.dimensions);
  const valueLabel = (value: number) => (Number.isFinite(value) ? value.toFixed(4) : "—");
  const width = (value: number) => `${Math.max(0, Math.min(1, value)) * 100}%`;

  async function refreshStatus() {
    const next = await get("/api/embeddings");
    if (!alive) return;
    if (next.error) throw new Error(next.error);
    status = next;
    installing = ["downloading", "downloding"].includes(next.job?.state);
    if (next.job?.state === "error")
      error = next.job.error || "Model installation failed. Try Install again to resume.";
  }

  onMount(() => {
    alive = true;
    let polling = false;
    const saved = readDraft<any>("embeddings", null);
    if (saved && typeof saved.query === "string") query = saved.query;
    if (
      saved &&
      Array.isArray(saved.documents) &&
      saved.documents.length <= 100 &&
      saved.documents.every((item: any) => typeof item === "string")
    )
      documents = saved.documents;
    if (saved && Array.isArray(saved.attachments) && saved.attachments.length <= 32)
      attachments = saved.attachments.filter(
        (item: any) =>
          item &&
          typeof item.id === "string" &&
          /^[a-f0-9]{32}$/.test(item.id) &&
          typeof item.name === "string",
      );
    hydrated = true;
    Promise.all([
      refreshStatus(),
      api.capabilities().then((data: any) => {
        if (!alive) return;
        if (data.error) throw new Error(data.error);
        capabilities = data;
      }),
    ])
      .catch((e: any) => {
        if (alive) error = e.message || "The local embedding service is unavailable.";
      })
      .finally(() => {
        if (alive) loading = false;
      });
    const timer = window.setInterval(async () => {
      if (!alive || !installing || polling) return;
      polling = true;
      try {
        await refreshStatus();
      } catch (e: any) {
        if (alive) error = e.message;
      } finally {
        polling = false;
      }
    }, 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      searchVersion++;
    };
  });
  $effect(() => {
    if (hydrated)
      saveDraft("embeddings", {
        query,
        documents,
        attachments: attachments.map((file) => ({
          id: file.id,
          name: file.name,
          kind: file.kind,
          capabilities: file.capabilities,
          note: file.note,
        })),
      });
  });
  $effect(() => {
    backend;
    searchVersion++;
    busy = false;
    result = null;
    roundtrip = null;
    selection = -1;
  });

  async function install() {
    installRequest = true;
    error = "";
    try {
      const response = await post<any>("/api/embeddings/install", {});
      if (response.error) throw new Error(response.error);
      await refreshStatus();
    } catch (e: any) {
      error = e.message || "Could not start the model download.";
    } finally {
      installRequest = false;
    }
  }

  function changed() {
    searchVersion++;
    result = null;
    error = "";
    roundtrip = null;
    selection = -1;
  }

  async function run() {
    if (busy || attachmentBusy) return;
    const requestedDevice = device;
    const request = ++searchVersion;
    busy = true;
    error = "";
    result = null;
    selection = -1;
    try {
      if (
        !query.trim() ||
        documents.some((item) => !item.trim()) ||
        (!documents.length && !attachments.length)
      )
        throw new Error("Enter a search query and add at least one candidate document.");
      const started = performance.now();
      const response: any = await post("/api/embeddings/search", {
        query: query.trim(),
        documents: documents.map((text) => text.trim()),
        attachment_ids: attachments.map((file) => file.id),
        device: requestedDevice,
      });
      if (!alive || request !== searchVersion || device !== requestedDevice) return;
      roundtrip = performance.now() - started;
      if (response.error) throw new Error(response.error);
      if (!Array.isArray(response.results) || !response.results.length)
        throw new Error("The model returned no similarity results. Try the example again.");
      result = {
        ...response,
        results: [...response.results].sort((a: any, b: any) => b.similarity - a.similarity),
      };
    } catch (e: any) {
      if (alive && request === searchVersion)
        error = e.message || "Could not create embeddings. Check the model and device in Setup.";
    } finally {
      if (alive && request === searchVersion) busy = false;
    }
  }

  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement,
      files = Array.from(input.files || []);
    input.value = "";
    attachmentBusy = true;
    error = "";
    try {
      for (const file of files) {
        if (!attachmentLimits)
          throw new Error("Attachment limits are unavailable. Refresh the page before uploading.");
        if (attachments.length >= attachmentLimits.max_files_per_turn)
          throw new Error(
            `Use at most ${attachmentLimits.max_files_per_turn} uploaded files. Remove a file before adding another.`,
          );
        if (file.size > attachmentLimits.max_file_bytes)
          throw new Error(
            `${file.name} exceeds the ${Math.floor(attachmentLimits.max_file_bytes / 1024 / 1024)} MB file limit.`,
          );
        const saved = await api.attachmentUpload(file);
        if (!alive) return;
        if (saved.error) throw new Error(saved.error);
        attachments = [...attachments, saved];
      }
      if (alive) changed();
    } catch (e: any) {
      if (alive) error = e.message || "Could not extract this document.";
    } finally {
      if (alive) attachmentBusy = false;
    }
  }

  async function removeFile(id: string) {
    attachmentBusy = true;
    error = "";
    try {
      const response = await api.attachmentDelete(id);
      if (!alive) return;
      if (response.error) throw new Error(response.error);
      attachments = attachments.filter((file) => file.id !== id);
      changed();
    } catch (e: any) {
      if (alive) {
        attachments = attachments.filter((file) => file.id !== id);
        changed();
        error = `Removed from this search. The saved copy could not be deleted: ${e.message || "check the server connection"}`;
      }
    } finally {
      if (alive) attachmentBusy = false;
    }
  }
</script>

<View
  title="Embedding search"
  icon="layers"
  subtitle="Rank documents by meaning rather than by matching words. Needs an embedding model, separate from the decision and chat models; this build ships none, so the panel names what is missing instead of ranking."
>
  <div class="embedding-page">
    <div class="flow" aria-label="Embedding workflow">
      <div>
        <Icon name="search" size={18} /><strong>Your text</strong><span
          >Query + candidate documents</span
        >
      </div>
      <Icon name="arrowUpRight" size={18} />
      <div class:active={!!result}>
        <Icon name="layers" size={18} /><strong>Meaning as numbers</strong><span
          >{dimensions ? `${dimensions} values per text` : "An embedding vector per text"}</span
        >
      </div>
      <Icon name="arrowUpRight" size={18} />
      <div class:active={!!result}>
        <Icon name="gauge" size={18} /><strong>Closest meaning</strong><span
          >Rank by cosine similarity</span
        >
      </div>
    </div>
    {#if loading}<p class="status" role="status">
        Checking for an embedding model…
      </p>{:else if !status?.installed}<div class="setup-note">
        <Icon name="cpu" size={18} />
        <div>
          <strong>Install an embedding model to try this.</strong>
          <p>
            {status?.reason ||
              "An embedding model is separate from the decision model and the chat model."}
          </p>
          <div class="install-actions">
            <Button onclick={install} disabled={installRequest || installing || !!status?.custom}
              >{installRequest
                ? "Starting download…"
                : installing
                  ? "Downloading model…"
                  : "Install embedding model"}</Button
            ><a href="#models">Model setup</a>
          </div>
          {#if installing}<p role="status">
              Downloading the fixed local model. This page updates when it is ready.
            </p>{/if}
        </div>
      </div>{/if}
    {#if backend === "byok"}<p class="status">
        Choose a CPU, GPU or NPU device in the header for this embedding workflow.
      </p>{/if}
    {#if error}<RecoveryNotice
        message={error}
        retry={refreshStatus}
        retryLabel="Check model"
      />{/if}

    <div class="workbench">
      <section class="input-side" aria-labelledby="embedding-input-title">
        <h2 id="embedding-input-title">What do you want to find?</h2>
        <label for="embedding-query">Search by meaning · English text</label>
        <Input
          id="embedding-query"
          bind:value={query}
          oninput={changed}
          disabled={busy}
          maxlength={status?.limits?.max_query_chars}
        />
        <div class="candidate-heading">
          <h3>Candidate documents</h3>
          <span
            >{documents.length} text{documents.length === 1 ? "" : "s"} · {attachments.length} file{attachments.length ===
            1
              ? ""
              : "s"}</span
          >
        </div>
        {#each documents as _, index}
          <label for={"embedding-document-" + index} class="document-label"
            >Document {index + 1}{#if documents.length > 0}<Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label={`Remove document ${index + 1}`}
                onclick={() => {
                  documents = documents.filter((_, i) => i !== index);
                  changed();
                }}
                disabled={busy}><Icon name="x" size={12} /></Button
              >{/if}</label
          >
          <Textarea
            id={"embedding-document-" + index}
            rows={3}
            bind:value={documents[index]}
            oninput={changed}
            disabled={busy}
            maxlength={status?.limits?.max_document_chars}
          />
        {/each}
        <div class="document-upload">
          <label for="embedding-files"
            >Or search your own documents <span
              >{attachmentLimits
                ? `${attachmentLimits.max_files_per_turn} files · ${Math.floor(attachmentLimits.max_file_bytes / 1024 / 1024)} MB each`
                : "Checking supported file types…"}</span
            ></label
          ><input
            id="embedding-files"
            type="file"
            multiple
            accept={attachmentLimits?.accept}
            onchange={upload}
            disabled={busy || attachmentBusy || !attachmentLimits}
          />
          {#if attachments.length}<div class="attachment-list">
              {#each attachments as file}<div>
                  <AttachmentPreview {file} compact /><Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${file.name}`}
                    onclick={() => removeFile(file.id)}
                    disabled={busy || attachmentBusy}><Icon name="x" size={12} /></Button
                  >
                </div>{/each}
            </div>
            <p class="hint">
              Only extracted text is embedded. Scanned PDFs without text need OCR. Remove example
              candidates to search uploaded files alone.
            </p>{/if}
          {#if attachmentBusy}<p class="hint" role="status">
              Extracting document text locally…
            </p>{/if}
        </div>
        <div class="input-actions">
          <Button
            variant="outline"
            onclick={() => {
              documents = [...documents, ""];
              changed();
            }}
            disabled={busy || !maxDocuments || documents.length >= maxDocuments}
            ><Icon name="plus" size={12} /> Add document</Button
          ><Button onclick={run} disabled={busy || attachmentBusy || !canRun}
            >{busy ? "Comparing meaning…" : "Find closest meaning"}</Button
          >
        </div>
        <p class="hint">
          {device || "Select a local device above"} · local model · up to {maxDocuments || "…"} text sections
        </p>
        <p class="hint">
          Query, candidate text and file references stay in this tab across refresh. Run again for
          fresh results; a deleted file must be removed or uploaded again.
        </p>
      </section>

      <section
        class="output-side"
        aria-labelledby="embedding-result-title"
        aria-live="polite"
        aria-busy={busy}
      >
        <h2 id="embedding-result-title">
          {result ? "Ranked by meaning" : "Your match appears here"}
        </h2>
        {#if result}
          <div class="result-meta">
            <span>{result.model}</span><span
              >{result.device} · {result.ms?.toFixed(1)} ms server</span
            >
          </div>
          {#if hasTruncation}<details class="truncation-note">
              <summary>Some input was shortened or skipped</summary>
              <p>
                {result.truncated_count || 0} truncated inputs · {result.truncation
                  ?.omitted_chunks || 0} omitted file sections
              </p>
              {#each result.truncation?.files_without_text || [] as file}<p>
                  {file.name}: no extractable text
                </p>{/each}
              <p>{result.truncation?.note}</p>
            </details>{/if}
          {#if !result.results?.length}<p class="hint">
              The model returned no ranked document. That happens when every input was empty after
              truncation; check the query and the documents above.
            </p>{/if}
          <ol class="ranking">
            {#each result.results as item, rank}<li class:best={rank === 0}>
                <div class="match-heading">
                  <strong>{sourceLabel(item)}</strong><span class="similarity"
                    >{valueLabel(item.similarity)}</span
                  >
                </div>
                <p>{item.text || documents[item.index]}</p>
                <div
                  class="similarity-track"
                  role="meter"
                  aria-label={`Cosine similarity for ${sourceLabel(item)}`}
                  aria-valuemin="-1"
                  aria-valuemax="1"
                  aria-valuenow={item.similarity}
                >
                  <div style:width={width(item.similarity)}></div>
                </div>
                {#if item.similarity < 0}<span class="hint"
                    >Negative similarity: the two meanings point in different directions</span
                  >{/if}
              </li>{/each}
          </ol>
          <div class="matching-summary">
            <Icon name="check" size={16} /><span
              ><strong>Closest: {sourceLabel(best)}.</strong> Similarity is not a probability.</span
            >
          </div>
          <div class="vector-inspector">
            <div class="candidate-heading">
              <h3>Look inside the embedding</h3>
              <span>{dimensions} dimensions</span>
            </div>
            <div class="vector-tabs">
              <Button
                variant={selection === -1 ? "secondary" : "ghost"}
                size="sm"
                onclick={() => (selection = -1)}>Query vector</Button
              >{#each result.results as item}{#if item.vector}<Button
                    variant={selection === item.index ? "secondary" : "ghost"}
                    size="sm"
                    onclick={() => (selection = item.index)}>{sourceLabel(item)}</Button
                  >{/if}{/each}
            </div>
            {#if previewVector.length}<div
                class="vector-grid"
                role="img"
                aria-label={`First ${previewVector.length} actual embedding values. ${previewVector.map(valueLabel).join(", ")}`}
              >
                {#each previewVector as value, index}<div
                    title={`Dimension ${index + 1}: ${valueLabel(value)}`}
                    style:background={value >= 0
                      ? `rgba(124, 188, 158, ${0.14 + (Math.abs(value) / vectorScale) * 0.8})`
                      : `rgba(209, 149, 100, ${0.14 + (Math.abs(value) / vectorScale) * 0.8})`}
                  ></div>{/each}
              </div>
              <div class="vector-legend">
                <span><i class="negative"></i>Negative</span><span
                  >First {previewVector.length} actual values · stronger colour = larger magnitude</span
                ><span><i class="positive"></i>Positive</span>
              </div>
              <details>
                <summary>Read the numerical vector</summary>
                <pre>{JSON.stringify(vector, null, 2)}</pre>
              </details>{:else}<p class="hint">
                The service returned similarity scores without vector values.
              </p>{/if}
          </div>
          <details>
            <summary>Timing and model limits</summary>
            <p class="hint">
              HTTP: {roundtrip?.toFixed(1)} ms · server: {result.ms?.toFixed(1)} ms. English text · {status
                ?.limits?.max_tokens} tokens per section. Similarity ranks relevance; it does not verify
              facts.
            </p>
          </details>
        {:else}
          <div class="empty-state">
            <div class="empty-route" aria-hidden="true">
              <span>“money back”</span><Icon name="arrowUpRight" size={18} /><span>“refund”</span>
            </div>
            <p><strong>Different words can share a meaning.</strong></p>
            <p>
              Run the example to see which document is nearest to your query. The bars and vector
              colours use the model's actual output.
            </p>
          </div>
        {/if}
      </section>
    </div>
  </div>
</View>

<style>
  .embedding-page {
    width: 100%;
    max-width: 1340px;
    font-size: 13px;
    line-height: 1.6;
  }
  .flow {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr;
    gap: 18px;
    align-items: center;
    padding: 0 0 24px;
    border-bottom: 1px solid var(--color-line);
    margin-bottom: 24px;
  }
  .flow > div {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 10px;
    align-items: center;
    min-width: 0;
  }
  .flow > div > :global(svg) {
    grid-row: span 2;
    color: var(--color-ink-2);
  }
  .flow strong {
    font-size: 13px;
    font-weight: 500;
  }
  .flow span {
    font-size: 11px;
    color: var(--color-ink-2);
  }
  .flow > :global(svg) {
    color: var(--color-ink-3);
  }
  .flow .active strong {
    color: #a5dfbd;
  }
  .workbench {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    border: 1px solid var(--color-line);
    border-radius: 12px;
    overflow: hidden;
  }
  .input-side,
  .output-side {
    padding: 24px;
    min-width: 0;
  }
  .output-side {
    border-left: 1px solid var(--color-line);
    background: var(--color-panel);
  }
  h2 {
    font-size: 17px;
    font-weight: 600;
    line-height: 1.4;
    margin-bottom: 22px;
  }
  h3 {
    font-size: 13px;
    font-weight: 500;
  }
  label {
    display: block;
    font-size: 12px;
    color: var(--color-ink-2);
    margin: 18px 0 7px;
  }
  .candidate-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin: 24px 0 0;
  }
  .candidate-heading > span {
    font-size: 11px;
    color: var(--color-ink-2);
  }
  .document-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 12px;
    min-height: 30px;
  }
  .document-upload {
    margin-top: 24px;
    padding-top: 6px;
    border-top: 1px solid var(--color-line);
  }
  .document-upload label span {
    display: block;
    font-size: 11px;
    margin-top: 3px;
    color: var(--color-ink-2);
  }
  .document-upload input {
    width: 100%;
    max-width: 100%;
    font-size: 11px;
  }
  .document-upload input::file-selector-button {
    padding: 10px;
    margin-right: 8px;
    border: 1px solid var(--color-line);
    border-radius: 6px;
    background: var(--color-panel-2);
    color: var(--color-ink);
    cursor: pointer;
  }
  .attachment-list {
    margin-top: 12px;
    display: grid;
    gap: 10px;
  }
  .attachment-list > div {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
    min-width: 0;
  }
  .input-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 10px;
    margin-top: 20px;
  }
  .input-actions :global(button) {
    min-height: 44px;
  }
  .hint {
    font-size: 11px;
    color: var(--color-ink-2);
    margin-top: 12px;
  }
  .status {
    padding: 12px 14px;
    border: 1px solid var(--color-line);
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 12px;
  }
  .setup-note {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 18px;
    border: 1px solid var(--color-line);
    border-radius: 8px;
    margin-bottom: 20px;
  }
  .setup-note p {
    color: var(--color-ink-2);
    margin-top: 4px;
    font-size: 12px;
  }
  .install-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
  }
  .setup-note a {
    display: inline-block;
    text-decoration: underline;
    text-underline-offset: 3px;
    margin-top: 8px;
  }
  .result-meta {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 11px;
    color: var(--color-ink-2);
    margin-top: -12px;
    margin-bottom: 16px;
  }
  .truncation-note {
    margin: 8px 0 14px;
    font-size: 11px;
    color: var(--color-ink-2);
  }
  .ranking {
    list-style: none;
    padding: 0;
  }
  .ranking li {
    border-bottom: 1px solid var(--color-line);
    padding: 16px 0;
  }
  .ranking li:first-child {
    padding-top: 0;
  }
  .match-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 8px;
  }
  .match-heading strong {
    font-weight: 500;
    font-size: 13px;
  }
  .similarity {
    font-variant-numeric: tabular-nums;
    font-size: 15px;
    font-weight: 600;
  }
  .best .similarity {
    color: #a5dfbd;
  }
  .ranking p {
    font-size: 12px;
    line-height: 1.6;
    color: var(--color-ink-2);
    margin-bottom: 12px;
  }
  .similarity-track {
    height: 5px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--color-line);
  }
  .similarity-track > div {
    height: 100%;
    background: #88b29d;
  }
  .matching-summary {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    margin: 20px 0;
    font-size: 12px;
    color: var(--color-ink-2);
  }
  .matching-summary :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: #a5dfbd;
  }
  .matching-summary strong {
    color: var(--color-ink);
    font-weight: 500;
  }
  .vector-inspector {
    border-top: 1px solid var(--color-line);
    padding-top: 4px;
  }
  .vector-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 14px 0;
  }
  .vector-grid {
    display: grid;
    grid-template-columns: repeat(16, minmax(0, 1fr));
    gap: 3px;
  }
  .vector-grid > div {
    aspect-ratio: 1;
    border-radius: 2px;
  }
  .vector-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    font-size: 10px;
    color: var(--color-ink-2);
    margin-top: 10px;
  }
  .vector-legend span {
    display: flex;
    gap: 5px;
    align-items: center;
  }
  i {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  .negative {
    background: #d19564;
  }
  .positive {
    background: #7cbc9e;
  }
  details summary {
    cursor: pointer;
    min-height: 44px;
    padding: 13px 0;
    font-size: 12px;
    color: var(--color-ink-2);
  }
  pre {
    font-size: 11px;
    max-height: 240px;
    overflow: auto;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    min-height: 420px;
    gap: 14px;
    max-width: 48ch;
  }
  .empty-state p {
    color: var(--color-ink-2);
    font-size: 12px;
  }
  .empty-state strong {
    font-size: 14px;
    color: var(--color-ink);
    font-weight: 500;
  }
  .empty-route {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
    font-size: 16px;
    color: var(--color-ink);
    padding: 12px 0;
  }
  @media (max-width: 950px) {
    .workbench {
      grid-template-columns: 1fr;
    }
    .output-side {
      border-left: 0;
      border-top: 1px solid var(--color-line);
    }
    .empty-state {
      min-height: 240px;
    }
  }
  @media (max-width: 620px) {
    .flow {
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .flow > :global(svg) {
      display: none;
    }
    .input-side,
    .output-side {
      padding: 18px;
    }
    .vector-grid {
      gap: 2px;
    }
  }
</style>

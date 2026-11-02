<script lang="ts">
  import { headers, runtimeFetch } from "#lib/http.js";
  type Props = {
    file: { id: string; name: string; kind?: string; preview_url?: string };
    compact?: boolean;
  };
  let { file, compact = false }: Props = $props();
  let objectUrl = $state("");
  let error = $state("");
  $effect(() => {
    // Persisted/imported metadata must never choose a URL receiving our token.
    const path = `/api/attachments/file/${encodeURIComponent(file.id)}`;
    const abort = new AbortController();
    let url = "";
    let alive = true;
    objectUrl = "";
    error = "";
    runtimeFetch(path, { headers: headers(), signal: abort.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Attachment preview unavailable (HTTP ${response.status}).`);
        const blob = await response.blob();
        if (!alive) return;
        url = URL.createObjectURL(blob);
        objectUrl = url;
      })
      .catch((e) => {
        if (alive && e.name !== "AbortError") error = e.message;
      });
    return () => {
      alive = false;
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  });
</script>

<div class="attachment-preview" class:compact>
  {#if objectUrl}<a href={objectUrl} download={file.name} title={`Download ${file.name}`}
      >{#if file.kind === "image"}<img src={objectUrl} alt={file.name} />{/if}<span
        >{file.name}</span
      ></a
    >{:else}<span>{file.name}</span><small>{error || "Loading local preview…"}</small>{/if}
</div>

<style>
  .attachment-preview {
    min-width: 0;
  }
  .attachment-preview a {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    text-decoration: underline;
    overflow-wrap: anywhere;
  }
  .attachment-preview img {
    width: 60px;
    height: 60px;
    object-fit: cover;
    border-radius: var(--radius-card);
  }
  .attachment-preview.compact img {
    width: 44px;
    height: 44px;
  }
  .attachment-preview small {
    display: block;
    font-size: 10px;
    color: var(--color-ink-2);
    margin-top: 3px;
  }
  .attachment-preview.compact a {
    font-size: 11px;
  }
</style>

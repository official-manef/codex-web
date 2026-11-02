<script lang="ts">
  import { parseMarkdown, type Inline, type MarkdownBlock } from "#lib/markdown.js";
  let { text }: { text: string } = $props();
  const content = $derived(parseMarkdown(text));
</script>

{#snippet inline(nodes: Inline[])}
  {#each nodes as node}
    {#if node.type === "text"}{node.text}{:else if node.type === "code"}<code>{node.text}</code
      >{:else if node.type === "strong"}<strong>{@render inline(node.children)}</strong
      >{:else if node.type === "emphasis"}<em>{@render inline(node.children)}</em
      >{:else if node.type === "link"}<a href={node.href} target="_blank" rel="noopener noreferrer"
        >{@render inline(node.children)}</a
      >{/if}
  {/each}
{/snippet}

{#snippet blockContent(nodes: MarkdownBlock[])}
  {#each nodes as node}
    {#if node.type === "paragraph"}<p>
        {@render inline(node.children)}
      </p>{:else if node.type === "heading"}<svelte:element this={`h${node.level}`}
        >{@render inline(node.children)}</svelte:element
      >{:else if node.type === "code"}<pre
        aria-label={node.language ? `${node.language} code` : "Code"}><code>{node.text}</code
        ></pre>{:else if node.type === "quote"}<blockquote>
        {@render blockContent(node.children)}
      </blockquote>{:else if node.type === "list"}
      {#if node.ordered}<ol start={node.start}>
          {#each node.items as item}<li>{@render blockContent(item)}</li>{/each}
        </ol>{:else}<ul>
          {#each node.items as item}<li>{@render blockContent(item)}</li>{/each}
        </ul>{/if}
    {:else if node.type === "rule"}<hr />{/if}
  {/each}
{/snippet}

<div class="rich-text">{@render blockContent(content)}</div>

<style>
  .rich-text {
    min-width: 0;
    overflow-wrap: anywhere;
    white-space: normal;
    line-height: 1.7;
  }
  .rich-text :global(p) {
    margin: 0 0 0.8em;
    text-wrap: pretty;
  }
  .rich-text :global(:last-child) {
    margin-bottom: 0;
  }
  .rich-text :global(strong) {
    font-weight: 650;
    color: var(--color-ink);
  }
  .rich-text :global(h1),
  .rich-text :global(h2),
  .rich-text :global(h3),
  .rich-text :global(h4),
  .rich-text :global(h5),
  .rich-text :global(h6) {
    margin: 1.25em 0 0.5em;
    font-weight: 650;
    line-height: 1.4;
    text-wrap: balance;
  }
  .rich-text :global(h1) {
    font-size: 1.35em;
  }
  .rich-text :global(h2) {
    font-size: 1.2em;
  }
  .rich-text :global(h3),
  .rich-text :global(h4),
  .rich-text :global(h5),
  .rich-text :global(h6) {
    font-size: 1.05em;
  }
  .rich-text :global(:first-child) {
    margin-top: 0;
  }
  .rich-text :global(ul),
  .rich-text :global(ol) {
    margin: 0.75em 0;
    padding-inline-start: 1.5em;
  }
  .rich-text :global(ul) {
    list-style-type: disc;
  }
  .rich-text :global(ol) {
    list-style-type: decimal;
  }
  .rich-text :global(li) {
    margin: 0.3em 0;
    padding-inline-start: 0.15em;
  }
  .rich-text :global(li > p) {
    margin-bottom: 0.35em;
  }
  .rich-text :global(blockquote) {
    margin: 0.8em 0;
    border-inline-start: 1px solid var(--color-line);
    padding-inline-start: 1em;
    color: var(--color-ink-2);
  }
  .rich-text :global(code) {
    border-radius: 4px;
    padding: 0.12em 0.35em;
    background: var(--color-panel-2);
    font-family: var(--font-mono, monospace);
    font-size: 0.9em;
  }
  .rich-text :global(pre) {
    max-width: 100%;
    margin: 0.85em 0;
    overflow-x: auto;
    border: 1px solid var(--color-line);
    border-radius: var(--radius-card);
    padding: 14px 16px;
    background: var(--color-panel);
    white-space: pre;
    line-height: 1.6;
  }
  .rich-text :global(pre code) {
    border-radius: 0;
    padding: 0;
    background: transparent;
    white-space: pre;
    overflow-wrap: normal;
  }
  .rich-text :global(a) {
    color: var(--color-ink);
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: var(--color-ink-3);
  }
  .rich-text :global(a:hover) {
    text-decoration-color: currentColor;
  }
  .rich-text :global(a:focus-visible) {
    outline: 2px solid var(--color-ink-2);
    outline-offset: 3px;
  }
  .rich-text :global(hr) {
    margin: 1em 0;
    border: 0;
    border-top: 1px solid var(--color-line);
  }
</style>

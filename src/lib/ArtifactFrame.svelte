<script lang="ts">
	import { artifactRejection } from './artifact.js';

	type Props = {
		html: string;
		title?: string;
		height?: number;
	};

	let { html, title, height = 420 }: Props = $props();

	let rejection = $derived(artifactRejection(html));
</script>

{#if rejection}
	<p role="status" class="artifact-status">{rejection}</p>
{:else}
	<!--
		Rendered with an empty sandbox token list: sandbox="".
		This disables scripts, prevents form submission, blocks popups,
		and denies same-origin access.
		A stricter-but-still-useful alternative (sandbox="allow-same-origin")
		is deliberately NOT used because it would let the frame read cookies.
	-->
	<iframe
		sandbox=""
		srcdoc={html}
		title={title ?? 'Artifact'}
		referrerpolicy="no-referrer"
		loading="lazy"
		{height}
		style:height="{height}px"
		class="artifact-frame"
	></iframe>
{/if}

<style>
	.artifact-frame {
		width: 100%;
		border: 0;
		display: block;
		contain: content;
	}

	.artifact-status {
		margin: 0;
		padding: 0.75rem 1rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-ink-2, #6b7280);
		background-color: var(--color-panel-2, rgba(0, 0, 0, 0.03));
		border-radius: 0.375rem;
	}
</style>

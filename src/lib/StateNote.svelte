<script lang="ts">
	/**
	 * One anatomy for every state a screen can be in when it has nothing to show.
	 *
	 * Four slots, always in this order and always present:
	 *   1. `title`  what is missing or unavailable, as a noun phrase. Not an apology.
	 *   2. `detail` why, and what the reader would see if it were there.
	 *   3. `fix`    who can change it: the reader, a server operator, another build, or nobody.
	 *   4. `action` at most one control, and only when it helps.
	 *
	 * See `docs/empty-states-2026-11-02.md` for the rules this encodes.
	 */
	type State = 'loading' | 'empty' | 'degraded' | 'error';
	type Fix = 'you' | 'operator' | 'build' | 'none';

	let {
		state,
		title,
		detail,
		fix,
		action
	}: {
		state: State;
		title: string;
		detail: string;
		fix: Fix;
		action?: { label: string; href: string } | { label: string; onclick: () => void };
	} = $props();

	const FIX: Record<Fix, string> = {
		you: 'You can change this on this screen.',
		operator: 'A server operator can change this; nothing here can.',
		build: 'This build has no runtime for it. The desktop app is the build that does.',
		none: 'Nothing you can do here changes it.'
	};
</script>

<div class="state-note" data-state={state} role={state === 'error' ? 'alert' : 'status'}>
	<p class="state-note-title">{title}</p>
	<p class="state-note-detail">{detail}</p>
	<p class="state-note-fix">{FIX[fix]}</p>
	{#if action}
		{#if 'href' in action}
			<!-- A hash fragment on the current route: there is no route to resolve, and
			     `resolve()` takes a path, not a fragment. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a class="btn state-note-action" href={action.href}>{action.label}</a>
		{:else}
			<button type="button" class="btn state-note-action" onclick={action.onclick}>
				{action.label}
			</button>
		{/if}
	{/if}
</div>

<style>
	.state-note {
		max-width: 72ch;
		margin: 12px 0;
		padding: 12px 14px;
		border: 1px solid var(--color-line);
		border-left-width: 3px;
		border-radius: 8px;
		background: var(--color-panel);
		font-size: 12.5px;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.state-note[data-state='error'] {
		border-left-color: var(--color-error, #e78585);
	}
	.state-note[data-state='loading'] {
		border-left-color: var(--color-line);
	}
	.state-note-title {
		margin: 0;
		font-weight: 600;
		color: var(--color-ink);
	}
	.state-note-detail {
		margin: 4px 0 0;
		color: var(--color-ink-2);
	}
	.state-note-fix {
		margin: 4px 0 0;
		color: var(--color-ink-3);
	}
	.state-note-action {
		margin-top: 9px;
	}
</style>

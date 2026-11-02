<script lang="ts">
	import { useAction, useMutation, useQuery } from 'convex-svelte';
	import { env } from '$env/dynamic/public';
	import { api } from '../../../src/convex/_generated/api';
	import { safeDocsLink } from '../state/docs_link';

	/**
	 * Provider connection manager.
	 *
	 * BYOK contract (docs/byok.md):
	 *  - the key is entered here and posted once to the `credentials.connect` action;
	 *  - the action encrypts it server-side; the browser never sees it again;
	 *  - a custom endpoint requires HTTPS and is the only way to point a key at a non-registry host;
	 *  - every provider row shows where to get its key, because a bare secret field is not a flow.
	 */
	type CatalogEntry = { slug: string; protocol: string; docsUrl: string };
	type Connected = {
		provider: string;
		kind: string;
		label?: string;
		endpoint?: string;
		protocol?: string;
		models?: string[];
		updatedAt: number;
	};

	let { signedIn = false }: { signedIn?: boolean } = $props();

	// Calling these hooks without a deployment throws: the Convex client context is only set
	// up when PUBLIC_CONVEX_URL exists. Keep every call behind that check.
	const cloudUrl = env.PUBLIC_CONVEX_URL;
	const catalog = cloudUrl ? useAction(api.chat.providers) : null;
	const connected = cloudUrl
		? useQuery(api.credentials.listProviders, () => (signedIn ? {} : 'skip'))
		: null;
	const connect = cloudUrl ? useAction(api.credentials.connect) : null;
	const disconnect = cloudUrl ? useMutation(api.credentials.disconnect) : null;

	let providers = $state<CatalogEntry[]>([]);
	// Signed-in screens start in the loading state: the effect that fetches the catalogue runs
	// right after mount, and an empty `<select>` before it would look like an empty registry.
	let catalogLoading = $state(true);
	let catalogError = $state('');
	let busy = $state<string | null>(null);
	let message = $state('');
	let error = $state('');

	let selected = $state('openrouter');
	// A custom endpoint needs its own slug: binding the Slug field to `selected` would end the
	// custom branch on the first keystroke.
	let customSlug = $state('');
	let apiKey = $state('');
	let customName = $state('');
	let customEndpoint = $state('');
	let customModels = $state('');
	let customProtocol = $state<'openai' | 'anthropic'>('openai');

	const connectedRows = $derived<Connected[]>((connected?.data ?? []) as Connected[]);
	const connectedLoading = $derived(connected?.isLoading ?? false);
	const connectedError = $derived(connected?.error ?? null);
	const connectedMap = $derived(new Map(connectedRows.map((row) => [row.provider, row])));
	const current = $derived(providers.find((entry) => entry.slug === selected));
	const docsHref = $derived(safeDocsLink(current?.docsUrl));

	/**
	 * A connected row's key page: only a registry slug has one. A custom endpoint carries its own
	 * `endpoint`, so it never gets a provider key link.
	 */
	function keyPage(row: Connected): string | null {
		if (row.endpoint) return null;
		return safeDocsLink(providers.find((entry) => entry.slug === row.provider)?.docsUrl);
	}

	async function loadCatalog(): Promise<void> {
		if (!catalog) return;
		catalogLoading = true;
		catalogError = '';
		try {
			const rows = await catalog({});
			providers = rows as CatalogEntry[];
		} catch (cause) {
			// The real server message, not a generic "failed" line: an unauthenticated or
			// unconfigured deployment says something the user can act on.
			catalogError =
				cause instanceof Error && cause.message
					? cause.message
					: 'Could not load the provider list.';
		} finally {
			catalogLoading = false;
		}
	}

	$effect(() => {
		if (!cloudUrl || !signedIn || !catalog) return;
		loadCatalog().catch(() => (catalogError = 'Could not load the provider list.'));
	});

	function reset() {
		apiKey = '';
		customSlug = '';
		customName = '';
		customEndpoint = '';
		customModels = '';
		error = '';
	}

	async function submitKey() {
		if (!signedIn || busy) return;
		if (!connect) {
			error = 'Cloud mode is not configured, so there is nowhere to store a key.';
			return;
		}
		const provider = (selected === 'custom' ? customSlug : selected).trim();
		if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider)) {
			error = 'Provider slugs are lowercase letters, digits and dashes.';
			return;
		}
		if (!apiKey.trim()) {
			error = 'Paste the key you created in the provider dashboard.';
			return;
		}
		busy = provider;
		error = '';
		message = '';
		try {
			const custom = customEndpoint.trim();
			await connect({
				provider,
				apiKey,
				label: customName.trim() || undefined,
				endpoint: custom || undefined,
				protocol: custom ? customProtocol : undefined,
				models: custom
					? customModels
							.split(',')
							.map((item) => item.trim())
							.filter(Boolean)
							.slice(0, 100)
					: undefined
			});
			message = `${provider} connected. The key is encrypted and was never stored in this browser.`;
			reset();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not save the key.';
		} finally {
			busy = null;
		}
	}

	async function remove(provider: string) {
		if (busy) return;
		if (!disconnect) {
			error = 'Cloud mode is not configured, so there is nothing to disconnect.';
			return;
		}
		busy = provider;
		error = '';
		try {
			await disconnect({ provider });
			message = `${provider} disconnected.`;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not disconnect.';
		} finally {
			busy = null;
		}
	}
</script>

<section class="providers" aria-labelledby="providers-heading">
	<h2 id="providers-heading">Providers</h2>

	{#if !cloudUrl}
		<p class="providers-note" role="status">
			Cloud mode is not configured. Set <code>PUBLIC_CONVEX_URL</code> to your own Convex deployment to
			store provider keys; this build has no key storage, so Model keys has nothing to save. Local and
			device engines keep working without an account.
		</p>
	{:else if !signedIn}
		<p class="providers-note" role="status">
			Sign in to connect a provider key. The key is encrypted server-side under your Convex
			identity, so a session is required; local and device engines keep working without an account.
		</p>
	{:else}
		<div class="providers-grid">
			<form
				class="providers-form"
				onsubmit={(event) => {
					event.preventDefault();
					submitKey().catch(() => (error = 'Could not save the key.'));
				}}
			>
				{#if catalogLoading}
					<p class="providers-note" role="status">Loading provider catalogue…</p>
				{:else if catalogError}
					<p class="providers-error" role="alert">{catalogError}</p>
				{:else if providers.length === 0}
					<p class="providers-note" role="status">
						The deployment returned no built-in providers. A custom endpoint is still available
						below.
					</p>
				{/if}

				<label class="providers-field">
					<span>Provider</span>
					<select bind:value={selected}>
						{#each providers as entry (entry.slug)}
							<option value={entry.slug}>{entry.slug}</option>
						{/each}
						<option value="custom">Custom endpoint…</option>
					</select>
				</label>

				{#if selected === 'custom'}
					<p class="providers-help">
						A custom endpoint has no registry key page; the key comes from that endpoint's own
						operator.
					</p>
				{:else if current?.docsUrl}
					<p class="providers-help">
						Create a key on the provider's page, then paste it here. The provider shows it once, and
						it cannot be read back after it is saved.
					</p>
					{#if docsHref}
						<!-- An external provider page, not an app route: `rel="external"` marks it for SvelteKit. -->
						<a
							class="providers-docs"
							href={docsHref}
							target="_blank"
							rel="external noopener noreferrer">Open the {current.slug} key page</a
						>
						<code class="providers-docs-url">{current.docsUrl}</code>
					{:else}
						<code class="providers-docs-url">{current.docsUrl}</code>
					{/if}
				{/if}

				<label class="providers-field">
					<span>API key</span>
					<input
						type="password"
						bind:value={apiKey}
						autocomplete="off"
						spellcheck="false"
						placeholder="sk-…"
					/>
				</label>

				{#if selected === 'custom'}
					<label class="providers-field">
						<span>Slug</span>
						<input bind:value={customSlug} placeholder="my-endpoint" pattern="[a-z0-9-]+" />
					</label>
					<label class="providers-field">
						<span>Base URL</span>
						<input bind:value={customEndpoint} placeholder="https://…/v1" />
					</label>
					<label class="providers-field">
						<span>Protocol</span>
						<select bind:value={customProtocol}>
							<option value="openai">OpenAI chat/completions</option>
							<option value="anthropic">Anthropic messages</option>
						</select>
					</label>
					<label class="providers-field">
						<span>Model ids</span>
						<input bind:value={customModels} placeholder="model-a, model-b" />
					</label>
				{/if}

				<div class="providers-actions">
					<button type="submit" disabled={busy !== null}>
						{busy === selected ? 'Saving…' : 'Connect provider'}
					</button>
					<button
						type="button"
						disabled={busy !== null}
						onclick={() => submitKey().catch(() => (error = 'Could not save the key.'))}
					>
						Test connection
					</button>
				</div>

				{#if error}<p class="providers-error" role="alert">{error}</p>{/if}
				{#if message}<p class="providers-ok" role="status">{message}</p>{/if}
			</form>

			<div class="providers-list">
				<h3>Connected</h3>
				{#if connectedError}
					<p class="providers-error" role="alert">
						Could not read your connections: {connectedError.message}
					</p>
				{:else if connectedLoading}
					<p class="providers-note" role="status">Checking your connections…</p>
				{:else if connectedRows.length === 0}
					<p class="providers-note">No provider connected yet.</p>
				{:else}
					<ul>
						{#each connectedRows as row (row.provider)}
							{@const entry = connectedMap.get(row.provider)}
							{@const href = keyPage(row)}
							<li>
								<span class="providers-row">
									<strong>{row.provider}</strong>
									<small>{entry?.endpoint ?? 'built-in endpoint'}</small>
								</span>
								{#if href}
									<a
										class="providers-docs"
										{href}
										target="_blank"
										rel="external noopener noreferrer"
										aria-label={`Get an API key for ${row.provider}`}>Get API key</a
									>
								{/if}
								<button
									type="button"
									disabled={busy !== null}
									aria-label={`Disconnect ${row.provider}`}
									onclick={() =>
										remove(row.provider).catch(() => (error = 'Could not disconnect.'))}
									>Disconnect</button
								>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}
</section>

<style>
	.providers {
		padding: 24px;
	}
	.providers h2 {
		margin: 0 0 16px;
		font-size: 18px;
		font-weight: 600;
	}
	.providers-grid {
		display: grid;
		gap: 24px;
		grid-template-columns: minmax(0, 1fr);
	}
	@media (min-width: 60rem) {
		.providers-grid {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
	.providers-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.providers-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
	}
	.providers-field span {
		color: var(--color-ink-2);
	}
	.providers-field input,
	.providers-field select {
		border: 1px solid var(--color-line);
		border-radius: var(--radius-card);
		background: var(--color-panel-2);
		padding: 7px 10px;
		font: inherit;
		font-size: 13px;
		color: var(--color-ink);
	}
	.providers-help,
	.providers-note {
		margin: 0;
		font-size: 12px;
		line-height: 1.6;
		color: var(--color-ink-2);
	}
	.providers-docs {
		font-size: 12px;
		color: var(--color-ink);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.providers-docs-url {
		display: block;
		overflow-wrap: anywhere;
		font-size: 11px;
		color: var(--color-ink-3);
	}
	.providers-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.providers-actions button,
	.providers-list button {
		border: 1px solid var(--color-line);
		border-radius: var(--radius-card);
		padding: 6px 12px;
		font-size: 12px;
		color: var(--color-ink);
	}
	.providers-actions button:hover:not(:disabled),
	.providers-list button:hover:not(:disabled) {
		background: var(--color-hover);
	}
	.providers-actions button:disabled,
	.providers-list button:disabled {
		opacity: 0.4;
	}
	.providers-error {
		margin: 0;
		font-size: 12px;
		color: var(--color-approval);
	}
	.providers-ok {
		margin: 0;
		font-size: 12px;
		color: var(--color-ink-2);
	}
	.providers-list h3 {
		margin: 0 0 10px;
		font-size: 13px;
		font-weight: 600;
	}
	.providers-list ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.providers-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		border: 1px solid var(--color-line);
		border-radius: 8px;
		padding: 8px 12px;
	}
	.providers-row {
		display: flex;
		min-width: 0;
		flex-direction: column;
	}
	.providers-row strong {
		font-size: 13px;
	}
	.providers-row small {
		font-size: 11px;
		color: var(--color-ink-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>

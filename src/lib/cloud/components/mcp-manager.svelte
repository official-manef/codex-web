<script lang="ts">
	import { useAuth } from 'convex-svelte';
	import { engineAvailability } from '$features/cloud';
	import { env } from '$env/dynamic/public';
	import { page } from '$app/state';
	import { authCopy } from '$lib/auth_state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import {
		callMcp,
		cloudMcpAvailable,
		connectMcp,
		disconnectMcp,
		discoverMcp,
		listMcpConnections,
		prepareMcpCall,
		setMcpEnabled,
		type ApprovalPreview,
		type McpAuth,
		type McpConnection
	} from '$lib/cloud/mcp';

	/**
	 * Per-user MCP servers (BYOK), mounted under Tools.
	 *
	 * The browser posts the credential once to `mcp.connect`, which encrypts it under
	 * `MODELS_ENC_KEY`; everything after that works from an alias. Discovery and every call are
	 * checked against the stored allowlist server-side. The confirmation below shows the exact
	 * snapshot a one-shot approval carries, and the token is redeemable once, for 120 seconds.
	 * single-use, not a promise of exactly-once delivery.
	 */
	const cloudUrl = env.PUBLIC_CONVEX_URL;
	const auth = cloudUrl ? useAuth() : null;
	const uid = $props.id();

	// MCP needs no model key, so the only credential precondition here is the master key's
	// presence, which `cloudMcpAvailable()` already proves. Signed-in is still required.
	const availability = $derived(
		engineAvailability({
			hasDevice: false,
			hasCredential: cloudMcpAvailable(),
			signedIn: auth?.isAuthenticated === true
		})
	);
	const authState = $derived(
		authCopy({
			configured: page.data.auth?.enabled === true,
			signedIn: auth?.isAuthenticated === true,
			isLoading: auth?.isLoading === true
		})
	);
	const cloudReason = $derived(
		!cloudUrl
			? 'Cloud mode is not configured. Set PUBLIC_CONVEX_URL to your own Convex deployment to connect a server; this build has no per-user MCP.'
			: !cloudMcpAvailable()
				? 'Cloud mode did not finish starting, so MCP servers cannot be managed in this tab yet.'
				: authState.tone === 'unavailable'
					? `${authState.title}. ${authState.detail}`
					: authState.tone === 'ready' && authState.title
						? authState.title
						: 'Sign in to connect your own MCP server. Local mode and the operator-configured servers keep working without an account.'
	);
	type Found = { reachable: boolean; error: string | null; tools: string[] };

	let rows = $state<McpConnection[]>([]);
	let loading = $state(false);
	let busy = $state<string | null>(null);
	let error = $state('');
	let message = $state('');

	let alias = $state('');
	let url = $state('');
	let authMode = $state<McpAuth>('bearer');
	let secret = $state('');
	let toolList = $state('');
	let label = $state('');

	let found = $state<Record<string, Found>>({});
	let confirming = $state<string | null>(null);
	let selectedTool = $state<Record<string, string>>({});
	let callArgs = $state<Record<string, string>>({});
	let preview = $state<ApprovalPreview | null>(null);
	let result = $state<{ alias: string; content: string; isError: boolean } | null>(null);

	const toolsParsed = $derived(
		toolList
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	);

	async function reload(): Promise<void> {
		if (!availability.cloud) return;
		loading = true;
		const listed = await listMcpConnections();
		loading = false;
		if (listed.ok) rows = listed.connections;
		else error = listed.message;
	}

	// Rows are only readable once signed in; re-read when that flips.
	$effect(() => {
		if (!availability.cloud) return;
		reload().catch((cause: unknown) => {
			error = cause instanceof Error ? cause.message : 'Could not read your MCP servers.';
		});
	});

	async function connect(): Promise<void> {
		if (busy) return;
		busy = 'connect';
		error = '';
		message = '';
		try {
			const created = await connectMcp({
				alias: alias.trim(),
				url: url.trim(),
				auth: authMode,
				secret,
				tools: toolsParsed,
				label: label.trim() || undefined
			});
			if (!created.ok) {
				error = created.message;
				return;
			}
			message = `${created.connection.alias} connected. The credential is encrypted and was never stored in this browser.`;
			alias = '';
			url = '';
			label = '';
			toolList = '';
			await reload();
		} finally {
			// Cleared on success and on failure: the value is never kept for a retry.
			secret = '';
			busy = null;
		}
	}

	async function toggle(row: McpConnection, enabled: boolean): Promise<void> {
		busy = row.alias;
		error = '';
		try {
			const updated = await setMcpEnabled(row.alias, enabled);
			if (!updated.ok) error = updated.message;
			else await reload();
		} finally {
			busy = null;
		}
	}

	async function disconnect(row: McpConnection): Promise<void> {
		if (confirming !== row.alias) {
			confirming = row.alias;
			return;
		}
		confirming = null;
		busy = row.alias;
		error = '';
		try {
			const removed = await disconnectMcp(row.alias);
			if (!removed.ok) error = removed.message;
			else {
				message = `${row.alias} disconnected. Its stored credential was deleted.`;
				delete found[row.alias];
				await reload();
			}
		} finally {
			busy = null;
		}
	}

	async function discover(row: McpConnection): Promise<void> {
		busy = row.alias;
		error = '';
		result = null;
		try {
			const listed = await discoverMcp(row.alias);
			if (!listed.ok) error = listed.message;
			else
				found[row.alias] = {
					reachable: listed.reachable,
					error: listed.error,
					tools: listed.tools
				};
		} finally {
			busy = null;
		}
	}

	async function review(row: McpConnection): Promise<void> {
		const tool = selectedTool[row.alias];
		if (!tool) {
			error = 'Discover the server and pick one of its tools first.';
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(callArgs[row.alias] ?? '{}');
		} catch {
			error = 'The arguments must be a JSON object.';
			return;
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			error = 'The arguments must be a JSON object.';
			return;
		}
		busy = row.alias;
		error = '';
		result = null;
		try {
			const prepared = await prepareMcpCall(row.alias, tool, parsed as Record<string, unknown>);
			if (!prepared.ok) error = prepared.message;
			else preview = prepared.approval;
		} finally {
			busy = null;
		}
	}

	async function execute(): Promise<void> {
		if (!preview) return;
		const snapshot = preview;
		// The token is consumed by the action whether or not the call succeeds.
		preview = null;
		busy = snapshot.alias;
		error = '';
		try {
			const called = await callMcp(snapshot.token);
			if (!called.ok) error = called.message;
			else result = { alias: snapshot.alias, content: called.content, isError: called.isError };
		} finally {
			busy = null;
		}
	}

	function host(value: string): string {
		try {
			return new URL(value).host;
		} catch {
			return value;
		}
	}
</script>

<section class="mb-6" aria-labelledby={`${uid}-heading`}>
	<h2 id={`${uid}-heading`} class="mb-2 text-[13px] font-semibold">MCP servers</h2>

	{#if !availability.cloud}
		<p class="text-[12.5px] leading-relaxed text-ink-2" role="status">{cloudReason}</p>
	{:else}
		<p class="mb-3 max-w-[70ch] text-[11.5px] leading-relaxed text-ink-3">
			Your own server, your own credential. It is encrypted at rest, posted once from this form, and
			never read back. Only the tools you list below are reachable, and nothing runs without the
			confirmation step.
		</p>

		<div class="card mb-4 flex flex-col gap-3 px-4 py-4">
			<div class="grid gap-3 sm:grid-cols-2">
				<label class="flex flex-col gap-1 text-[12.5px]">
					<span class="font-medium">Alias</span>
					<Input bind:value={alias} placeholder="approved-service" maxlength={40} />
				</label>
				<label class="flex flex-col gap-1 text-[12.5px]">
					<span class="font-medium">Endpoint</span>
					<Input bind:value={url} placeholder="https://mcp.example.com/mcp" />
				</label>
				<label class="flex flex-col gap-1 text-[12.5px]">
					<span class="font-medium">Auth header</span>
					<select
						class="h-8 rounded-lg border border-border bg-background px-2 text-[12.5px]"
						bind:value={authMode}
					>
						<option value="bearer">bearer</option>
						<option value="x-api-key">x-api-key</option>
					</select>
				</label>
				<label class="flex flex-col gap-1 text-[12.5px]">
					<span class="font-medium">Label (optional)</span>
					<Input bind:value={label} placeholder="Work notes server" maxlength={80} />
				</label>
			</div>
			<label class="flex flex-col gap-1 text-[12.5px]">
				<span class="font-medium">Credential</span>
				<Input type="password" bind:value={secret} autocomplete="off" spellcheck="false" />
				<span class="text-[11px] leading-relaxed text-ink-3">
					Sent once to the connect action, encrypted server-side, and cleared from this field after
					the attempt.
				</span>
			</label>
			<label class="flex flex-col gap-1 text-[12.5px]">
				<span class="font-medium">Tool allowlist (one name per line, max 128)</span>
				<Textarea
					bind:value={toolList}
					rows={4}
					spellcheck="false"
					placeholder="read_file&#10;list_notes"
				/>
				<span class="text-[11px] leading-relaxed text-ink-3">
					{toolsParsed.length}/128 listed. Anything not named here stays invisible to this app.
				</span>
			</label>
			<div class="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					disabled={busy === 'connect'}
					onclick={() => connect().catch(() => (error = 'Could not connect that MCP server.'))}
				>
					Connect
				</Button>
				<span class="text-[11px] text-ink-3">Up to 16 servers per account.</span>
			</div>
		</div>

		{#if error}<p class="mb-2 text-[12px] text-red-400" role="alert">{error}</p>{/if}
		{#if message}<p class="mb-2 text-[12px] text-ink-2" role="status">{message}</p>{/if}

		{#if loading}
			<p class="text-[12.5px] text-ink-3">Loading connected servers…</p>
		{:else if rows.length === 0}
			<p class="text-[12.5px] leading-relaxed text-ink-2">
				No server connected yet. This panel is separate from the operator-configured servers in
				server environment; those stay available unchanged.
			</p>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each rows as row (row.alias)}
					<li class="card flex min-w-0 flex-col gap-2 px-4 py-3">
						<div class="flex min-w-0 flex-wrap items-center gap-3">
							<div class="min-w-0 flex-1">
								<p class="truncate text-[12.5px] font-medium">
									{row.label ?? row.alias}
									<span class="text-ink-3">· {host(row.url)}</span>
								</p>
								<p class="mt-0.5 text-[11px] leading-relaxed text-ink-3">
									{row.auth} · {row.tools.length} allowed tool{row.tools.length === 1 ? '' : 's'} · updated
									{new Date(row.updatedAt).toLocaleString()}
								</p>
							</div>
							<label class="flex items-center gap-2 text-[11.5px] text-ink-2">
								<Switch
									size="sm"
									checked={row.enabled}
									disabled={busy === row.alias}
									aria-label={`Enable ${row.alias}`}
									onCheckedChange={(value) =>
										toggle(row, value).catch(() => (error = 'Could not change that switch.'))}
								/>
								{row.enabled ? 'Enabled' : 'Off'}
							</label>
						</div>

						<div class="flex flex-wrap items-center gap-2">
							<Button
								size="sm"
								variant="outline"
								disabled={busy === row.alias || !row.enabled}
								onclick={() => discover(row).catch(() => (error = 'Could not reach that server.'))}
							>
								Discover
							</Button>
							<Button
								size="sm"
								variant={confirming === row.alias ? 'destructive' : 'outline'}
								disabled={busy === row.alias}
								onclick={() => disconnect(row).catch(() => (error = 'Could not disconnect.'))}
							>
								{confirming === row.alias ? 'Confirm disconnect' : 'Disconnect'}
							</Button>
							{#if confirming === row.alias}
								<span class="text-[11px] text-ink-3">
									Deletes the row and its encrypted credential. Nothing else changes.
								</span>
							{/if}
						</div>

						{#if found[row.alias]}
							{@const info = found[row.alias]}
							{#if !info.reachable}
								<p class="text-[11.5px] text-red-400" role="alert">
									Could not reach {row.alias}: {info.error ?? 'no reason reported'}.
								</p>
							{:else if info.tools.length === 0}
								<p class="text-[11.5px] leading-relaxed text-ink-3">
									Reachable, but it advertises none of the {row.tools.length} allowed tool{row.tools
										.length === 1
										? ''
										: 's'}. Check the allowlist or the server's own configuration.
								</p>
							{:else}
								<div class="flex flex-col gap-2">
									<p class="text-[11.5px] text-ink-3">
										Reachable. These allowed tools are advertised right now:
									</p>
									<ul class="flex flex-wrap gap-1.5">
										{#each info.tools as tool (tool)}
											<li class="rounded border border-border px-2 py-0.5 text-[11px]">{tool}</li>
										{/each}
									</ul>
									<div class="grid gap-2 sm:grid-cols-2">
										<label class="flex flex-col gap-1 text-[12px]">
											<span class="text-ink-2">Tool</span>
											<select
												class="h-8 rounded-lg border border-border bg-background px-2 text-[12.5px]"
												bind:value={selectedTool[row.alias]}
											>
												<option value="">Choose a tool…</option>
												{#each info.tools as tool (tool)}
													<option value={tool}>{tool}</option>
												{/each}
											</select>
										</label>
										<label class="flex flex-col gap-1 text-[12px]">
											<span class="text-ink-2">Arguments (JSON object)</span>
											<Textarea
												rows={3}
												spellcheck="false"
												value={callArgs[row.alias] ?? '{}'}
												oninput={(event) => (callArgs[row.alias] = event.currentTarget.value)}
											/>
										</label>
									</div>
									<div>
										<Button
											size="sm"
											disabled={busy === row.alias}
											onclick={() =>
												review(row).catch(() => (error = 'Could not prepare that call.'))}
										>
											Review call
										</Button>
									</div>
								</div>
							{/if}
						{/if}

						{#if preview?.alias === row.alias}
							<div class="flex flex-col gap-2 rounded-lg border border-border px-3 py-3">
								<p class="text-[11.5px] font-medium">This will call exactly this, once:</p>
								<p class="text-[11.5px] text-ink-2">
									Server <code>{preview.alias}</code> · tool <code>{preview.tool}</code>
								</p>
								<code class="rounded bg-muted px-2 py-1 text-[11.5px] break-all"
									>{preview.arguments}</code
								>
								<p class="text-[11px] leading-relaxed text-ink-3">
									The approval is single-use and expires 120 seconds after it was prepared. It is
									not an exactly-once guarantee: a failed or cancelled call may still have run
									remotely, so inspect the external state before trying again.
								</p>
								<Button
									size="sm"
									disabled={busy === row.alias}
									onclick={() => execute().catch(() => (error = 'The remote tool call failed.'))}
								>
									Confirm and execute once
								</Button>
							</div>
						{/if}

						{#if result?.alias === row.alias}
							<div class="rounded-lg border border-border px-3 py-2">
								<p class="mb-1 text-[11px] font-medium">
									{result.isError ? 'The server reported an error for this call' : 'Result'}
								</p>
								<pre
									class="max-h-64 overflow-auto text-[11.5px] break-words whitespace-pre-wrap">{result.content ||
										'(empty result)'}</pre>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

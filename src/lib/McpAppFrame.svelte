<script lang="ts">
	import { framePolicy, hostMessage, parseGuestMessage } from './mcp_app_host';

	type Props = {
		appId: string;
		src: string; // https origin only
		height?: number; // default 420, clamped 40–2000
		allowed?: boolean;
		onCall?: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
	};

	let { appId, src, height = 420, allowed = true, onCall }: Props = $props();

	let iframeEl = $state<HTMLIFrameElement | null>(null);
	let guestHeight = $state<number | null>(null);
	let effectiveHeight = $derived(guestHeight ?? Math.max(40, Math.min(2000, height)));
	let isReady = $state(false);
	let timedOut = $state(false);

	let policyResult = $derived.by(() => {
		try {
			return { policy: framePolicy(src), error: null };
		} catch (err) {
			return {
				policy: null,
				error: err instanceof Error ? err.message : String(err)
			};
		}
	});

	function handleLoad() {
		if (!iframeEl?.contentWindow || !policyResult.policy) return;
		const theme: 'light' | 'dark' =
			typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches
				? 'light'
				: 'dark';
		const msg = hostMessage({ type: 'host:init', appId, theme });
		if (msg) {
			iframeEl.contentWindow.postMessage(msg, src);
		}
	}

	$effect(() => {
		isReady = false;
		timedOut = false;
		if (allowed === false || !policyResult.policy) return;

		const timer = setTimeout(() => {
			if (!isReady) {
				timedOut = true;
			}
		}, 5000);

		function onMessage(event: MessageEvent) {
			if (event.origin !== src) return;
			if (!iframeEl || event.source !== iframeEl.contentWindow) return;

			const parsed = parseGuestMessage(event.data);
			if (!parsed) return;

			if (parsed.type === 'guest:ready') {
				isReady = true;
				timedOut = false;
				return;
			}

			if (parsed.type === 'guest:resize') {
				guestHeight = Math.max(40, Math.min(2000, Math.round(parsed.height)));
				return;
			}

			if (parsed.type === 'guest:call') {
				const { requestId, tool, args } = parsed;
				if (onCall) {
					void Promise.resolve()
						.then(() => onCall(tool, args))
						.then((data) => {
							if (!iframeEl?.contentWindow) return;
							const reply = hostMessage({
								type: 'host:result',
								requestId,
								ok: true,
								data
							});
							if (reply) {
								iframeEl.contentWindow.postMessage(reply, src);
							}
						})
						.catch((err: unknown) => {
							if (!iframeEl?.contentWindow) return;
							const reply = hostMessage({
								type: 'host:result',
								requestId,
								ok: false,
								error: err instanceof Error ? err.message : String(err)
							});
							if (reply) {
								iframeEl.contentWindow.postMessage(reply, src);
							}
						});
				} else {
					if (!iframeEl?.contentWindow) return;
					const reply = hostMessage({
						type: 'host:result',
						requestId,
						ok: false,
						error: 'No tool handler registered'
					});
					if (reply) {
						iframeEl.contentWindow.postMessage(reply, src);
					}
				}
			}
		}

		window.addEventListener('message', onMessage);

		return () => {
			clearTimeout(timer);
			window.removeEventListener('message', onMessage);
		};
	});
</script>

{#if allowed === false}
	<p role="status" class="mcp-app-status">
		This app is refused by the mcp_app policy verb or the MCP_APPS_ALLOW allowlist.
	</p>
{:else if policyResult.error}
	<div role="alert" class="mcp-app-error">
		<span>Failed to initialize MCP App frame: {policyResult.error}</span>
	</div>
{:else if policyResult.policy}
	<div class="mcp-app-container">
		{#if timedOut && !isReady}
			<p role="status" class="mcp-app-status">
				The guest app did not become ready within 5 seconds.
			</p>
		{/if}
		<iframe
			bind:this={iframeEl}
			{src}
			title="MCP App {appId}"
			sandbox={policyResult.policy.sandbox}
			allow={policyResult.policy.allow}
			referrerpolicy={policyResult.policy.referrerPolicy as ReferrerPolicy}
			onload={handleLoad}
			style="height: {effectiveHeight}px; width: 100%; border: 0;"
		></iframe>
	</div>
{/if}

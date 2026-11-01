import vercel from '@sveltejs/adapter-vercel';
import node from '@sveltejs/adapter-node';

function deploymentAdapter() {
	const target = process.env.DEPLOY_TARGET ?? 'vercel';
	switch (target) {
		case 'vercel':
			// Pin the function runtime: adapter-vercel otherwise infers it from the build
			// machine's Node version and refuses to build on anything outside 20/22/24.
			return vercel({ runtime: 'nodejs22.x' });
		case 'node':
			return node();
		default:
			throw new Error(`Unsupported DEPLOY_TARGET "${target}". Choose vercel or node.`);
	}
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// New app code is always Svelte 5 Runes. Dependencies keep their own mode.
		runes: ({ filename }) => (filename?.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: deploymentAdapter(),
		alias: {
			$features: './slices',
			// Portable shell modules that the workspace slice imports directly.
			$shared: './shared'
		},
		/**
		 * Enforced (not report-only) CSP for every server-rendered page.
		 *
		 * `mode: 'auto'` means SvelteKit adds a per-response nonce to `script-src` and
		 * `style-src` and stamps that nonce on its own inline bootstrap script and inline
		 * `<style>` blocks, so `unsafe-inline` is never needed for scripts. Prerendered pages
		 * would get hashes instead; nothing here prerenders, so this build always uses nonces.
		 *
		 * Why each source is listed:
		 * - `script-src 'self'`: only `/_app/**` bundles; the inline bootstrap rides the nonce.
		 * - `style-src 'self' 'unsafe-inline'`: the one deliberate relaxation, and it is there
		 *   for a reason the page cannot avoid. `ArtifactFrame.svelte` renders a
		 *   model-generated HTML fragment with `srcdoc`, and a `srcdoc` document **inherits
		 *   this policy**; its `<style>` blocks can never carry a nonce (the fragment comes
		 *   from the model after the response has been built). A nonce in `style-src` also
		 *   makes the browser ignore `'unsafe-inline'`, so the two cannot coexist. The same
		 *   allowance covers the UI's dynamic inline attributes (`style="width:{p}%"`, iframe
		 *   heights, chat column width), which no nonce can reach either. Script execution is
		 *   still nonce-only, and the artifact frame is `sandbox=""`, so this relaxation
		 *   buys CSS, not code. See `docs/csp.md` for what a real fix costs.
		 * - `img-src 'self' data: blob:`: brand assets, `data:` SVGs echoed by tool output, and
		 *   `URL.createObjectURL` previews of pasted files (`AttachmentPreview`, `FileCanvas`).
		 * - `media-src 'self' blob:`: recorded voice notes play back from an object URL
		 *   (`Chat`/`Voice`/`Transcribe`).
		 * - `font-src 'self'`: Inter is bundled by `@fontsource-variable/inter`; no CDN.
		 * - `connect-src 'self' https: wss: http: ws:`: every destination is user-supplied at
		 *   runtime, so it cannot be pinned to a host list — the Convex deployment
		 *   (`https:`/`wss:`), user-configured device bridges on a LAN or tailnet (plain
		 *   `http:`/`ws:` on a private origin is allowed by `classifyEndpoint`), and same-origin
		 *   `/api`,`/auth`. Scheme-level only, and `classifyEndpoint` refuses cleartext to a
		 *   public host. See `docs/csp.md` for what tightening this needs.
		 * - `frame-src http: https:`: the browser canvas frames an arbitrary user-entered
		 *   http(s) page, and MCP app frames are https-only. Artifact frames use `srcdoc`,
		 *   which inherits this policy and needs no source.
		 * - `frame-ancestors 'none'` mirrors `X-Frame-Options: DENY` in `hooks.server.ts`.
		 * - `base-uri 'none'`: nothing uses `<base>`; this kills base-tag hijacking.
		 * - `form-action 'self'`: every form posts back to this origin.
		 * - `object-src 'none'`: no plugin content anywhere.
		 */
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				// 'unsafe-inline' is required by `srcdoc` artifact frames, which inherit this
				// policy and carry model-written `<style>` blocks that no nonce can reach.
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'media-src': ['self', 'blob:'],
				'font-src': ['self'],
				'connect-src': ['self', 'https:', 'wss:', 'http:', 'ws:'],
				'frame-src': ['https:', 'http:'],
				'frame-ancestors': ['none'],
				'base-uri': ['none'],
				'form-action': ['self'],
				'object-src': ['none']
			}
		}
	}
};

export default config;

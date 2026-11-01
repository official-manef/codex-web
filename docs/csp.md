# Content-Security-Policy

Enforced policy, configured in `svelte.config.js` (`kit.csp`) and emitted as a
`Content-Security-Policy` **response header** on every server-rendered page. `mode: 'auto'`
means SvelteKit generates a per-response nonce, adds it to `script-src`, and stamps it on its
own inline bootstrap script. Nothing in this app prerenders, so the nonce path is the only one
that runs; a prerendered page would fall back to hashes and the nonce would be rejected at build
time (`Cannot use prerendering if page template contains %sveltekit.nonce%`).

The policy is not report-only. There is no `Content-Security-Policy-Report-Only` header, so
`tests/csp.e2e.ts` asserts the browser refuses a violation rather than logging it.

## The policy

```
default-src 'self';
frame-src https: http:;
connect-src 'self' https: wss: http: ws:;
font-src 'self';
img-src 'self' data: blob:;
media-src 'self' blob:;
object-src 'none';
script-src 'self' 'nonce-<per response>';
style-src 'self' 'unsafe-inline';
base-uri 'none';
form-action 'self';
frame-ancestors 'none'
```

## Why each source is allowed

| Source                                     | Reason                                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src 'self'`                        | Only the hashed bundles under `/_app/immutable/`. The inline bootstrap is admitted by the nonce, not by a keyword.                                                                                                                     |
| `script-src 'nonce-…'`                     | SvelteKit's inline bootstrap (`start.<hash>.js` import map and hydration entry). Per response, so a replayed nonce is useless.                                                                                                         |
| `style-src 'self'`                         | The bundled stylesheet (`layout.css`, Tailwind, `@fontsource-variable/inter`).                                                                                                                                                         |
| `style-src 'unsafe-inline'`                | **The one deliberate relaxation.** See below.                                                                                                                                                                                          |
| `img-src 'self' data: blob:`               | Brand assets in `static/brand`; `data:` SVGs that model output echoes back; `URL.createObjectURL` previews of pasted files (`AttachmentPreview.svelte`, `FileCanvas.svelte`).                                                          |
| `media-src 'self' blob:`                   | Recorded voice notes play from an object URL in `Chat.svelte`, `Voice.svelte`, `Transcribe.svelte`, `Recorder.svelte`.                                                                                                                 |
| `font-src 'self'`                          | Inter is bundled by `@fontsource-variable/inter`. No font CDN is contacted.                                                                                                                                                            |
| `connect-src 'self' https: wss: http: ws:` | `/api` and `/auth` (self), the Convex deployment over `https:`/`wss:`, and user-configured device bridges. See the untightened list.                                                                                                   |
| `frame-src https: http:`                   | The browser canvas frames an arbitrary user-entered http(s) page (`BrowserCanvas.svelte`), and MCP app frames are https-only (`mcp_app_host.ts` rejects non-https). `srcdoc` artifact frames need no source: they inherit this policy. |
| `default-src 'self'`                       | Fallback for everything not named, so a directive added later without an entry fails closed.                                                                                                                                           |
| `object-src 'none'`                        | No `<object>`, `<embed>` or plugin content in the app.                                                                                                                                                                                 |
| `base-uri 'none'`                          | Nothing uses `<base>`; this removes base-tag hijacking of relative script URLs.                                                                                                                                                        |
| `form-action 'self'`                       | Every form posts back to this origin. A form that posts to an attacker origin is a credential exfiltration path.                                                                                                                       |
| `frame-ancestors 'none'`                   | Mirrors `X-Frame-Options: DENY` from `hooks.server.ts` for browsers that read the CSP version.                                                                                                                                         |

### Why `style-src 'unsafe-inline'`

`ArtifactFrame.svelte` renders a model-generated HTML fragment with
`<iframe sandbox="" srcdoc={html}>`. A `srcdoc` document **inherits the embedding document's
CSP**, and the fragment's `<style>` blocks are written by the model after the response has been
built, so they can never carry the response nonce. With `style-src 'self'` alone every artifact
rendered unstyled — verified in a browser, not assumed (see below).

A nonce cannot be combined with `'unsafe-inline'` in the same directive: the spec says the
presence of a nonce or hash makes the browser ignore `'unsafe-inline'` for that directive. The
same allowance also covers the app's own dynamic inline style attributes
(`style="width:{p}%"` in `Playground.svelte`/`Voice.svelte`, iframe heights, the chat column
width custom property), which no nonce can reach either.

The cost is bounded: this relaxation only permits CSS. Script execution still requires the
nonce, so injected CSS cannot become code. The artifact frame is additionally `sandbox=""`, so
even the CSS runs with no same-origin access and no scripts.

A real fix would render artifacts in a frame on a separate origin (or a `blob:` document with
its own CSP), so the parent policy never applies to model HTML. That is a routing change, not a
header change, and it is deliberately not done here.

## What broke on the first attempt

`style-src 'self'` with `style-src-attr 'unsafe-inline'` as a narrower substitute. The page
itself passed every existing test — the shell hydrated, the composer worked. The break was
found by probing a real `srcdoc` frame in the browser:

```
Applying inline style violates the following Content Security Policy directive
'style-src 'self''. Either the 'unsafe-inline' keyword, a hash or a nonce is required.
```

`style-src-attr` does not cover `<style>` _elements_ inside a srcdoc document; it only covers
attributes on the embedding page. The directive was widened to
`style-src 'self' 'unsafe-inline'` and `style-src-attr` dropped (it was subsumed). The probe is
now a permanent test: "a srcdoc artifact frame still gets its own styles".

## Directives that could not be tightened

1. **`connect-src` is scheme-level, not host-level.** Every destination is entered by the user
   at runtime: the Convex deployment URL comes from `PUBLIC_CONVEX_URL`, and device bridge
   origins are typed into Devices. Plain `http:`/`ws:` are needed because a bridge on
   `127.0.0.1` or a LAN/tailnet address is a legitimate target and those origins cannot be
   known at build time. `classifyEndpoint` (`src/lib/runtime/endpoint.ts`) already refuses
   cleartext to a _public_ host, but the CSP cannot express "http: only to private
   addresses". Closing this needs either a fixed bridge allowlist in config (loses the
   bring-your-own-bridge design) or a same-origin proxy route so the browser only ever talks
   to `'self'`.
2. **`script-src 'self'` includes every bundle the app ships.** With no
   `strict-dynamic`, a same-origin script injected via an HTML-injection bug would still run.
   `'strict-dynamic'` would fix that and needs a nonce on every script tag — SvelteKit already
   does this for its own scripts, so it is a plausible next step, but it also breaks any
   third-party same-origin script and was not verified across all surfaces here.
3. **`style-src 'unsafe-inline'`.** Described above. Needs an origin-isolated artifact frame.
4. **`frame-src https: http:`** is any host. The browser canvas deliberately frames whatever
   address the user types. A curated allowlist would break that feature.
5. **`img-src` allows `data:` and `blob:`** for any MIME type. Fine at present (an image
   context cannot execute), but it is broader than a fixed asset list.
6. **No `require-trusted-types-for 'script'`.** Trusted Types would be the real defence against
   DOM-XSS sink injection and is supported in Chromium. The app has no `innerHTML` use today
   (`markdown.ts` builds text nodes, `ArtifactFrame` uses `srcdoc` under a sandbox), so the
   policy would currently pass — but a single future `innerHTML` would break the build in a way
   this task did not audit. Left for a follow-up with its own verification.

## What is verified

`tests/csp.e2e.ts` runs against the built preview (`vite preview`), in the narrow-mobile,
mobile and desktop projects:

- the enforced header is present, there is no report-only header, `script-src` carries a nonce
  and no `'unsafe-inline'`/`'unsafe-eval'`/`'wasm-unsafe-eval'`;
- `style-src` is exactly `'self' 'unsafe-inline'` — the relaxation is pinned, so it cannot be
  widened silently;
- an injected inline `<script>` does **not** execute and raises a `securitypolicyviolation`
  for `script-src`, while the nonced bootstrap did run (the shell hydrated);
- a `srcdoc` frame still receives its own `<style>`;
- no violation is reported while the shell hydrates, the composer sends a turn and the stub
  reply renders.

`vite dev` was also checked by hand (same header, nonce present, no violations, injected inline
script refused). Dev mode adds `'unsafe-inline'` to `style-src` on its own because Vite injects
style elements at runtime; that is a SvelteKit dev-only augmentation, not part of the built
policy, and the e2e gate runs against the build.

**Convex websocket: not exercised by the gate.** `playwright.config.ts` runs with
`PUBLIC_CONVEX_URL: ''`, so no Convex client is created and no `wss:` connection is attempted.
`connect-src` does list `wss:` and `https:`, so a real deployment is expected to work, but that
is a config-level argument, not a browser observation. Verifying it needs a Playwright run with
a live deployment URL.

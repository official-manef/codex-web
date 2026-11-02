# Architecture

One SvelteKit application owns the web experience; Convex is the default backend for
functions and persisted data. Root feature slices stay independent of framework routes.

## This product's shape

The product is the shared workspace shell template. Its MVP uses **no backend and no
credentials**: the shell renders Laya's UI, and the transport (`src/lib/http.ts`) is an
in-browser store. Every optional capability ships disabled, so a fresh clone has none enabled:
`AUTH_ENABLED`, `AI_ENABLED`, `MCP_CLIENT_ENABLED`, `MCP_SERVER_ENABLED`, `GIT_SURFACE_ENABLED`
and `AI_TOOLS_ENABLED` all default to `false`, and `PUBLIC_CONVEX_URL` empty means no cloud.

```text
/                     → app-shell chrome + Chat (primary) + tabbed output region (secondary)
/home /privacy /terms → public pages; no auth, no workspace bundle (OAuth brand registration)

hash routes           → #apps #transcribe #files #browser #terminal #chat … (rail/launcher destinations)
                        → #models #setup #backends #providers #pricing #faq
                          (navigationRole: settings → SettingsWindow, not the primary region)

src/lib/http.ts       → re-exports src/lib/http.local.ts (in-browser store)
slices/workspace-shell → navigation, region layout, tabs, menus, overlays
src/lib/registry.ts   → feature catalogue: id, label, icon, group, placement, loadScreen
```

Vendored, byte-identical to `rahmanef63/laya-npu` @ `84c1823`: `slices/workspace-shell/**`,
`shared/**`, `src/lib/views/**`, the `src/lib/*` helpers those views import, and
`src/app-laya.css`. Written here: `slices/workspace-surface/**` (composition root),
`src/routes/**`, `src/lib/{registry,workspace_routes,workspace_persistence,
template_runtime_adapter}.ts`, and the transport shim.

Re-sync procedure, deliberate deviations and the lint posture for the vendored trees:
[docs/laya-parity.md](laya-parity.md).

Device-bound tools stay off until a device of that kind is paired and the user turns the tool
on in Tools. The terminal panel's client behaviour and the bridge contract it expects are in
[terminal](terminal.md).

## Sources of truth

| Concern                                              | Source                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Product identity, locale and shared copy             | `src/lib/config/app.ts`                                                        |
| Canonical/social metadata                            | `src/lib/config/metadata.ts`, public origin and route metadata                 |
| Asset paths, sizes, status and briefs                | `assets.config.ts`                                                             |
| Feature catalogue and navigation                     | `src/lib/registry.ts`, `src/lib/workspace_routes.ts`                           |
| Shell UI, views and view components                  | `slices/workspace-shell/**`, `src/lib/views/**`, `src/lib/*.svelte` (vendored) |
| Transport                                            | `src/lib/http.ts` → `src/lib/http.local.ts`                                    |
| Device terminal panel and bridge contract            | `src/lib/views/Terminal.svelte`, [terminal](terminal.md)                       |
| Framework loading, HTTP status and rendering         | `src/routes/`                                                                  |
| Schema, private-data authorization and durable state | `src/convex/`                                                                  |
| API/data types                                       | Committed `src/convex/_generated/`, produced by Convex codegen                 |
| UI primitives / design tokens                        | `src/lib/components/` / `src/routes/layout.css`, `src/app-laya.css`            |
| Private integration choices                          | `src/lib/server/integrations/config.ts`                                        |
| Runtime/dependency versions                          | `package.json`, `bun.lock`, `.node-version`                                    |
| Release version                                      | `version.json`; version command synchronizes package metadata                  |

Immutable config is safe to share. Request identity, authenticated clients, drafts and
mutable user state must not live in a shared server singleton. Public config, asset
briefs and loader output must never contain secrets.

## Add a feature

1. Add an entry to `src/lib/registry.ts`: `id`, `label`, `icon`, `group`, optional
   `placement` / `navigationRole` and a lazy `loadScreen`.
2. Create the view under `src/lib/views/` and compose the shell's chat-ui primitives
   (`ChatSurface`, `ChatComposer`, `ChatHeader`, …) rather than new ones.
3. If it needs data, add a route to `src/lib/http.local.ts`'s switch. That file is the only
   place that knows the wire shape; a real product replaces `src/lib/http.ts` instead.
4. Implement success, empty, denied, failure and recovery states, then verify in a browser
   at phone, tablet and desktop widths.

Routes stay thin: `src/routes/+page.svelte` mounts the composition root and nothing else.
The shell owns navigation, so a feature does **not** get its own SvelteKit route; it gets a
registry entry and a hash destination. See [docs/laya-parity.md](laya-parity.md).

## How a request reaches a provider

Three paths, one contract. The browser never learns a provider host.

```text
browser
  └─ src/lib/http.ts ──────────────► re-export of http.local.ts (in-browser store, no network)
        │
        ├─ POST /api/ai/config ────► aiSettings(env): which providers/models are approved
        │
        └─ POST /api/ai/chat ──────► chatResponse(): AI SDK stream to the pinned host
                                       │
                                       ├─ provider id → host from config.ts / providers.ts
                                       ├─ key from the request body, held in memory only
                                       └─ SSE back to the browser: text | error | done
```

Order of checks on `/api/ai/chat`, all server-side, in this order:

1. `requireCapabilityAccess(event)` — Google session or `CAPABILITY_ACCESS_TOKEN`.
2. `parseChat(env, body)` — zod: provider in the enum, model in the approved list for that
   provider, 1–16 messages, ≤32,000 total characters, final message from the user.
3. `chatResponse` — resolves the pinned base URL for that provider id, streams with a
   60-second deadline, one attempt, no retries.

A key is never persisted on this path: it arrives in the request, lives in the handler, and
is redacted out of any error text that echoes upstream. The one exception is per-user MCP in
`src/convex/mcp.ts`, where a stored connection must survive between discoveries and is
therefore encrypted with AES-256-GCM under `MODELS_ENC_KEY`.

Optional local activity logging sits beside this and records metadata only — see
[environment](environment.md#local-activity-log).

## Why the provider list exists twice

| Path             | File                          | Used by        |
| ---------------- | ----------------------------- | -------------- |
| `cloud` engine   | `src/convex/providers.ts`     | Convex actions |
| SvelteKit routes | `src/lib/server/ai/config.ts` | `/api/ai/*`    |

`src/convex/` cannot import from `src/lib/`: the Convex runtime bundles its own module
graph, so a shared constant would require a build step the template does not justify. Both
pin the same host per provider, so a divergence is visible as a key sent to the wrong
origin. Change one, change the other, then run `vitest run src/convex src/lib/server/ai`.

## Convex and authorization

`convex.json` selects `src/convex/`; the root layout sets up the client only when
`PUBLIC_CONVEX_URL` exists. Subscriptions are already reactive. Committed codegen lets
a fresh clone typecheck without linking a backend.

`starter.status` returns public version metadata. **There is no `notes` table** — it was removed
in `023aa02`; owner-scoped private data now lives in `memories` and `projects`, each indexed by
owner and re-checking identity on every read. Google OIDC is optional; its server session passes
only an ID token through `/auth/token` to Convex, which verifies its configured issuer/audience
independently. Safe session metadata in the root loader contains no tokens.
[Auth setup and limits](auth.md) are part of this boundary.
Workspace switching and settings remain local examples, not a tenancy system.

## Loading and recovery

The universal page loader awaits only the selected slice's `loadScreen` import. This
preserves initial SSR while splitting feature code; the registry never eagerly imports
screens. Client navigation shows a semantic loading skeleton while preserving the current
screen until the next load succeeds. Render boundaries offer retry; event handlers and
network streams handle their own failures. Server errors expose a correlation ID, not
raw provider exceptions. API/auth responses and session-dependent pages are not cached.

## Optional provider boundaries

`createCheckout` and `sendEmail` are small server transport boundaries. Their resolver
receives environment values explicitly, reads only the requested capability and fails
for disabled or unsupported usage. It does not validate all flags during app startup.
Payments prefer DOKU and email prefers Resend when enabled; unused services need no keys.

The included transports/signature helper have mocked HTTP tests. They provide no public
checkout endpoints, order ledger, fulfillment or email outbox. Google auth and BYOK
AI/MCP have dedicated validated server modules; GCP service and Cloudflare Workers
integrations remain recipes. A configuration
flag cannot complete these flows or migrate old transactions to a new provider.

SvelteKit server code uses private env imports. To use a transport from a Convex Node
action, move/extract its runtime-neutral implementation into a backend-owned module,
then supply that deployment environment. Convex cannot import `src/lib/server`,
SvelteKit aliases or environment modules. Keep authorization at the
entry point and durable business state in Convex. See [integrations](integrations.md)
for transport constraints, webhook verification and lifecycle acceptance tests.

## Branding and generated assets

The public app config and catalog drive page titles, descriptions, icons and sharing
images. `PUBLIC_SITE_URL` supplies an explicit canonical origin; incoming host headers
do not choose it. `PUBLIC_SEO_INDEXABLE` defaults false and requires that origin when
enabled. Preview sites and demo app routes are noindex. The robots and sitemap endpoints
use the same settings; the sitemap lists exactly three locations — `/`, `/privacy`, `/terms` —
and `src/routes/contract.spec.ts` pins that count. Note what `/` actually renders: the
workspace shell, not the landing page. `/home` is the human-facing landing and is **not** in
the sitemap, so the URL a crawler is told is canonical is the app. Nothing else is listed: an
app screen is reached by hash, not by URL, so it is not a crawlable page.
See [the environment consumer matrix](environment.md).

The asset script writes committed placeholders, file fingerprints and a web manifest;
it preserves entries marked `custom`. This is build tooling, not an AI client or an
offline/PWA runtime. Review artwork and run asset checks after customization. See
[assets](assets.md) and [DESIGN.md](../DESIGN.md).

## BYOK and MCP

[AI/MCP](ai-mcp.md) is request-scoped and optional. The app uses maintained SDKs, fixed
provider endpoints, approved model/tool lists, input/output budgets and cancellation.
MCP discovery is on demand; execution requires review of exact arguments. Tool results
and model output remain plain untrusted text. The read-only MCP server has a separate
credential and exposes template status only. No shell, arbitrary remote URL, automatic
tool loop, server-key fallback or durable conversation store is installed.

[Linter rules](linting.md) check authored TypeScript/Svelte promises, validators and
import boundaries. These gates supplement runtime authorization and behavioral tests.

```

```

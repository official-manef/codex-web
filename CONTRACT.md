# Project contract

This is the maintained map of shared invariants and their authoritative files. Read it
at the start of each session. It records the current template, not a hypothetical client
application. Detailed implementation guidance lives in [architecture](docs/architecture.md).

## Current baseline

- One SvelteKit app uses Svelte 5 Runes and Bun. `bun.lock` is the only package lockfile.
- Convex is the default backend; its frontend connection is optional. A clean clone
  starts without credentials. Status metadata is public; notes require backend ownership checks.
- Feature UI lives in root `slices/<slug>/`; cross-slice imports use `$features/<slug>`
  barrels. Routes are thin framework adapters; the existing app page family uses one registry.
- Payments and email are disabled transport building blocks, preferring DOKU and Resend
  when selected. Google auth/private notes, BYOK AI and remote MCP are implemented opt-ins. GCP service
  adapters and Cloudflare Workers remain recipes; Node hosting is implemented.
- Workspace and settings examples are local UI state. They provide no identity, ownership
  or tenancy guarantee. Google subjects own private notes. Payment/email lifecycle acceptance
  remains product work; provider credentials and product deployment need tenant-specific setup.

## Authoritative inputs

| Concern                             | Source of truth                                                         |
| ----------------------------------- | ----------------------------------------------------------------------- |
| Runtime and dependencies            | `package.json`, `bun.lock`, `.node-version`                             |
| Release identity                    | `version.json`; synchronize with `bun run version:bump`                 |
| Public brand and metadata           | `src/lib/config/app.ts`, `src/lib/config/metadata.ts`                   |
| Feature definitions and navigation  | `src/lib/registry.ts`, `src/lib/workspace_routes.ts`                    |
| Theme and reusable UI               | `src/routes/layout.css`, `src/lib/components/`                          |
| Assets and generation inputs        | `assets.config.ts`; outputs follow [assets.md](docs/assets.md)          |
| Backend schema and API              | `src/convex/`; `_generated/` is CLI-produced and committed              |
| Private integration selection       | `src/lib/server/integrations/config.ts`                                 |
| Authentication                      | `src/lib/server/auth/`, `src/convex/auth.config.ts`                     |
| AI/MCP selection and request access | `src/lib/server/ai/`, `src/lib/server/mcp/`, `src/lib/server/access.ts` |
| Environment requirements            | `.env.example`, [consumer matrix](docs/environment.md)                  |

Do not duplicate version pins, menus, brand constants or provider checks in other files.
Ordinary feature-local copy stays local; sharing configuration does not require turning
every value into a global option. Indexing needs `PUBLIC_SEO_INDEXABLE=true` and an
explicit origin; preview sites and demo app routes remain noindex. Metadata and crawler
documents share the SEO settings in `src/lib/config/metadata.ts`.

## Trust and runtime boundaries

Private reads, writes and actions authenticate and authorize ownership/tenant membership
on the backend. Validate arguments, results and business limits; bound growing reads.
Public metadata is an explicit exception, never a private-feature auth pattern.

Public config, assets, prompts and browser data contain no secrets. Immutable shared
configuration is allowed; mutable user/session state shared across server requests is not.
The bounded burst limiter is a documented exception for hashed counters only, not a session
or credential store; multi-instance deployments need an external rate limit.
SvelteKit server modules and Convex actions use the environment of their executing runtime.
Convex imports cannot depend on SvelteKit aliases or environment modules. SvelteKit request
keys and chat history stay in current request/tab memory. On the Convex path a BYOK credential
is posted once and stored only as an AES-256-GCM blob under `MODELS_ENC_KEY` (`modelCreds`,
and `mcpConnections` for a user-owned MCP server); every read re-derives `owner` and never
returns the plaintext. On the SvelteKit path (`src/lib/byok_key.ts`) the key is one tab-scoped
`sessionStorage` draft written and read by that module alone: no `localStorage`, no URL, no log,
gone when the tab closes, kept across a reload so a stream in flight can finish. Memories
(`src/lib/memories.ts`) are `localStorage` notes that reach a model as untrusted context, never
as an instruction. The git surface (`src/lib/server/git.ts`, `src/routes/api/git/+server.ts`)
is root-allowlisted and subcommand-bounded; diff and status are open because they cannot
write, while stage, commit and worktree changes are denied unless `GIT_POLICY_JSON` grants the
exact verb (`src/lib/server/policy.ts`, deny-by-default on unset or malformed policy). Push and
PR review do not exist. Tool output is untrusted data; MCP calls
require configured or per-user endpoint/tool allowlists and explicit review, never automatic model execution. See the focused
[Svelte](docs/svelte-best-practices.md) and [Convex](docs/convex-best-practices.md) rules.

## This product

This repository is the **shared workspace shell template**: the Laya NPU workspace UI/UX,
copied verbatim and re-hosted with a local stub backend. Every visible string is real copy
(Laya's own labels), not a `{}` token.

Read [docs/laya-parity.md](docs/laya-parity.md) first; it records provenance, the consumer
contracts, deliberate deviations and the re-sync procedure.

### Authoritative inputs for this product

| Concern                                          | Source of truth                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Shell UI, layout, menus, tabs                    | `slices/workspace-shell/**` (vendored from `rahmanef63/laya-npu` @ `9a893b2`)         |
| Shared shell modules and tokens                  | `shared/**`; token block merged into `src/routes/layout.css`                          |
| Chat surface                                     | `src/lib/views/Chat.svelte` (vendored)                                                |
| Composition root: registry, runtime, persistence | `slices/workspace-surface/**`                                                         |
| Route                                            | `src/routes/+page.svelte` (mounts `WorkspaceApp`; the shell owns navigation)          |
| Public pages (no auth, no workspace bundle)      | `src/routes/{home,privacy,terms}/+page.svelte`; identity in `src/lib/config/legal.ts` |
| Product identity and metadata                    | `src/lib/config/app.ts`, `src/lib/config/metadata.ts`                                 |

### Rules specific to this product

- **Do not edit the vendored trees to fix a lint or type finding.** Fix it upstream in
  `laya-npu`, re-copy, then delete the override. `eslint.config.js` carries the bounded
  exception with its `TODO(rr)` marker.
- **Do not add `/workspace`, `/capabilities` or `/settings` routes.** The shell owns
  navigation; a second route family would be a second source of truth.
- **Three public pages are the only non-app routes.** `/home`, `/privacy` and `/terms` exist for
  OAuth brand registration and render without auth or the workspace bundle. Their shared
  identity (app name, operator, contact mailbox, jurisdiction, effective date, license) lives in
  `src/lib/config/legal.ts` — one place, so the pages cannot disagree with each other or with
  the consent screen. The sitemap lists exactly `/`, `/privacy` and `/terms`; `/home` is not
  listed, and a route change must update `src/routes/contract.spec.ts` with it.
- **Three engines, no removals.** `local` (browser, no account), `device` (a runtime the user
  paired), `cloud` (a Convex action on the user's own key). With no `PUBLIC_CONVEX_URL` the
  cloud engine reports `unsupported` and the workspace is exactly the local template. Never
  make an engine the only one.
- **The browser never holds a provider key.** It is posted once to `credentials.connect`, which
  encrypts it with `MODELS_ENC_KEY` server-side. A built-in provider's key is pinned to the host
  in `src/convex/providers.ts`; only a custom slug may carry its own HTTPS endpoint.
- **A disabled control names its reason.** `slices/cloud/state/engine.ts` returns the reason a
  cloud or device turn is unavailable, and the UI shows it.
- **A paired device is an execution target, not a credential store.** Only `SHA-256(token)` and
  a validated `http(s)` origin are stored. The browser classifies an endpoint in
  `src/lib/runtime/endpoint.ts`; Convex validates the same origin shape independently in
  `src/convex/_shared/endpoint.ts` and never imports `src/lib/runtime/**`. Terminal and remote
  browser view stay off until a device of that kind is paired and the user enables the tool in
  Tools. The `terminal` tab itself is always reachable (`ALWAYS_ENABLED`) so the screen
  that explains "pair a terminal device first" can be found; only the connection is gated.
  The bridge it talks to is documented in [terminal](docs/terminal.md).
- **Do not fake OAuth readiness.** The OAuth path is not configured in this template, so the UI
  offers the documented manual-key flow instead of a dead button.
- **Omitted optional props stay omitted.** `runtimeControls`, `hostedGate`, `settingsWindow`,
  `workspaceLauncher` are not passed; the shell does not mount them. Do not add stubs that
  render nothing.
- `DEPLOY_TARGET=node node scripts/smoke-node.mjs` asserts the shipped route family. Any
  route change must update it in the same commit.

### MANEF AI console seam

- **The hub is reached server-side only.** `/api/manef/*` forwards `/api/modules`,
  `/api/plan` and `/ready` to `MANEF_HUB_URL`, which must be loopback `http`. A browser
  never talks to the hub, and an incoming `Origin` is never forwarded. Widening the route
  table means editing `src/lib/server/manef.ts`; a request URL cannot do it.
- **The screen is read-only by construction.** The hub has no execution endpoint and every
  declared capability is `read` or `none`. Nothing on this screen starts a product,
  resolves a secret or grants authority. `unconfigured` readiness is shown as such.
- **This seam adds no identity.** It has no principal, tenant, scope or approval. Those are
  the owning product's job at call time, never fields in a plan.

### Superseded documents

`docs/PRD.md`, `docs/ui-spec.md`, `docs/implementation-plan.md`, `docs/state-model.md` and
`docs/placeholder-copy.md` describe the earlier 0.3.0 from-scratch shell. They are kept for
history; `docs/REBUILD-PLAN-laya-parity.md` and `docs/laya-parity.md` are current.

## Maintenance and proof

Update this contract in the same change that moves an authoritative file, changes a
shared boundary/default, activates a capability or changes its ownership model. Update
the affected detailed guide too. Routine component edits need no contract rewrite.

Checks live in `package.json` and [CHECKLIST.md](CHECKLIST.md); evidence belongs to the
actual revision and environment tested. Keep transient progress in the task/PRD, not
as a second status ledger here. Use [agent-workflow.md](docs/agent-workflow.md) to resume
from current files and preserve clear, compact handoffs.

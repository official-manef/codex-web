# Workspace Shell Template

The Laya NPU workspace UI/UX as a standalone SvelteKit template: rail, sidebar, chat surface
with a tabbed output region, lazy feature screens, layout persistence. The shell is copied
verbatim from [`rahmanef63/laya-npu`](https://github.com/rahmanef63/laya-npu); this repository
re-hosts it with a local stub backend so it boots with zero credentials.

[Laya parity and provenance](docs/laya-parity.md) · [Rebuild plan](docs/REBUILD-PLAN-laya-parity.md)
· [Contract](CONTRACT.md) · [UI/UX](UIUX.md) · [Changelog](CHANGELOG.md)

## What this is

| Part                                             | Source                                                      |
| ------------------------------------------------ | ----------------------------------------------------------- |
| Shell: regions, layout, menus, tabs, overlays    | `slices/workspace-shell/**` — vendored from Laya `9a893b2`  |
| Shared modules: icons, layout math, base tokens  | `shared/**`                                                 |
| Views and components                             | `src/lib/views/**`, `src/lib/*.svelte` — vendored from Laya |
| Transport (swap point)                           | `src/lib/http.ts` → `src/lib/http.local.ts`                 |
| Composition root: registry, runtime, persistence | `slices/workspace-surface/**`                               |
| Route                                            | `src/routes/+page.svelte`                                   |

The shell's own README (`slices/workspace-shell/README.md`) documents the consumer contract in
full. This repository is one working consumer of it.

## Three engines, one template

| Engine   | Runs where                                  | Account      | Key |
| -------- | ------------------------------------------- | ------------ | --- |
| `local`  | this browser, no network                    | no           | no  |
| `device` | a runtime you paired (your own NPU box)     | yes, to pair | no  |
| `cloud`  | a Convex action using **your** provider key | yes          | yes |

Local mode is not a fallback that gets removed when you configure cloud: with no
`PUBLIC_CONVEX_URL` the sign-in routes 404, the cloud engine reports `unsupported`, and the
workspace is exactly the local template. `.env` is optional either way.

**BYOK.** A key is posted once, encrypted with AES-256-GCM (`MODELS_ENC_KEY`) and never
returned to a browser. A built-in provider's key is pinned to that provider's host, so it
cannot be redirected. Custom endpoints require HTTPS. Contract, limits and the decision-model
(Jev) boundary: [docs/byok.md](docs/byok.md).

## Stack

Svelte 5 Runes · SvelteKit 2.70 · Bun 1.4.2 · Tailwind 4 + shadcn-svelte · TypeScript 6

Exact versions and the reason each dependency is pinned: [TECHSTACK.md](TECHSTACK.md).

```bash
bun install --frozen-lockfile
bun run dev
bun run verify           # check + lint + unit + build
bun run test:dev         # dev hydration smoke
DEPLOY_TARGET=node node scripts/smoke-node.mjs
```

`bunx playwright test` currently runs only `tests/dev-smoke.e2e.ts`. The AC01–AC18
acceptance suites named in the PRD do not exist in this tree; see
[progress](docs/progress.md#correction--the-ac-test-suites-do-not-exist).

## How it works

One SvelteKit page, one shell. `src/routes/+page.svelte` mounts a composition root and
nothing else — the shell owns navigation, tabs and overlays as state, so a feature is a
`src/lib/registry.ts` entry with a lazy `loadScreen`, not its own route.

```text
/                                → workspace shell: rail, sidebar, chat, tabbed output
src/lib/http.ts                  → re-exports src/lib/http.local.ts  ← the one swap point
src/lib/registry.ts              → feature catalogue: id, label, icon, group, loadScreen
slices/workspace-shell/**        → navigation, region layout, tabs, overlays (vendored)
slices/workspace-surface/**      → composition root, runtime, persistence
src/lib/views/**                 → screens, lazily imported
```

Data flows through `src/lib/http.ts`. In this template it re-exports an in-browser store
(`http.local.ts`), which is why a clean clone runs with no credentials and no network. A
product replaces that one re-export with a real client; no view changes.

Server-side capability routes are separate opt-ins, each off by default and each guarded
by session or operator token plus an origin check:

| Route             | Purpose                                     | Flag                 |
| ----------------- | ------------------------------------------- | -------------------- |
| `/api/ai/*`       | streamed BYOK chat, provider config         | `AI_ENABLED`         |
| `/api/mcp/tools`  | outbound MCP client, allowlisted tools only | `MCP_CLIENT_ENABLED` |
| `/api/mcp/server` | inbound read-only MCP endpoint              | `MCP_SERVER_ENABLED` |
| `/api/manef/*`    | loopback MANEF hub bridge, three paths only | `MANEF_HUB_URL`      |
| `/auth/*`         | Google OIDC login, callback, logout, token  | `AUTH_ENABLED`       |

Nothing above is reachable until its flag is set, and setting a flag still requires the
matching credential per request. Boundaries and limits: [architecture](docs/architecture.md),
[AI/MCP](docs/ai-mcp.md), [auth](docs/auth.md).

### Default model

`nine-router` is the built-in self-hosted gateway. Its default catalog entry is
`ctx/conextlab/ollama/deepseek-v4.1-flash:cloud` on priority 0, so that is the model a new
session picks. Chat, shell execution and MCP all work through it.

It cannot do sub-agents: the gateway flattens a non-OpenAI upstream's `collaboration`
namespace into one opaque function before the model sees it, so `spawn_agent` never
arrives. `cx/gpt-6.1-sol` is the one upstream where sub-agents pass — switch to it when you
need them, at the cost of a larger per-turn token count. Evidence and the failure
signature: [progress](docs/progress.md), [AI/MCP](docs/ai-mcp.md).

## MANEF AI console

This template is the console for the MANEF AI integration workspace
(`official-manef/manef-ai`). The **MANEF AI** screen lists the four declared products
(Models, MCP Builder/Connectors Gateway, Connectors, Agent@Manef) with their exact source
pins, declared effects and required scopes, and composes a preview plan against them.

The hub that owns that registry is a separate loopback process. Point the console at it:

```bash
# terminal 1 — the integration workspace
cd ../manef-ai && pnpm install --frozen-lockfile --ignore-scripts && pnpm run dev

# terminal 2 — this console
echo 'MANEF_HUB_URL=http://127.0.0.1:3210' > .env.local
bun run dev
```

Leave `MANEF_HUB_URL` unset and the screen says so instead of guessing. The bridge in
`src/lib/server/manef.ts` forwards three hub paths and nothing else; it holds no credential
and grants no authority. Every declared capability is `read` or `none`, and a plan is a
preview: no product is started, called or billed. See [environment](docs/environment.md)
and [AI/MCP](docs/ai-mcp.md).

## Routes

| Route         | What renders                                                       |
| ------------- | ------------------------------------------------------------------ |
| `/`           | the workspace shell (single page; the shell owns navigation state) |
| anything else | 404 boundary                                                       |

The shell renders its own areas — chat, lazily loaded feature screens, the output region —
through state, not routes. There is deliberately no `/workspace`, `/capabilities` or
`/settings` route: a second navigation family would be a second source of truth.

## Commands

| Command                           | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `bun run dev`                     | Development server                                   |
| `bun run check`                   | Svelte + backend types, version and asset validation |
| `bun run lint` / `bun run format` | Style and Svelte-5 syntax guard / format             |
| `bun run test`                    | Vitest unit tests                                    |
| `bunx playwright test`            | Production browser flows at 390 / 768 / 1440         |
| `bun run test:dev`                | Dev hydration and navigation smoke                   |
| `bun run verify`                  | check → lint → unit → build                          |
| `bun run assets:generate`         | Generate placeholders/manifest, keep custom art      |
| `bun run assets:check`            | Validate asset outputs                               |

`bun run test:dev` runs `tests/dev-smoke.e2e.ts` — hydration, a local send, the settings
window, and rail navigation over three viewports. That is the only browser suite in the
tree. The AC01–AC18 suites the PRD names were removed by `6ed1f3e` and never replaced; see
[progress](docs/progress.md#correction--the-ac-test-suites-do-not-exist) before claiming
any acceptance coverage.

Optional Convex commands (`bun run convex:dev`, `bun run convex:codegen`) stay available
but are unused by the MVP shell.

## Project map

```text
├── slices/                      # workspace-shell (vendored) + workspace-surface
├── src/routes/                  # thin adapters for /workspace, /capabilities, /settings
├── src/lib/components/          # shadcn/ui + app-ui primitives
├── src/lib/config/              # public identity, locale, metadata
├── src/convex/                  # backend (wired, unused by the MVP shell)
├── docs/                        # PRD, plan, spec, state model, copy, handoff
│   └── reference/               # prototype + classification sources
├── tests/                       # Playwright acceptance tests
└── scripts/                     # asset, syntax, version and deploy checks
```

`$features/*` resolves to root `slices/*`. See [architecture](docs/architecture.md) for the
boundaries and [implementation-plan.md](docs/implementation-plan.md) for the build order.

## Guides

| Task                                | Guide                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Product scope and acceptance        | [PRD](docs/PRD.md)                                                               |
| Build order, slice map, exit checks | [Implementation plan](docs/implementation-plan.md)                               |
| Regions, tokens, responsive, focus  | [UI spec](docs/ui-spec.md)                                                       |
| State, transitions, races           | [State model](docs/state-model.md)                                               |
| Copy tokens                         | [Placeholder copy](docs/placeholder-copy.md)                                     |
| Start in the cloud                  | [Cloud handoff](docs/cloud-handoff.md)                                           |
| ChatGPT desktop parity (handoff)    | [Parity brief](docs/chatgpt-desktop-parity.md)                                   |
| ChatGPT desktop parity (evidence)   | [Windows host evidence](docs/chatgpt-desktop-parity-windows.md)                  |
| Current progress                    | [Progress tracker](docs/progress.md)                                             |
| Shared invariants and file map      | [CONTRACT.md](CONTRACT.md)                                                       |
| Agent entry                         | [AGENTS.md](AGENTS.md), [agent start](docs/agent-start.md)                       |
| Svelte / Convex practice            | [Svelte](docs/svelte-best-practices.md), [Convex](docs/convex-best-practices.md) |
| Hosting and release                 | [Deployment](docs/deployment.md), [checklist](CHECKLIST.md)                      |

## References and license

Built from [`rahmanef63/template-svelte-convex-starter`](https://github.com/rahmanef63/template-svelte-convex-starter).
The workspace structure derives from the classification sources in `docs/reference/`,
which are specification inputs rather than upstream code.

Implementation references: [SvelteKit](https://svelte.dev/docs/kit),
[Convex Svelte](https://docs.convex.dev/client/svelte/overview), [Bun](https://bun.sh/docs),
[shadcn-svelte](https://www.shadcn-svelte.com/docs). Licensed under [MIT](LICENSE).

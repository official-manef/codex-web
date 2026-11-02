# Changelog

This repository starts from `rahmanef63/template-svelte-convex-starter` and now carries
its own history. Notable changes follow [Semantic Versioning](https://semver.org/).

## [0.7.0] - 2026-11-02

### Added

- **Public landing and legal pages** — `src/routes/home`, `src/routes/privacy`,
  `src/routes/terms`, and `src/lib/config/legal.ts` holding the app name, operator, contact
  mailbox, jurisdiction, effective date and license in one place so the three pages cannot
  disagree with each other or with the OAuth consent screen. They exist because registering an
  OAuth client needs three reachable public URLs and a reviewer who opens `/` otherwise lands
  in the workspace shell with no policy text anywhere. The pages render without auth and
  without the workspace bundle. `/home` is a separate route; `/` stays the app.
- **`projects.setDetail`** — the mutation `Projects.svelte` already called but which did not
  exist (a regression from the upstream merge). Bounded: 2000 characters of instructions, 20
  relative-path labels, duplicate and traversal-shaped paths refused. It is a label store,
  never a filesystem read. It also joined the ownership audit's pinned function list.
- **BYOK key holder for the SvelteKit route** — `src/lib/byok_key.ts`. It accepts exactly the
  `keySchema` alphabet from `src/lib/server/ai/config.ts`, so `/api/ai/chat` is never handed a
  body it must reject. Module scope only: no `localStorage`, no `sessionStorage`, no URL, no
  log; the key dies with the tab. Chat settings gained the form ("Bring your own key"), including
  provider and model selection from `/api/ai/config`.
- **Memories** — `src/lib/memories.ts` (localStorage, 50 notes × 400 chars), the
  `Memories` view, and a bounded `memory` field on `POST /api/ai/chat`. The server prefixes it as
  a **system** message that says it is untrusted context, matching the `decisionNote` wording in
  `src/convex/chat.ts`. No schema table, no consolidation, no `dual_write` — those need a
  retention decision.
- **Read-only git surface** — `src/lib/server/git.ts`, `GET /api/git`, and the `Repository` view.
  `GIT_SURFACE_ENABLED` + a `GIT_SURFACE_ROOTS` allowlist (absolute paths, `..` refused, cap 8)
  buys `status --porcelain` and `log -n 20` through `execFile` with a fixed argument array. Stage,
  diff, commit and push are deliberately absent: they need a process boundary and an approval
  model this build does not have.

### Fixed

- **The documented 4 MB image budget was unreachable.** `/api/ai/chat` read its body with the
  shared `readJsonBody` default of 64 KiB, so a single realistic screenshot was `413` before
  `acceptImage` ever ran, and `docs/parity-checklist-2026-11-02.md` §3.2 promised "2 images, 4 MB
  each". The chat route now passes `MAX_CHAT_BODY_BYTES` (11 446 960 bytes, derived in
  `src/lib/uploads.ts` from `MAX_IMAGES_PER_TURN × ceil(MAX_IMAGE_BYTES / 3) × 4` plus 256 KiB of
  envelope). No other route's limit moved. `src/lib/server/ai/config.ts` imports the constants
  instead of repeating `4 * 1024 * 1024`, so the schema and the doc cannot drift again. An image
  one byte over 4 MiB is now `413 Each image must be 4 MB or smaller.` instead of being answered
  with the per-turn count, which pointed the caller at the wrong remedy. Measured cost of the
  larger buffer: ~48 MB RSS peak per request at the ceiling; pinned by
  `src/routes/api/ai/chat/budget.spec.ts` (7 tests) including a 50 MB body refused during the read.
- **The SvelteKit BYOK chat path was unreachable.** `Chat.svelte` read a provider key from
  `localStorage.getItem("byok-key")`, which nothing ever wrote and which contradicted
  `docs/byok.md` §1, so `parseChat` rejected every turn. A missing key is now named in the
  composer instead of costing a round trip.

### Changed

- **Sitemap lists three pages, not one.** `sitemapDocument` now emits `/`, `/privacy` and
  `/terms`. A policy nobody can find is not a published policy, so the two legal pages are
  listed; the contract test that pinned a count of one now pins three.
  `src/lib/config/metadata.spec.ts` and `src/routes/contract.spec.ts` both assert it.
- `docs/byok.md` §1 restated as "the browser never **persists** a provider key", with the
  SvelteKit path documented honestly next to the Convex one.
- `docs/PRD.md` §7 and `docs/implementation-plan.md` §10 no longer state that `tests/workspace.e2e.ts`
  and `tests/acceptance.e2e.ts` exist; the correction is in the main text instead of a corrigendum
  that contradicted the paragraph above it.
- Pinned test counts removed from `docs/byok.md` and `docs/progress.md` in favour of the command
  that reports them.
- `svelte/no-navigation-without-resolve` is off for the three legal pages, with the reason in
  `eslint.config.js`: they link mostly to absolute external URLs, and `resolve()` is typed for
  internal SvelteKit routes only.

### Verification

Measured on `98549c9`: `bun run check` and `bun run lint` clean, `bun run test:unit`
107 files / 1294 passed / 3 skipped (1297), `bun run build` ok. The 3 skips are
`src/convex/deployment.spec.ts`, which skips itself when no Convex deployment answers.
Playwright was listed, not run: 178 cases × 3 projects = 534 registered.

## [0.6.0] - 2026-10-29

### Added

- **BYOK backend on Convex**, adapted from `models-rahmanef-com` @ `d211ee2`:
  - `crypto.ts` — AES-256-GCM at rest, `MODELS_ENC_KEY` master key (copied as-is);
  - `credentials.ts` — connect/list/disconnect, host-gated, bounded reads, owner derived from
    the session in every handler;
  - `providers.ts` — 10 built-in providers with a pinned baseURL and a docs URL each;
  - `chat.ts` — the model call with the user's own key, typed `ConvexError`, bounded input;
  - `threads.ts` — sessions, messages and usage counters;
  - `devices.ts` — pairing rows that store only a SHA-256 token hash;
  - `decisions.ts` — the Jev/Laya verdict log, with the model's own limits enforced
    (English-only, one question, ≤8 options, ≤512 state tokens).
- `slices/cloud` — provider manager UI and the engine-availability SSOT, plus `src/lib/cloud/chat.ts`
  as the browser adapter wired once in the root layout.
- `docs/byok.md` — the contract: storage, identity, host gate, manual-key flow, why OAuth is
  not presented, and the two decision-model engines.
- 7 new unit tests for engine availability and the cloud adapter.

### Changed

- Three engines coexist: `local`, `device`, `cloud`. With no `PUBLIC_CONVEX_URL` the cloud
  engine reports `unsupported` and nothing else changes, so local mode is never removed.
- Replaced the starter `notes` table and function set with the product's own schema. The
  `notes` routes redirect to `/`; `src/hooks.spec.ts` follows.
- `src/convex/_generated/api.d.ts` lists the new modules manually: `convex codegen` needs a
  deployment, and `api.js` uses `anyApi`, so runtime is unaffected. Regenerate with
  `bun run convex:dev` once a deployment exists.

### Verification

`tsc --noEmit -p src/convex` clean, `bun run verify` (0 type errors, 66 unit tests),
`bunx playwright test` 12/12 across narrow-mobile/mobile/desktop.

Not verified: a live deployment, a real provider call, a real NPU device — those need
credentials and hardware the template deliberately omits.

## [0.5.0] - 2026-10-29

### Added

- **Full Laya parity.** `src/lib/views/**` (all 21 views, including the 3531-line
  `Chat.svelte`), the 23 components those views compose, the `src/lib/*` helpers and
  `src/app-laya.css` are copied from `rahmanef63/laya-npu` @ `84c1823`. Together with the
  shell from 0.4.0 this is the complete Laya frontend, not a subset.
- The five optional shell contributions are now mounted: `SettingsWindow`,
  `WorkspaceLauncher`, `SiteHeader`, `RuntimeControls` and the menubar contributions.
- `src/lib/http.local.ts`: an in-browser implementation of Laya's API client (`api.*`,
  `get`, `post`, `postAudio`, `headers`, `runtimeFetch`, pairing guards) backed by a local
  session store. This is what lets the real Chat and all 21 views run with zero backend.
  `src/lib/http.ts` re-exports it as the single swap point for a real transport.

### Changed

- Re-copied `slices/workspace-shell/**` and `shared/**` from `84c1823`; the 0.4.0 copy was
  from `9a893b2` and `chat-ui` had since moved inside the shell.
- `.prettierignore` and `eslint.config.js` now name the full vendored set. Laya has no
  linter, so fixing findings upstream is not an available path; the exception is recorded
  as a P1 deviation with the compliant shape at the block.
- `src/lib/index.ts` is an empty namespace entry for the `#lib` alias, which is what keeps
  the copied files byte-identical (no import rewrites).

### Fixed

- Stub response shapes now match what each view reads: `Deps.svelte` needs `packages`,
  `Models.svelte` needs `catalogue.current_model` and `recommendations.hardware.devices`,
  `Corpus.svelte` needs `roots`/`dir`/`files`. Three crashes and one silent fallback found
  in probe runs are gone.
- The composer enables: the stub catalogue publishes the view's default model id
  (`qwen3-npu`), claims the active device, and the backend id is `local:<DEVICE>` so the
  view can derive it.

### Verification

`bun run verify` (0 type errors, 59 unit tests), `bunx playwright test` (12 across
narrow-mobile/mobile/desktop), `bun run test:dev` (4), `DEPLOY_TARGET=node node
scripts/smoke-node.mjs`, and manual render at 1440/768/390 with zero console errors and zero
horizontal overflow.

## [0.4.0] - 2026-10-29

### Changed

- **Rebuilt on the Laya NPU workspace shell.** `slices/workspace-shell/**` and `shared/**`
  are copied verbatim from `rahmanef63/laya-npu` @ `9a893b2`; only the shared import alias
  was rewritten. See [docs/laya-parity.md](docs/laya-parity.md).
- The 0.3.0 from-scratch slices (`app-shell`, `workspace`, `composer`, `workbench`,
  `capabilities`, `settings-surface`, `placeholders`) and their route family are removed.
  Navigation now lives in shell state, so `/workspace`, `/capabilities` and `/settings` no
  longer exist; `/` mounts the workspace.
- Added `slices/chat` (local chat stub behind the shell's contract) and
  `slices/workspace-surface` (registry, local runtime, namespaced persistence, lazy screens).
- `src/routes/layout.css` merges Laya's token and element block alongside the shadcn tokens.
- `eslint.config.js` carries a bounded `TODO(rr)` exception for the two vendored trees so the
  copy stays diffable against upstream. Consumer slices pass the full rule set.
- Product identity, README, CONTRACT, UIUX and docs describe the new shape.

### Verification

`bun run verify` (0 type errors, 59 unit tests), `bunx playwright test` (6 across
narrow-mobile/mobile/desktop), `bun run test:dev` (2), `DEPLOY_TARGET=node node
scripts/smoke-node.mjs`, and manual render at 1440/768/390 with zero console errors and zero
horizontal overflow.

## [0.3.0] - 2026-10-28

### Added

- `tests/acceptance.e2e.ts`: browser proof for AC03, AC05, AC06, AC09, AC11, AC12, AC13,
  AC14, AC15, AC17 and AC18 at 375 / 390 / 1280, so AC01–AC18 are now all browser-verified.
- Local asynchronous stubs that make those flows observable without a backend: attachment
  validation with a real `validating` phase and cancellation, offline submit with request-id
  reuse on retry, cancel-keeps-partial-output, dirty-tab save that can fail and keep the tab
  open, settings saves where the newest revision wins, capability connect with a pending
  phase and revert, and shell overlay Escape with focus return.
- Workbench state persistence through sessionStorage (tabs, active tab, layout, split width).

### Changed

- `workspace-screen.svelte`'s `appendDraft` takes the composer payload and uses its
  `requestId` as the timeline entry id, so a retry appends once instead of twice.
- `resource-body.svelte` exposes its edit surface for any open tab, not only a ready one.

### Fixed

- Offline retry duplicated the user message (AC05).
- A freshly added tab could never become dirty, leaving the AC09 close guard unreachable.
- Leaving the workspace for settings and returning lost the workbench tabs (AC14).

### Evidence

Observed in this working tree: `bun run test:unit` → 26 files, 189 tests passed;
`svelte-check` 0 errors; prettier + eslint + Svelte 5 guard clean.

Browser suites, counts from `tests/` file inspection — **tests defined**, not tests
passed in this docs pass, and multiplied by the configured Playwright projects:

| Spec                      | ACs                                                   | Tests defined | Runs (3 projects) |
| ------------------------- | ----------------------------------------------------- | ------------- | ----------------- |
| `tests/workspace.e2e.ts`  | AC01, AC02, AC04, AC07, AC08, AC10, AC16              | 15            | 45                |
| `tests/acceptance.e2e.ts` | AC03, AC05, AC06, AC09, AC11–AC15, AC17, AC18         | 12            | 36                |
| `tests/dev-smoke.e2e.ts`  | first boot, hydration gate (`test:dev`, desktop only) | 2             | 6                 |

87 Playwright runs in total (`bun x playwright test --list` confirms 87 in 3 files).

AC01–AC18 therefore all have browser coverage; AC15 is covered on both the settings and
the capability catalog surfaces.

## [0.2.0] - 2026-10-28

### Added

- The seven MVP slices, each with a barrel export and co-located specs:
  `placeholders` (`t()` / `tp()` over the token dictionary), `app-shell` (`DESTINATIONS`
  registry, rail, sidebar host, overlay host), `workspace` (unstarted and populated
  primary surfaces), `composer` (draft store, submit guard, attachment validation),
  `workbench` (tabbed secondary region and splitter), `capabilities` (catalog registry and
  connection state) and `settings-surface` (section and field registries).
- The workspace route family: `/workspace`, `/workspace/[chatId]`, `/capabilities`,
  `/capabilities/[slug]` and `/settings/[section]`, with registry validation for capability
  and settings slugs, object-id validation for chats, and 404 boundaries for unknown ids.
- `tests/workspace.e2e.ts` covering the route family and the primary interaction flows at
  390 / 768 / 1440, and `tests/dev-smoke.e2e.ts` covering first boot without credentials and
  hydration-gated controls.

### Changed

- The root route redirects (307) to `/workspace` instead of rendering a landing page.
- Product identity in `src/lib/config/app.ts` is the generic "Placeholder Workspace";
  every visible string still resolves through `slices/placeholders`.
- `--shell-*` design tokens and `.shell-*` layout utilities live in `src/routes/layout.css`
  and are the only styling source for the shell.

### Removed

- The five starter demo slices (`dashboard`, `live-data`, `notes`, `assistant`, `settings`)
  and the `/apps/[slug]` route family that served them.

### Fixed

- `bun run build` no longer depends on the host Node version: the Vercel adapter runtime is
  pinned to `nodejs22.x`.
- `bun run test:dev` had no tests after the starter suite was deleted; the dev-server smoke
  suite is restored.
- The workbench hide and show controls no longer share an accessible name.
- `bun run lint` failed on the vendored `docs/reference/` assets; they are excluded from
  formatting.
- The typed-ESLint spec timed out under the default 5s vitest budget; the server project now
  allows 30s.

### Known gaps

- AC02/AC03 (attachment add/validate), AC05/AC06 (network loss, streaming cancel), AC09
  (dirty-tab discard against a real save), AC11 (overlay Escape return beyond the shell
  host) and AC12/AC13/AC14 (settings/capabilities persistence) are implemented at the
  state/unit level but not browser-verified end to end, because the MVP has no backend.

## [0.1.0] - 2026-10-27

### Added

- Product requirement set for the first (later superseded) placeholder shell:
  `docs/PRD.md`, `docs/implementation-plan.md`, `docs/ui-spec.md`, `docs/state-model.md`,
  `docs/placeholder-copy.md`, `docs/cloud-handoff.md`.
- Reference artifacts under `docs/reference/`: the six-composition prototype and the two
  classification sources it was derived from.

## [0.6.1] - 2026-09-08

- Align Composio setup with the current session-based MCP API and direct-tools preset.
  Keep existing standalone endpoints as a documented legacy migration path.

## [0.6.0] - 2026-09-08

### Added

- Type-aware async/exhaustiveness linting, runtime/slice import boundaries and official
  Convex validator/index/table-ID rules, with executable regression fixtures.
- Optional Google OIDC login, encrypted bounded sessions and owner-scoped Convex notes CRUD.
- Optional BYOK AI chat (OpenAI, Anthropic, Google) and official MCP SDK client/server,
  configured model/tool allowlists, manual execution review and Composio guidance.
- Node adapter and nonroot container target for VPS/Cloud Run deployment.

### Changed

- Override transitive cookie to patched 0.7.2; auth/browser checks cover the compatible API.
- Feature screens load on demand while retaining initial SSR; navigation/data waiting
  use accessible skeletons, render retry boundaries and safe error correlation IDs.
- Agent contract and focused guides cover auth, AI/MCP, typed lint and deployment limits.
- Auth recipe placeholders are replaced by actual Google settings; all new capabilities
  remain off in a clean clone. No provider credentials or private project source is included.

## Unreleased

## 0.5.0 — 2026-09-08

### Added

- A compact session entry point and maintained `CONTRACT.md`, with task-specific context loading and practical Ponytail/Caveman/optional RTK guidance.
- An environment consumer matrix and optional OIDC, GCP and Cloudflare configuration examples; Cloudflare has the same explicit unsupported guard as the auth/GCP recipes.
- Explicit SEO indexing opt-in, optional Google/Bing verification and Twitter/X attribution, plus robots and sitemap endpoints driven by shared settings.
- A development-server browser smoke check in CI alongside production browser coverage.

### Changed

- Design guidance addresses concrete copy, truthful state, accessible controls and context-dependent visual choices. Landing, settings and Convex setup copy reflect actual behavior.
- Removed the unused Svelte Testing Library dependency; browser and existing unit checks remain the verification tools.
- Allowed root feature slices through Vite's development filesystem boundary so their client modules load; unrelated root files remain outside the allowlist.
- Segmented controls and the workspace menu stay disabled until hydration so early keyboard/click input is not silently lost.
- Native disclosures retain an early open state across hydration; removed their unused controlled-state API.
- Updated CI actions for the supported runner runtime, pinned their release commits and disabled persisted checkout credentials.

### Migration notes

- `PUBLIC_SITE_URL` alone no longer enables indexing. Set `PUBLIC_SEO_INDEXABLE=true` for public production indexing; keep previews false.
- Replace the old static robots file with the endpoint. Crawling stays allowed so noindex is readable; sitemap URLs are announced only when indexing is enabled.
- Read `CONTRACT.md` at each new agent session and adapt its product section when generating an application. Optional cloud/auth values are recipes, not installed integrations.

## 0.4.0 — 2026-09-08

### Added

- Public app identity configuration and a shared asset catalog for branding and metadata.
- Eight replaceable SVG/PNG placeholders, a web manifest, asset validation and generated artwork prompts.
- Canonical and social metadata using `PUBLIC_SITE_URL`; unconfigured pages and app examples remain noindex.
- Disabled server transport adapters for basic DOKU Checkout, notification signature verification and Resend email, with mocked HTTP checks.
- Explicit private integration resolution, default provider choices and auth/GCP implementation recipes.
- Canonical design guidance, focused Svelte/Convex practices, an agent startup guide and a reusable PRD with measurable acceptance and operational handoff criteria.

### Changed

- Shared branding, locale and asset references replace duplicated page/shell values.
- The main check command validates generated assets alongside types and version consistency.
- Agent instructions link focused guidance and use cohesive boundaries instead of rigid file-size or library-specific rules.
- Documentation distinguishes implemented transports, mock verification and remaining product lifecycle work.

### Migration notes

- Customize `src/lib/config/app.ts` and `assets.config.ts` together, then regenerate assets and prompts. Mark final artwork `custom` before generation.
- Set the production HTTPS origin through `PUBLIC_SITE_URL`; leave it unset for noindex previews.
- Optional capabilities remain disabled. These adapters add no public callback/order endpoints, durable outbox, authentication or GCP deployment; merchant sandbox and real email lifecycle testing remain product work.
- The base Convex schema stays empty. See [the upgrade guide](docs/releasing.md) when adopting changes in a generated product.

## 0.3.0 — 2026-09-08

### Added

- Public template metadata, MIT license, contributor and security policies, issue/PR templates.
- GitHub CI for locked installs, typecheck, formatting, lint, unit tests, build and browser tests.
- Deployment, architecture, release and new-project guides; an explicit release checklist.
- Version synchronization command and metadata consistency check.
- Deployment key guards to keep Vercel preview and production backends separate.
- Browser metadata, response security headers and keyboard navigation coverage.

### Changed

- Bun pinned to 1.4.2; Node support documented and pinned for CI.
- Dashboard, settings and Convex status read versions from repository metadata.
- Convex status uses generated API types and validates its return value.
- Empty environment example preserves the unlinked first-run experience.
- Preparation errors fail visibly instead of being swallowed.

## 0.2.0 — 2026-08-31

- Existing VPS starter: Svelte 5 Runes, SvelteKit, Bun, shadcn-svelte and optional Convex.
- Root feature slices, registry-driven routes and responsive application shell.
- Dynamic app UI primitives with initial unit and browser coverage.

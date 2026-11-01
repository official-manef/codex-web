# Laya parity — shipped template shape

> **§2 is provenance, not a claim about this tree.** The block lists the 21 views Laya shipped
> at `84c1823`. This tree holds 24 view files with a **different membership** (`6ed1f3e`
> deleted them all; `d52e006` restored a subset; `fa5aa54` deleted two more; `memories`, `git`
> and `automations` were added after). Do not infer today's view set from this block — measure
> it with `ls src/lib/views/*.svelte`. The coincidence that both counts were once 21 is exactly
> why the mismatch went unnoticed for two rebuilds, and it is recorded as unresolved in
> [README.md](README.md) §Unresolved contradictions.

This repository is the shared workspace template. Its UI is `rahmanef63/laya-npu`, copied,
not reimplemented — copied, then repaired where the copy was broken. See §1 for exactly which
files deviate and why. `docs/REBUILD-PLAN-laya-parity.md` is the plan this executed.

## 1. Provenance

| Item              | Value                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Source repository | `rahmanef63/laya-npu`                                                                     |
| Source commit     | **`84c1823`** `test(browser): isolate Linux CI launch and retain startup diagnostics`     |
| Copied shell      | `slices/workspace-shell/**` (shell + 10 shared sub-slices, 2098-line shell)               |
| Copied shared     | `shared/**` (icons, layout math, token source)                                            |
| Copied views      | `src/lib/views/**` — all 21 at source, including the 3531-line `Chat.svelte`              |
| Copied helpers    | the `src/lib/*` modules those views import (`http` excluded), one `ui/checkbox` primitive |
| Copied CSS        | `src/app.css` → `src/app-laya.css`, imported from `src/routes/layout.css`                 |

"Copied" is not "unmodified". Measured file by file against `84c1823`:

| Tree                                   | State                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/**` (5 files)                  | identical after the `$shared` alias rewrite; the rewrite is the only difference                                                                                                                                                                                                                                                                                                                       |
| `slices/workspace-shell/**` (51 files) | identical after the alias rewrite, except four files: `workspace-shell.svelte` (+70 lines: the a11y focus-return repair in [a11y-2026-11-02.md](a11y-2026-11-02.md) §1), `shared/menu/WorkspaceMenubar.svelte` and `shared/menu/menu-items.svelte` (`:focus-visible` outlines, §6), and `labels.ts` (`outputWorkspace` renamed `Output workspace` → `Output panel`, [terminology.md](terminology.md)) |
| `src/lib/views/**`                     | 21 copied, 6 added, every copied file deviated — see §2                                                                                                                                                                                                                                                                                                                                               |
| `src/app-laya.css`                     | 1818 lines against the source's 1820; the two missing lines are the stripped `@import`                                                                                                                                                                                                                                                                                                                |

Rewrites applied uniformly to the copy:

1. `../../../../shared/…` → `$shared/…` (alias; this repo keeps `shared/` at the root).
2. `#lib/utils.js` → `$lib/utils.js` in the copied `ui/checkbox` primitive only, because this
   repo's `src/lib/utils.ts` already exists and is the same function.

Laya was not modified. `src/lib/http.ts` is the one file that is **not** a copy: it is the
template's transport swap point (see §4).

## 2. What the copy contains

> **As copied, not as shipped.** The listing below is the shape at source commit `84c1823`.
> Since then this tree removed `Performance`, `Parameters`, `Corpus`, `Schema` and `Reference`,
> and never had a `Files` or `Browser` view under those names. Do not grep for these nine
> entries; measure the current tree with `ls src/lib/views/*.svelte`. Kept because it is the
> provenance record of what was taken from Laya.

```text
slices/workspace-shell/       shell (2098 lines) + 10 sub-slices
shared/                       icons, workspace-layout math, base.css token source
src/lib/views/                21 views: Chat, Apps, Transcribe, Files, Browser,
                              Models, Overview, Voice, Playground, Snake,
                              Embeddings, Performance, Setup, Compute,
                              Providers, Pricing, Parameters, Faq, Corpus,
                              Schema, Reference
src/lib/*.svelte              23 components those views compose
src/lib/*.ts                  helpers, incl. markdown, snake, workflow_graph, webmcp
src/app-laya.css              Laya's app stylesheet (1818 lines)
```

Consumer-side code this repository owns:

```text
src/routes/+page.svelte       12-line adapter mounting WorkspaceApp
slices/workspace-surface/     composition root
src/lib/registry.ts           feature catalogue (Laya's structure, template identity)
src/lib/workspace_routes.ts   chat panels, menus, labels, appearance, chat UI config
src/lib/workspace_persistence.ts  namespaced passive storage
src/lib/template_runtime_adapter.ts  runtime discovery + selection policy
src/lib/http.local.ts         in-browser transport (see §4)
src/lib/http.ts               re-export swap point
```

## 3. The transport shim

`src/lib/http.local.ts` implements Laya's API client surface — `api.*`, `get`, `post`,
`postAudio`, `headers`, `runtimeFetch`, `isHostedWorkspace`, `runtimeConnection`,
`pairRuntime`, `disconnectRuntime`, `configureEndpoint` — against an in-browser store
instead of a Python server. That is what lets the 3531-line `Chat.svelte` and 21 views run
unmodified with zero backend.

**Real:** navigation, sessions, drafts, attachments, layout, the whole UI, the send →
timeline → reply cycle.

**Stubbed, and each stub says so in its payload (`stub: true`, `reason`):** model inference,
transcription, embeddings, automation, MCP, dependency install, corpus, schema, benchmarks,
workflows, hosted pairing.

Shapes are not guesses: each stub response was matched against what its view actually reads
(`Deps.svelte` needs `packages`, `Models.svelte` needs `catalogue.current_model` and
`recommendations.hardware.devices`, `Corpus.svelte` needs `roots`/`dir`/`files`). Two of the
shell's own expectations also had to be honoured or the composer stays inert forever:
the default model id is `qwen3-npu`, and the backend id must be `local:<DEVICE>` so the
view can derive the active device.

To become backend-connected, replace the body of `src/lib/http.ts`. Call sites never move.

## 4. Deliberate deviations from Laya

| Area        | Here                                      | Laya                      | Why                                                         |
| ----------- | ----------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| Transport   | in-browser store (`http.local.ts`)        | Python/OpenVINO server    | Zero-backend template                                       |
| Hosted gate | omitted (`hostedGate` not passed)         | Laya gates hosted pairing | Nothing to pair with                                        |
| Integration | omitted (`installIntegration` not passed) | WebMCP page tools         | No executor to expose                                       |
| Terminal    | `src/lib/views/Terminal.svelte` (added)   | no terminal output        | Client half of a device bridge; see [terminal](terminal.md) |
| Identity    | `Workspace Template`, template repo link  | Laya NPU                  | Product-owned                                               |
| Lint/format | bounded exceptions for vendored trees     | no linter at all          | See §6                                                      |

Everything else is Laya's: rail, sidebar, launcher, menubar, settings window, runtime
controls, comparison tabs, approval selector, browser toolbar, all 21 views.

Omitted props are not mounted by the shell, so the omissions cost nothing and add no dead
branches.

## 5. Re-syncing with Laya later

```bash
git -C ~/projects/laya-npu-clean log --oneline -1     # record the SHA in §1

rm -rf slices/workspace-shell shared src/lib/views
cp -r ~/projects/laya-npu-clean/slices/workspace-shell slices/
cp -r ~/projects/laya-npu-clean/shared .
cp -r ~/projects/laya-npu-clean/src/lib/views src/lib/
cp ~/projects/laya-npu-clean/src/lib/*.svelte src/lib/
cp ~/projects/laya-npu-clean/src/lib/*.ts src/lib/            # then restore http.ts + http.local.ts
cp ~/projects/laya-npu-clean/src/app.css src/app-laya.css     # strip its @import line
grep -rl '\.\./\.\./\.\./\.\./shared' slices shared src/lib | xargs sed -i 's|\.\./\.\./\.\./\.\./shared|$shared|g'

bun run verify && bunx playwright test && bun run test:dev \
  && DEPLOY_TARGET=node node scripts/smoke-node.mjs
```

If a re-copy breaks the consumer, fix it in `workspace-surface` / `workspace_routes.ts` /
`http.local.ts`, never in the copied trees. Patching the copy forks it.

## 6. Lint and format posture for the vendored trees

Laya has **no linter**: its `package.json` has no ESLint dependency and no `lint` script. So
"fix the findings upstream and re-copy" is not an available path, and adopting a stricter
rule set here would fork 45 files.

- `eslint.config.js` disables a bounded list of rules for the vendored paths only, with the
  reasoning and the compliant shape written at the block.
- `.prettierignore` excludes the same paths, because Laya's style is 2-space/double-quote.
- Consumer code — `src/routes/**`, `slices/workspace-surface/**`, `src/lib/http.local.ts`,
  `src/lib/registry.ts`, `src/lib/workspace_*.ts`, `src/lib/template_*.ts` — is **not**
  covered and passes the full rule set.

This is a recorded P1 deviation, not an oversight.

## 7. Evidence

Recorded 2026-10-29 on this repository. **Dated observation, not current** — gate numbers live
in [progress.md](progress.md) §Gates. Kept because it is what the copy was accepted on.

| Check         | Command                                          | Result                                           |
| ------------- | ------------------------------------------------ | ------------------------------------------------ |
| Types         | `bun run check`                                  | 0 errors, 0 warnings                             |
| Lint          | `bun run lint`                                   | prettier + eslint + Svelte-5 guard clean         |
| Unit          | `bun run test:unit`                              | 59 passed                                        |
| Build         | `bun run build`                                  | ok (Vercel adapter, `nodejs22.x` pinned)         |
| Browser       | `bunx playwright test`                           | 12 passed (narrow-mobile/mobile/desktop)         |
| Dev hydration | `bun run test:dev`                               | 4 passed                                         |
| Node smoke    | `DEPLOY_TARGET=node node scripts/smoke-node.mjs` | routes, noindex, disabled capabilities ok        |
| Manual        | 1440×900 / 768×1024 / 390×844                    | renders, 0 console errors, 0 horizontal overflow |

Browser-verified flows: shell hydration, send → timeline → stub reply, settings
destinations opening the settings window (not the primary region) with Escape closing it,
rail navigation to a lazily loaded view, no horizontal overflow at all three widths.

Not verified: model inference, transcription, embeddings, automation, MCP, hosted pairing
(no backend exists), every resize bound, and the full keyboard matrix beyond Escape/focus
return.

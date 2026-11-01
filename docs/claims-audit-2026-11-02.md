# Claims audit — 2026-11-02

Mechanical verification of every checkable factual claim in the `current` documents listed in
[README.md](README.md). Purpose: the same session found a document asserting a `src/lib/byok_key.ts`
that "does not exist" while the file was on disk, a `notes` table documented in three files after
its deletion, and a gate count that had not been re-run since three features landed. This file
records what was checked, how, and what was wrong.

Audited tree: `337850c`, 2026-11-02. Every number below was produced on that commit, not copied
from another document.

## Method

1. Extract every checkable claim from the `current` files: a path, a symbol, a count, a route, an
   env var, a command, a test count, or a capability stated as working.
2. Verify with the cheapest tool that can falsify it: `ls`, `grep`, a `node -e` parse of the real
   source, or running the command.
3. Anything that cannot be settled without credentials or hardware is marked `unverifiable`, not
   assumed true.

Gate commands were run, not quoted:

```
npx vitest run                     50 files / 441 passed / 3 skipped
npx prettier --check .             clean
npx eslint .                       clean
npx svelte-check                   0 errors, 0 warnings
npx tsc --noEmit -p src/convex     clean
npx playwright test --workers=1    102 passed
bash scripts/secret-scan.sh        exit 0
```

`--workers=1` was required: at the default worker count Playwright's own `webServer` is torn down
while other workers are still navigating, and 77 of 102 tests fail with
`net::ERR_CONNECTION_REFUSED`. That is environmental, not an app defect, but it means "playwright
passes" is only true single-worker on this host.

## Wrong claims, and what was corrected

Twenty-one. Each was wrong against `337850c`, and each source file was edited in this pass.

| #   | Where                             | Claim as written                                                                              | Measured                                                                                                                                                                                                                                                                   | Fix                                                                                            |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | `progress.md` §Gates              | `36 files / 197 passed / 3 skipped` on `dff55b3`                                              | `50 files / 441 passed / 3 skipped` on `337850c`; 36 was the file count at `dff55b3`                                                                                                                                                                                       | Re-measured, commit named                                                                      |
| 2   | `README.md` §Unresolved           | `registry.ts` holds **25** ids (18 `SECTIONS`, 7 `CHAT_OUTPUTS`)                              | **28** ids (21 `SECTIONS`, 7 `CHAT_OUTPUTS`)                                                                                                                                                                                                                               | Corrected; the four-document table kept                                                        |
| 3   | `README.md` §Unresolved           | `src/lib/views/` holds **21** files                                                           | **24**                                                                                                                                                                                                                                                                     | Corrected                                                                                      |
| 4   | `README.md` §Resolved             | "Measured now: **36 files / 197 passed / 3 skipped**"                                         | `50 / 441 / 3`                                                                                                                                                                                                                                                             | Corrected, points at progress.md                                                               |
| 5   | `view-audit` header               | `registry.ts` holds 25 ids, stated as current                                                 | 28 ids on `337850c`; 25 was correct only at `dff55b3`                                                                                                                                                                                                                      | Header now names both commits                                                                  |
| 6   | `progress.md` §Terminal bridge    | `src/lib/runtime/terminal_buffer.ts`                                                          | `src/lib/terminal_buffer.ts` — not under `runtime/`                                                                                                                                                                                                                        | Path corrected                                                                                 |
| 7   | `progress.md` §Where we are       | Chat surface evidence: `slices/chat`                                                          | No `slices/chat`; `ls slices/` returns `cloud`, `workspace-shell`, `workspace-surface`                                                                                                                                                                                     | Points at `slices/workspace-shell/shared/chat-ui`                                              |
| 8   | `progress.md` §Where we are       | Outbound MCP client: `src/lib/cloud/mcp.ts`                                                   | That file is the **browser adapter for per-user Convex MCP**. The operator allowlist client is `src/lib/server/mcp/client.ts`                                                                                                                                              | Both named and distinguished                                                                   |
| 9   | `laya-parity.md` §1               | Vendored trees are "**byte-identical** to `rahmanef63/laya-npu` @ `84c1823`"                  | 0 of 51 files under `slices/workspace-shell/**` and 0 of 5 under `shared/**` are byte-identical. `shared/**` is identical after alias rewriting; `workspace-shell.svelte` carries 70 changed lines beyond the alias, plus two `:focus-visible` blocks and one label rename | Replaced with a per-tree table naming what deviates and why                                    |
| 10  | `security-review` §byok_key       | "`src/lib/byok_key.ts` **does not exist**; the equivalent path is `byok_input.ts`"            | `src/lib/byok_key.ts` **exists** (1,762 bytes) and exports `readProviderKey`, `saveProviderKey`, `clearProviderKey`, `hasProviderKey`. `byok_input.ts` also exports `readProviderKey` — two modules, one name                                                              | Finding retracted with a dated correction; duplicate export recorded as an open item           |
| 11  | `auth.md` §Private Convex example | `src/convex/notes.ts` implements `list/create/update/remove`; walkthrough opens `/apps/notes` | `notes.ts`, the `notes` table and the whole `/apps/*` family were **deleted** in `023aa02`. `src/convex/notes.ts` exists in no commit on this branch                                                                                                                       | Rewritten against `memories.ts` + `projects.ts`, with a dated correction note                  |
| 12  | `architecture.md` §Convex         | "The `notes` table stores bounded private notes"                                              | No `notes` table in `src/convex/schema.ts` (13 tables, none named `notes`)                                                                                                                                                                                                 | Corrected to `memories`/`projects`, deletion named                                             |
| 13  | `convex-best-practices.md`        | "`notes` table and CRUD functions require verified identity and indexed ownership"            | Same deletion; the rule holds, the table name does not                                                                                                                                                                                                                     | Points at `memories`/`projects`                                                                |
| 14  | `integrations.md` opening         | "Google auth/private notes and BYOK AI/MCP are implemented"                                   | `notes` is gone; owner-scoped private data is `memories`/`projects`                                                                                                                                                                                                        | Reworded                                                                                       |
| 15  | `ai-mcp.md` opener + §Enable chat | `/apps/assistant` contains real provider chat; "open the Assistant screen"                    | No `src/routes/apps/**` exists. BYOK chat is the main Chat surface via `src/lib/chat_dispatch.ts`; the MCP panel is `#tools` → `ToolsSettings.svelte`                                                                                                                      | Corrected, with a note naming the deleted family                                               |
| 16  | `parity-checklist` §1.5           | Score "parity 8, partial 9, gap 20, n/a 5"                                                    | Recount of the table's own 40 verdict rows: **parity 9, partial 5, gap 21, n/a-blocked 5**. Three of four columns were wrong                                                                                                                                               | Score replaced with a per-section table                                                        |
| 17  | `parity-checklist` §1.4           | `Secret scan` = **gap**; "absent (relies on `.gitignore` + review)"                           | `scripts/secret-scan.sh` exists and exits 0, with a `--staged` mode                                                                                                                                                                                                        | Row set to `parity`                                                                            |
| 18  | `parity-checklist` §5             | `bunx playwright test # 390 / 768 / 1440`                                                     | Projects are `narrow-mobile` (iPhone SE), `mobile` (iPhone 13), `desktop` (Desktop Chrome); 102 tests                                                                                                                                                                      | Command comment corrected                                                                      |
| 19  | `gate.md` line 3 and §Adding CI   | "There is no CI in this repository"; "There is deliberately no `.github/workflows/gate.yml`"  | `.github/workflows/ci.yml` exists since `f184e49` and runs `bun run verify`, e2e, dev-smoke and a Node smoke. What is absent is a workflow running `bin/gate`                                                                                                              | Narrowed to what is true: CI exists; a _gate_ workflow does not, because the gate needs Convex |
| 20  | `gate.md` §Known flake            | Default-worker Playwright "failed in 2 of 4 runs", framed as an AC17 flake only               | On `337850c`, 77 of 102 tests fail at default workers with `ERR_CONNECTION_REFUSED`; `--workers=1` passes 102/102. Broader than AC17                                                                                                                                       | Wider failure and its two honest fixes added                                                   |
| 21  | `laya-parity.md` §7               | Evidence table presented as current ("Unit 59 passed", "Browser 12 passed")                   | Dated 2026-10-29 observations, three rebuilds old                                                                                                                                                                                                                          | Headed as a dated observation pointing at progress.md §Gates                                   |
| 22  | `README.md` index                 | Six living docs reachable from no row; eight "Updated" cells disagree with `git log`          | `a11y`, `gate`, `parity-checklist`, `security-review`, `terminology` unindexed; 8 dates stale                                                                                                                                                                              | Rows added; dates set from `git log -1 --format=%cs`                                           |
| 23  | `progress.md` + `README.md`       | `terminal-bridge.spec.ts` holds **six** tests                                                 | **Ten** — the security review added four                                                                                                                                                                                                                                   | Both corrected                                                                                 |

Claim 10 is the exact failure this audit exists to catch: a review asserted a file's absence, and
the file had been added by a commit (`1ab435b`) already an ancestor of the branch the review was
written on. Claims 11–14 are the same shape one step worse: a whole table and its module were
deleted, and four documents went on describing them.

## Counts, verified

| Claim                                                                          | File:line                     | Verdict  | Evidence                                                                                                              |
| ------------------------------------------------------------------------------ | ----------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `SECTIONS` holds 21 ids                                                        | `src/lib/registry.ts:43`      | verified | parsed from source: `chat … automations`                                                                              |
| `CHAT_OUTPUTS` holds 7 ids                                                     | `src/lib/registry.ts:225`     | verified | `chat-tools, chat-settings, chat-session, workspace-home, files, browser, terminal`                                   |
| 24 view files under `src/lib/views/`                                           | `src/lib/views/`              | verified | `ls *.svelte \| wc -l` = 24                                                                                           |
| 23 registry entries carry a `loadScreen`; `Chat` is the only view without one  | `src/lib/registry.ts`         | verified | script cross-check: every loader target exists, `Chat` referenced by no loader                                        |
| 25 `src/lib/*.svelte` components                                               | `src/lib/`                    | verified | `ls src/lib/*.svelte \| wc -l` = 25                                                                                   |
| `laya-npu` @ `84c1823` has 21 views, 23 `src/lib/*.svelte`, a 2,098-line shell | `laya-parity.md` §2           | verified | same counts read from that commit in `~/projects/laya-npu-clean`                                                      |
| 10 shared sub-slices under `slices/workspace-shell/shared/`                    | `laya-parity.md` §1           | verified | `approval-mode, browser-toolbar, chat-ui, effort, feature-registry, launcher, menu, navigation, output-tabs, runtime` |
| `Chat.svelte` is 3,983 lines here / 3,531 at source                            | `laya-parity.md` §1, §3       | verified | `wc -l`; `git show 84c1823:src/lib/views/Chat.svelte \| wc -l`                                                        |
| `src/app-laya.css` is 1,818 lines                                              | `laya-parity.md` §2           | verified | `wc -l` = 1,818; source `app.css` is 1,820, the 2 missing lines are the stripped `@import`                            |
| 8 asset placeholders generated                                                 | `assets.md` line 24           | verified | `static/brand/manifest.json` lists 8 keys                                                                             |
| `AI_MODELS_JSON` accepts exactly 4 provider keys                               | `ai-mcp.md`, `environment.md` | verified | `src/lib/server/ai/config.ts:9-14`                                                                                    |
| Convex `PROVIDERS` holds 11 entries                                            | `progress.md`, `byok.md`      | verified | 11 keys, including `ollama-cloud` and `nine-router`                                                                   |
| SvelteKit path serves 4 providers                                              | `progress.md`, `byok.md`      | verified | `['openai','anthropic','google','nine-router']`                                                                       |
| `projects.spec.ts` contains 10 tests                                           | `view-audit` follow-up        | verified | `test(` count = 10                                                                                                    |
| `registry.spec.ts` contains 6 tests                                            | `view-audit`                  | verified | `test(` count = 6                                                                                                     |

## Routes, verified

| Claim                                                        | Verdict  | Evidence                                                                      |
| ------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------- |
| Only SvelteKit page route is `/`                             | verified | `find src/routes -name '+page.svelte'` → `src/routes/+page.svelte` only       |
| No `/apps/*` route exists                                    | verified | `ls src/routes/apps` → no such directory                                      |
| `/api/mcp/server` exposes exactly one tool, `starter_status` | verified | `src/lib/server/mcp/server.ts:9`                                              |
| `/api/manef/*` forwards exactly three paths                  | verified | route table: `/api/modules` (GET), `/ready` (GET), `/api/plan` (POST)         |
| `/api/git` supports GET + POST with a closed action union    | verified | `src/routes/api/git/+server.ts` exports `GET` and `POST`                      |
| `/auth/login` returns 404 when `AUTH_ENABLED` is not `true`  | verified | `src/lib/server/auth/session.ts:41` → `error(404, 'Sign-in is not enabled.')` |
| The `#performance` and `#parameters` destinations are gone   | verified | `grep -rn performance src/lib/registry.ts` → no match                         |

## Env vars, verified

Every setting named in `environment.md` was cross-checked against `.env.example` (44 keys) and
against the identifiers the code actually reads.

| Claim                                                                           | Verdict  | Evidence                                                          |
| ------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- |
| `.env.example` lists the public settings it claims                              | verified | all 7 `PUBLIC_*` values present                                   |
| `AUTH_ISSUER_URL` / `AUTH_AUDIENCE` are removed (env.md line 45)                | verified | absent from `.env.example` and from every env read                |
| `LOG_LEVEL` unset writes nothing                                                | verified | `src/lib/server/log.ts` gates on the four level names             |
| `GIT_POLICY_JSON` empty or malformed denies every write                         | verified | `src/lib/server/policy.ts:48-49` seeds `deny` for every verb      |
| `AI_POLICY_JSON` covers `read_file`/`write_file`/`apply_patch`/`exec`/`mcp_app` | verified | `POLICY_VERBS` holds exactly those 9 verbs, including 4 git ones  |
| `BRIDGE_*` is the complete bridge env surface                                   | verified | the bridge reads exactly 7 `BRIDGE_*` vars, all documented        |
| `MCP_SERVER_TOKEN` is bounded 32..4096                                          | verified | `+server.ts:19`                                                   |
| `MODELS_ENC_KEY` is base64 of 32 bytes, AES-256-GCM                             | verified | `src/convex/crypto.ts`, `openssl rand -base64 32` in the examples |

## Commands, run not quoted

| Command                                               | Verdict     | Evidence                                                                              |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `bash scripts/secret-scan.sh` exits 0                 | verified    | run: exit 0                                                                           |
| `npx prettier --check .` is clean                     | verified    | run: exit 0                                                                           |
| `npx eslint .` is clean                               | verified    | run: exit 0                                                                           |
| `npx svelte-check` reports 0/0                        | verified    | run: `0 errors, 0 warnings`                                                           |
| `npx tsc --noEmit -p src/convex` is clean             | verified    | run: exit 0                                                                           |
| `node scripts/install.mjs --dry-run …` writes nothing | verified    | run: prints plan, writes no file                                                      |
| `npx vitest run` → 3 skips, all `deployment.spec.ts`  | verified    | run: exactly those three, reason names `127.0.0.1:3210`                               |
| `npx playwright test` passes                          | **partial** | 102 passed at `--workers=1`; at default workers 77 fail with `ERR_CONNECTION_REFUSED` |

## Capabilities stated as working, with their test

| Capability                                            | Stated in                  | Verdict  | Evidence                                                                                   |
| ----------------------------------------------------- | -------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Terminal bridge, both halves                          | `terminal.md`              | verified | `terminal.spec.ts` (10 tests) + `terminal-bridge.spec.ts` (10 tests)                       |
| Bridge clamps resize to 500×300                       | `terminal.md`              | verified | `bridge/terminal-bridge.mjs:235-236`                                                       |
| Client buffer caps at 200,000 chars                   | `terminal.md`              | verified | `MAX_OUTPUT_CHARS = 200_000` in `src/lib/terminal_buffer.ts`                               |
| Client rejects a `public` endpoint on non-https       | `terminal.md`              | verified | `src/lib/views/Terminal.svelte:224`                                                        |
| Resize debounce 150 ms, min 20×5                      | `terminal.md`              | verified | `RESIZE_DELAY_MS = 150`, `MIN_COLS = 20`, `MIN_ROWS = 5`                                   |
| MCP approval TTL 120 s, 16 connections/owner          | `ai-mcp.md` §Per-user      | verified | `APPROVAL_TTL_MS = 120_000`, `MAX_CONNECTIONS = 16`                                        |
| MCP discovery: 8 pages, 128 tools, 15 s, 2 MiB        | `ai-mcp.md`                | verified | `client.ts:84,87,26,50`                                                                    |
| Burst limiter 20/min, 1,024 buckets                   | `ai-mcp.md`                | verified | `src/lib/server/access.ts:35,38`                                                           |
| Chat bounded to 16 msgs / 32k chars / 8k per user msg | `ai-mcp.md`                | verified | `src/lib/server/ai/config.ts:52,74,142`                                                    |
| 60-second AI deadline, no retries                     | `architecture.md`          | verified | `src/lib/server/ai/chat.ts:67`                                                             |
| Tool loop bounded to 8 steps                          | `parity-checklist` §6      | verified | `src/lib/server/ai/chat.ts:162`                                                            |
| Images: at most 2 per request, 4 MiB each             | `parity-checklist` §6      | verified | `config.ts:88`, `:44`                                                                      |
| Automations: 20 cap, 3 failures, 15-min floor         | `parity-checklist` §6      | verified | `src/lib/automations.ts:1-6`                                                               |
| Memories: 50 cap, 400 chars                           | `auth.md`                  | verified | `src/lib/memories.ts:26-27`; the Convex table enforces the same                            |
| Policy gate covers 9 verbs, deny by default           | `parity-checklist` §6      | verified | `POLICY_VERBS` = 9                                                                         |
| Git write verbs behind `GIT_POLICY_JSON`              | `progress.md` §Not started | verified | `gitDiff`/`gitStage`/`gitCommit`/`gitWorktree{List,Add,Remove}` in `src/lib/server/git.ts` |

## README index, verified

| Claim                                                | Verdict             | Evidence                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every `current` document is listed in the index      | **was wrong**       | Six living documents were reachable from no row: `a11y`, `gate`, `parity-checklist`, `security-review`, `terminology`, and `README.md` itself. Rows added                 |
| "Updated" is `git log -1 --format=%cs` for the file  | **was wrong for 8** | `laya-parity`, `terminal`, `byok`, `environment`, `ui-spec`, `state-model`, `placeholder-copy`, `cloud-handoff` said October while their last commit is 2026-11-02. Fixed |
| `docs/reference/` holds the prototype HTML + 2 JSONs | verified            | exactly those three files                                                                                                                                                 |

## Claim families deliberately left alone

- **History sections.** `progress.md` §Correction, `handover-2026-11-01.md` and the "superseded"
  files are records of what a session believed. Correcting them would destroy the only evidence
  of how a stale claim survived. They are labelled and point at the authority.
- **`laya-parity.md` §2.** The view listing is provenance for `84c1823`. It is now labelled as
  such in three places, including its own header, rather than rewritten.
- **`handover-2026-11-01.md`.** Historical. Its numbers are wrong and stay wrong; the README
  already says each repo's copy is authoritative only for its own gates.

## Unverifiable without credentials or hardware

Stated as a limit, not as a pass:

1. **Every Convex write path against a real deployment.** The local deployment on
   `127.0.0.1:3210` answers but has zero functions pushed, so `deployment.spec.ts` skips its three
   auth assertions with a named reason. `store.spec.ts` proves owner scoping against
   `convex-test`'s in-memory deployment — real handlers, real code — but not a deployed backend.
   **The auth boundary stays unproven**, exactly as `progress.md` says.
2. **Any real provider call.** Every AI/MCP spec runs against mocked streams and HTTP. No paid
   generation, no live 9router gateway, no Composio account was exercised.
3. **Google OIDC end to end.** The specs drive the real `openid-client` against a mocked
   discovery/JWKS transport with signed test keys. No consent screen, no deployed multi-account
   test.
4. **A real terminal bridge on a paired device.** The bridge is spawned locally and spoken to over
   a socket, which is a strong test; the SSH tunnel, `tailscale serve` and `tailscale funnel`
   topologies in `terminal.md` §"Three transports" remain unrun, and the doc says so.
5. **`apply_patch`/`exec` driven by a model.** The loop, its caps and its refusal path are tested;
   no execution dependency is wired, so a tool call ends in a policy refusal. Claimed as such in
   `parity-checklist` §6.
6. **Desktop-side parity measurements.** `chatgpt-desktop-parity-windows.md`,
   `rea-rust-binaries.md` and the desktop column of `parity-checklist` describe a Windows host and
   a Rust binary this worktree cannot reach. Unchanged and unverified here.
7. **`npx playwright test` at default worker count.** Passes single-worker; fails at default for a
   `webServer`-lifetime reason, not an app reason. Recorded in `gate.md` with both fixes named.

## What this audit does not resolve

- The "unresolved contradictions" in `README.md` §Unresolved stay unresolved. This pass
  re-measured their numbers so the table's last column is true; it did not decide which document
  wins, because that needs history the branch does not have.
- `laya-parity.md` §2 still lists a view set this tree does not contain. It is provenance, now
  labelled as such.
- Two modules export `readProviderKey` (`src/lib/byok_key.ts` and `src/lib/byok_input.ts`);
  `Chat.svelte` imports the `byok_input` one. A live duplicate, recorded here rather than fixed in
  a docs-only change.
- `bin/gate`'s `playwright` step will report `FAIL` at default workers for the webServer reason
  above. Changing that is a `playwright.config.ts` decision, not a docs one.

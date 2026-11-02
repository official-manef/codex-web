# docs index

This repository has more documentation than code. Read this page before any other file in
`docs/`; it says which document is current, which is a record of a past session, and which
describes a structure that no longer exists.

Rule that keeps this page honest: **one fact, one home.** Where two documents state the same
number or the same verdict, the one listed under "Source of truth" below wins and the other
should point at it rather than repeat it. Three files restating one claim at three different
times is how `138 passed (27 files)` outlived two route rebuilds.

Last verified against the tree: `98549c9`, 2026-11-02. Numbers on this page were re-measured on
that commit; a number copied from another document is a number nobody checked.

## Start here

| If you need…                             | Read                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| What this build actually is right now    | [architecture.md](architecture.md)                               |
| Whether a gate passes                    | [progress.md](progress.md)                                       |
| Whether an acceptance criterion is met   | [ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md)           |
| Which screen is real and which is not    | [view-audit-2026-11-01.md](view-audit-2026-11-01.md)             |
| Whether a screen is reachable and honest | [surface-coverage-2026-11-02.md](surface-coverage-2026-11-02.md) |
| Where the shell came from                | [laya-parity.md](laya-parity.md)                                 |
| Product scope and the AC bar             | [PRD.md](PRD.md) §5                                              |
| Which env var does what                  | [environment.md](environment.md)                                 |
| How to run, build and release            | [deployment.md](deployment.md), [CHECKLIST.md](../CHECKLIST.md)  |

## Index

Status meanings:

- **current** — describes the code as it is on `597fdaf`. Safe to rely on.
- **historical** — a record of one session or decision at a date. Not maintained. Useful for
  "why is it like this", not for "what is it now".
- **superseded** — describes a structure that has been deleted. Kept because the decision and
  its reasoning are still the historical record. Do not implement from it.

"Updated" is `git log -1 --format=%cs` for the file: the last commit that touched it, which
is not always the last time its content was true.

| File                                                                   | Purpose                                                          | Updated    | Status     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- | ---------- |
| [README.md](README.md)                                                 | This page: what is current, and the one home per fact            | 2026-11-02 | current    |
| [architecture.md](architecture.md)                                     | Boundaries, module map, source-of-truth table                    | 2026-11-02 | current    |
| [progress.md](progress.md)                                             | Living status, gate numbers, known-unproven claims               | 2026-11-02 | current    |
| [gate.md](gate.md)                                                     | `bin/gate`, its three verdicts and what each step does not prove | 2026-11-02 | current    |
| [ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md)                 | AC01–AC18 verdict per criterion against the live app             | 2026-11-02 | current    |
| [view-audit-2026-11-01.md](view-audit-2026-11-01.md)                   | Every registry id classified real/partial/stub/guess             | 2026-11-02 | current    |
| [parity-checklist-2026-11-02.md](parity-checklist-2026-11-02.md)       | Desktop-vs-web capability matrix and the migration phases        | 2026-11-02 | current    |
| [claims-audit-2026-11-02.md](claims-audit-2026-11-02.md)               | Every checkable claim in these docs, verified or marked wrong    | 2026-11-02 | current    |
| [surface-coverage-2026-11-02.md](surface-coverage-2026-11-02.md)       | Every registry id walked in a browser: reachable/named/honest    | 2026-11-02 | current    |
| [a11y-2026-11-02.md](a11y-2026-11-02.md)                               | Accessibility defects found, fixed, and deliberately not fixed   | 2026-11-02 | current    |
| [responsive-2026-11-02.md](responsive-2026-11-02.md)                   | Breakpoint × surface overflow matrix, tap targets, drawer        | 2026-11-02 | current    |
| [runtime-perf-2026-11-02.md](runtime-perf-2026-11-02.md)               | Measured runtime cost of a 500-turn chat and the three fixes     | 2026-11-02 | current    |
| [edge-cases-2026-11-02.md](edge-cases-2026-11-02.md)                   | Adversarial pass: 46 inputs, 19 fixed rows from 12 root causes   | 2026-11-02 | current    |
| [api-contract-2026-11-02.md](api-contract-2026-11-02.md)               | Every HTTP route's failure status codes and body shapes          | 2026-11-02 | current    |
| [csp.md](csp.md)                                                       | The enforced CSP, its three relaxations and what each one costs  | 2026-11-02 | current    |
| [coverage-2026-11-02.md](coverage-2026-11-02.md)                       | Line/branch coverage before and after, and the gaps left open    | 2026-11-02 | current    |
| [security-review-2026-11-02.md](security-review-2026-11-02.md)         | Trust-boundary review of routes, Convex, bridge, key handling    | 2026-11-02 | current    |
| [convex-local-setup.md](convex-local-setup.md)                         | Reproducible local Convex deployment, and the two traps          | 2026-11-02 | current    |
| [terminology.md](terminology.md)                                       | One term per concept, and the strings tests hold in place        | 2026-11-02 | current    |
| [laya-parity.md](laya-parity.md)                                       | Provenance of the vendored Laya shell, deliberate deviations     | 2026-11-02 | current    |
| [terminal.md](terminal.md)                                             | Terminal panel client + the bridge contract and reference bridge | 2026-11-02 | current    |
| [byok.md](byok.md)                                                     | Three engines, the never-hold-a-key rule, Jev boundary           | 2026-11-02 | current    |
| [auth.md](auth.md)                                                     | Optional Google OIDC, private notes, auth boundary proof         | 2026-11-02 | current    |
| [ai-mcp.md](ai-mcp.md)                                                 | Optional BYOK chat routes and the MCP client/server panels       | 2026-11-02 | current    |
| [integrations.md](integrations.md)                                     | Payment/email transport adapters, boundaries                     | 2026-11-02 | current    |
| [deployment.md](deployment.md)                                         | Vercel vs Node targets, build selection, host requirements       | 2026-11-01 | current    |
| [environment.md](environment.md)                                       | Every env var, default, and its actual consumer                  | 2026-11-02 | current    |
| [assets.md](assets.md)                                                 | Brand identity, asset paths, placeholder/custom status           | 2026-09-08 | current    |
| [assets-prompts.md](assets-prompts.md)                                 | Generated image briefs (`bun run assets:prompts`)                | 2026-10-29 | current    |
| [linting.md](linting.md)                                               | What prettier/eslint/Svelte-5 guard enforce                      | 2026-09-08 | current    |
| [releasing.md](releasing.md)                                           | Version bump, changelog, release gates                           | 2026-09-08 | current    |
| [svelte-best-practices.md](svelte-best-practices.md)                   | Svelte 5 / SvelteKit rules for this repo                         | 2026-09-08 | current    |
| [convex-best-practices.md](convex-best-practices.md)                   | Schema, validators, visibility rules                             | 2026-11-02 | current    |
| [agent-start.md](agent-start.md)                                       | Entry procedure for an agent starting or resuming work           | 2026-09-08 | current    |
| [agent-workflow.md](agent-workflow.md)                                 | Worktree inspection, update style, verification                  | 2026-09-08 | current    |
| [prd-template.md](prd-template.md)                                     | Blank PRD to copy for a new product                              | 2026-09-08 | current    |
| [rea-rust-binaries.md](rea-rust-binaries.md)                           | Static analysis of the shipped `codex.exe` string table          | 2026-11-01 | current    |
| [chatgpt-desktop-parity-windows.md](chatgpt-desktop-parity-windows.md) | What was measured on a Windows host that has the app             | 2026-10-30 | current    |
| [reference/](reference/)                                               | Vendored spec inputs: prototype HTML + 2 classification JSONs    | 2026-09-08 | current    |
| [PRD.md](PRD.md)                                                       | Scope, acceptance criteria AC01–AC18, milestones                 | 2026-11-02 | mixed †    |
| [REBUILD-PLAN-laya-parity.md](REBUILD-PLAN-laya-parity.md)             | The plan that replaced the 0.3.0 shell (executed 2026-10-29)     | 2026-10-29 | historical |
| [handover-2026-11-01.md](handover-2026-11-01.md)                       | Private cross-repo session handover                              | 2026-11-02 | historical |
| [chatgpt-desktop-parity.md](chatgpt-desktop-parity.md)                 | Parity scope brief written without the app present               | 2026-10-30 | historical |
| [implementation-plan.md](implementation-plan.md)                       | Build order, paths and exit checks for the 0.3.0 shell           | 2026-11-02 | superseded |
| [ui-spec.md](ui-spec.md)                                               | Region hierarchy, tokens, responsive and focus contract          | 2026-11-02 | superseded |
| [state-model.md](state-model.md)                                       | Ten state axes, transitions, persistence, races                  | 2026-11-02 | superseded |
| [placeholder-copy.md](placeholder-copy.md)                             | Copy token contract and the `t()` resolver                       | 2026-11-02 | superseded |
| [cloud-handoff.md](cloud-handoff.md)                                   | Cloud start guide for the 0.3.0 shell and its route family       | 2026-11-02 | superseded |

† **PRD.md is mixed.** §5 (AC01–AC18) is the live acceptance bar and should not be rewritten
to match whatever currently passes — a bar that moves to meet the code measures nothing. §3.1
and §7 still name the `/workspace`, `/capabilities` and `/settings` route family that
`6ed1f3e` deleted; that part is superseded by [REBUILD-PLAN-laya-parity.md](REBUILD-PLAN-laya-parity.md).
Its AC pass/fail statement was removed in favour of a pointer, because that verdict belongs in
one place.

## Source of truth

| Fact                                             | Single home                                                      | Everything else must point here              |
| ------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------- |
| Which AC has a browser test                      | [ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md)           | PRD §7, implementation-plan §10, progress.md |
| Gate numbers (test counts, build, lint)          | [progress.md](progress.md) §Gates                                | byok.md §7, handover, coverage, README       |
| Whether the auth boundary is proven              | [progress.md](progress.md) §auth boundary + [auth.md](auth.md)   | handover, byok.md                            |
| Registry id count and which ids are real         | [view-audit-2026-11-01.md](view-audit-2026-11-01.md)             | handover, laya-parity, surface-coverage      |
| Where the shell came from / what was changed     | [laya-parity.md](laya-parity.md)                                 | REBUILD-PLAN, architecture                   |
| Module boundaries and the authoritative file map | [architecture.md](architecture.md)                               | CONTRACT.md                                  |
| Env var names, defaults, consumers               | [environment.md](environment.md)                                 | .env.example                                 |
| Bridge wire protocol and its env surface         | [terminal.md](terminal.md) §The bridge                           | progress.md §Terminal bridge                 |
| HTTP route status codes and failure body shapes  | [api-contract-2026-11-02.md](api-contract-2026-11-02.md)         | parity-checklist §3.2 (image budget)         |
| The CSP, and why each relaxed source is allowed  | [csp.md](csp.md)                                                 | security-review, svelte.config.js comments   |
| Line/branch coverage percentages                 | [coverage-2026-11-02.md](coverage-2026-11-02.md)                 | progress.md (totals only)                    |
| Is a screen reachable, named, quiet and honest   | [surface-coverage-2026-11-02.md](surface-coverage-2026-11-02.md) | view-audit (classifies, does not walk)       |
| Accessibility defects fixed and deferred         | [a11y-2026-11-02.md](a11y-2026-11-02.md)                         | laya-parity §1 (the two `:focus-visible`)    |
| Overflow, tap-target and zoom behaviour          | [responsive-2026-11-02.md](responsive-2026-11-02.md)             | edge-cases rows 29–32 (the input only)       |
| Runtime cost of a large chat, and its ceiling    | [runtime-perf-2026-11-02.md](runtime-perf-2026-11-02.md)         | progress.md (no perf numbers elsewhere)      |
| Adversarial inputs and their verdicts            | [edge-cases-2026-11-02.md](edge-cases-2026-11-02.md)             | responsive (shares the 320px row)            |
| Trust-boundary verdicts per surface              | [security-review-2026-11-02.md](security-review-2026-11-02.md)   | auth.md, csp.md, terminal.md                 |
| How to reproduce a local Convex deployment       | [convex-local-setup.md](convex-local-setup.md)                   | progress.md §auth boundary, gate.md, auth.md |

## Superseded, and why they are still here

`implementation-plan.md`, `ui-spec.md`, `state-model.md`, `placeholder-copy.md` and
`cloud-handoff.md` all describe the same thing: a from-scratch 0.3.0 shell with a
`/workspace` · `/capabilities` · `/settings` route family and `slices/{app-shell,workspace,
composer,workbench,capabilities,settings-surface,placeholders}`. None of those slices or routes
exists on this branch — `ls slices/` returns `cloud`, `workspace-shell`, `workspace-surface`.
The app route is `/` plus three public pages (`/home`, `/privacy`, `/terms`) that render
without the workspace bundle.

They are kept deliberately, on the instruction recorded in
[REBUILD-PLAN-laya-parity.md](REBUILD-PLAN-laya-parity.md): "Do not delete them; mark them
superseded when the rebuild lands." They are the design rationale for a shape that was built
and then replaced, and an agent that finds `AC01` in the PRD still needs to know that the
scenario text came from there.

What replaced them: [laya-parity.md](laya-parity.md) for the shipped shape,
[architecture.md](architecture.md) for boundaries and the file map,
[ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md) for what the ACs now mean.

## Unresolved contradictions

These are flagged rather than fixed, because resolving them needs information this branch does
not have. Do not "clean them up" from guesswork.

1. **View and registry counts disagree across four documents, and no two agree.**

   | Document                                         | Claim                     | Measured on `98549c9`              |
   | ------------------------------------------------ | ------------------------- | ---------------------------------- |
   | `handover-2026-11-01.md` (this repo)             | 23 views, 27 registry ids | 26 view files, 30 ids              |
   | desktop `docs/HANDOVER-2026-11-01.md`            | 23 views, 29 registry ids | 26 view files, 30 ids              |
   | `view-audit-2026-11-01.md` header                | "27 registry entries"     | 30 ids                             |
   | `view-audit-2026-11-01.md` follow-up (same file) | "25 ids, not 27"          | 25 was true at `dff55b3`; 30 today |
   | `surface-coverage-2026-11-02.md`                 | "The 28 ids"              | 28 was true at `337850c`; 30 today |

   `src/lib/registry.ts` holds **30 navigable ids today** (23 in `SECTIONS`, 7 in
   `CHAT_OUTPUTS`), and `src/lib/views/` holds **26 files**, of which **25** are referenced by a
   `loadScreen` (the 26th is `Chat.svelte`, which `/` mounts directly rather than through the
   registry). At `dff55b3` the same counts were 25 ids (18 + 7) and 21 files; `memories`, `git`,
   `automations`, `mcp-apps` and `projects` shipped after it. The audit's own
   follow-up section is the version that matched the tree when it was written; its header is the
   pre-deletion snapshot. The 27 and 29-vs-23-view figures in the two handovers are
   unrecoverable from this branch without knowing exactly when each was counted, so they stay as
   written. **Treat [view-audit-2026-11-01.md](view-audit-2026-11-01.md) as the authority and
   the rest as dated observations.**

2. **`laya-parity.md` §2 lists a view set that does not exist.** It names 21 views including
   `Files`, `Browser`, `Performance`, `Parameters`, `Corpus`, `Schema` and `Reference`. Those
   files are gone (`6ed1f3e` removed `src/lib/views/` entirely; `d52e006` restored a different
   set). The real 26 today are `Apps, Automations, BrowserCanvas, Chat, Compute, Devices,
Embeddings, Faq, FileCanvas, Git, Manef, McpApps, Memories, ModelKeys, Models, Overview,
Playground, Pricing, Projects, Providers, Setup, Snake, Terminal, ToolsSettings, Transcribe,
Voice`; 25 of them are registry entries and `Chat.svelte` is mounted by `/`.
   At `dff55b3` the count was 21 with a different membership, which is exactly why the mismatch
   was never caught. The §2 block is provenance — what Laya contained — not a claim about this
   tree. **Resolved in this pass:** §2 is now headed "as copied, not as shipped", so it is
   explicitly the copy at `84c1823` and the reader is told to measure the tree instead of
   grepping that block.

3. **The two handover copies are not mirrors and neither is a superset.** `docs/handover-2026-11-01.md`
   here and `docs/HANDOVER-2026-11-01.md` in `rahmanef63/codex-desktop` share the identity
   table and the parity matrix but each carries corrections the other lacks:

   | Only in the web copy                                             | Only in the desktop copy                                              |
   | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
   | Auth boundary "unproven, not proven" + the 3210 evidence         | `--sandbox workspace-write` silently becomes `read-only`              |
   | AC corrigenda and the dev-smoke-only browser reality             | Probe isolation in `~/.codex-probe`; a second plaintext 9router token |
   | "Five views still guessed" replaced by the audit's actual result | Second plaintext config path to rotate                                |

   Both still claim `179 passed, 4 skipped`, which the web copy then contradicts two paragraphs
   later. **Unresolved: which copy's shared sections win.** Practical rule until someone
   merges them: each repo's copy is authoritative for its own repo's gates, and neither is
   authoritative for the other's.

4. **`handover` says five views remain guessed; `view-audit` says three.** The handover lists
   `pricing, parameters, faq, performance, workspace-home`; the audit's follow-up deleted
   `parameters` and `performance`. The audit is newer and carries per-row evidence, so the
   audit wins by weight of evidence — but the handover is a historical record and was left
   alone. **Unresolved only in the sense that the handover still reads as current guidance.**

5. **`progress.md` baseline line vs gate commit — resolved in this pass.** The file now states
   the two SHAs explicitly: **baseline `d839f75`** is where measurement _started_; **gate
   commit `98549c9`** is the revision the current §Gates block was run against (39 commits
   above the last recorded run, `597fdaf`). A number without its commit is meaningless, so
   the gate block names its own SHA instead of inheriting the baseline line.

## Resolved in this pass

Recorded so the next reader does not have to reconstruct the reasoning:

- **AC coverage had three homes** (PRD §7, implementation-plan §10, progress.md
  §Correction). All three now point at
  [ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md). The corrigenda themselves are kept
  verbatim in tone — they are the record of a claim that survived a deletion — but each now
  says explicitly that it is history, not the verdict. The PRD and plan no longer assert a
  pass/fail summary at all.
- **Gate numbers had four homes** (progress.md, byok.md §7, handover, README). `byok.md` §7's
  table was replaced by a pointer; it had drifted `95` → `138` while progress.md said `194`.
  Re-measured on `98549c9`: **107 files / 1294 passed / 3 skipped (1297)**. The chain that got
  here is `36 / 197 / 3` (`dff55b3`) → `50 / 441 / 3` (`337850c`) → `57 / 596 / 3`
  (`test/convex`) → `81 / 939 / 3` (`597fdaf`) → `107 / 1294 / 3` (`98549c9`). Only
  [progress.md](progress.md) §Gates carries a full gate block; every other document points there.
- **`terminal.md` contradicted itself**: the opening sentence said the bridge "is not part of
  this template" while §"The bridge that ships here" documents `bridge/terminal-bridge.mjs`,
  which exists and is exercised by ten tests in
  `src/lib/runtime/terminal-bridge.spec.ts`. Resolved by evidence: the bridge ships. The
  opening was corrected to say the panel is the client half and the _remote_ bridge on the
  user's machine is theirs, which is what the rest of the file already said.

### 2026-11-02, index pass two

The wave-3 documents landed after the first pass, so the index drifted again. Re-measured on
`98549c9`; nothing below was copied from another document.

- **Eight documents were reachable from no index row**: `README.md` itself, `api-contract`,
  `convex-local-setup`, `coverage`, `csp`, `edge-cases`, `responsive` and `runtime-perf`. All
  eight now have rows. Two more "Updated" cells were stale (`ai-mcp`, `integrations`) and a
  third (`convex-best-practices`) had moved; all three were reset from
  `git log -1 --format=%cs`.
- **Registry ids: 28 → 29 → 30.** `mcp-apps` was registered by the parity batch, then
  `projects` by `e3362ef`. Measured on `98549c9`: 23 `SECTIONS` + 7 `CHAT_OUTPUTS` = **30**;
  `src/lib/views/` holds 26 files, 25 of them named by a `loadScreen` (`Chat.svelte` is mounted
  by `/`, not the registry). [view-audit](view-audit-2026-11-01.md) keeps the authoritative
  count for its own date; anything dated is read as a snapshot, not as today.
- **Contract tests: 153 → 138.** `api-contract` claimed 153 across seven files with 27 for the
  chat route. The merge into `integration` (`751f590`) cut that file from 27 cases to 12.
  Measured by running the seven files: **138 passed**. The page now also says which rows of
  its chat table are no longer pinned, because a table that reads like a test inventory after
  the inventory shrank is the exact failure this page exists to catch.
- **Six documents each carried their own unit total** (`441`, `446`, `473`, `596`, `636`,
  `205`). Each is now labelled as the snapshot it is, with a pointer to
  [progress.md](progress.md) §Gates, which carries the single measured block. This page no
  longer restates the number either.
- **Coverage percentages are not gate numbers.** `coverage-2026-11-02.md` now says so in its
  header: it is the only home for the percentages and the per-file before/after, and it points
  at progress.md for the totals. The percentages themselves are **unverified on this tree** —
  `@vitest/coverage-v8` is not installed, so nothing here can reproduce them (see that file's
  header).

### 2026-11-03, index pass three

Re-measured on `98549c9`. This pass fixed claims, not just counts:

- **Route tables were wrong in three places.** `README.md` listed only `/` and "anything else
  → 404"; `docs/architecture.md` said the sitemap had one URL; `api-contract` said "exactly one
  `<loc>`". `/home`, `/privacy` and `/terms` shipped in `98549c9` and the sitemap now emits
  three locations, pinned by `src/routes/contract.spec.ts`. All three fixed.
- **Registry: 29 → 30 ids, 25 → 26 view files.** Counted from `src/lib/registry.ts`
  (23 `SECTIONS` + 7 `CHAT_OUTPUTS`); 25 of the 26 view files carry a `loadScreen`, and
  `Chat.svelte` is mounted by `/`.
- **Playwright was described as "426 tests over 8 files" and a "28-id surface walk".** Today:
  10 files, 178 cases, 534 registered across three projects, and `tests/surfaces.e2e.ts` walks
  30 registry ids. Stale, not old.
- **`ac-coverage` labelled four product gaps `no-longer-applicable`.** AC05, AC09, AC13 and AC16
  have no product behind them; the label is now `UNIMPLEMENTED`, and AC01/AC02/AC03/AC06/AC08/
  AC12 are `WEAKER` because their tests assert less than the bar. `needs-new-test = 0` was
  hiding four product gaps.
- **`tests/acceptance.e2e.ts` exists again** (`5cdf2a9`, 14 tests). `docs/ac-coverage` and
  `docs/cloud-handoff` both still said it was gone; `tests/workspace.e2e.ts` is the one still
  absent.
- **`coverage-2026-11-02.md` broke its own rule** by restating three unit totals, and its
  percentages cannot be reproduced here (`@vitest/coverage-v8` is absent from `node_modules`).
  Both are now stated explicitly instead of looking measured.
- **`responsive-2026-11-02.md` claimed "23 passed (9 cases × 3 projects)"** — 9×3 is 27, and 23
  was right only as the per-project count. The file has 9 `test()` statements that expand to 23
  cases per project (69 registered) because two of them loop over 11 and 5 widths. The doc now
  names the CSS that actually exists (1100/600/650 plus narrow niceties) and says 768 is a test
  width, not a breakpoint.
- **`progress.md` baseline vs gate commit (was unresolved item 5).** Resolved in the file:
  baseline `d839f75` is where measurement started, gate commit `98549c9` is what the block was
  run against.

## Secret scan

`bash scripts/secret-scan.sh` must exit 0 before any commit. It scans every tracked file for
provider key shapes, literal bearer values, GitHub/Slack/AWS token shapes and PEM headers.
`--staged` restricts it to the index for use as a pre-commit hook.

Spec files are excluded: they hold deliberate fake credentials (one exists solely to prove the
log redactor strips it). That exclusion is a known ceiling — a real key pasted into a spec
would not be caught. `scripts/secret-scan.sh` did not exist on this branch before this pass,
although `handover-2026-11-01.md` claimed a secret had been "verified absent by
`scripts/secret-scan.sh`"; that claim is now true rather than aspirational.

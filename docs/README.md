# docs index

This repository has more documentation than code. Read this page before any other file in
`docs/`; it says which document is current, which is a record of a past session, and which
describes a structure that no longer exists.

Rule that keeps this page honest: **one fact, one home.** Where two documents state the same
number or the same verdict, the one listed under "Source of truth" below wins and the other
should point at it rather than repeat it. Three files restating one claim at three different
times is how `138 passed (27 files)` outlived two route rebuilds.

Last verified against the tree: `dff55b3`, 2026-11-02.

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

- **current** — describes the code as it is on `dff55b3`. Safe to rely on.
- **historical** — a record of one session or decision at a date. Not maintained. Useful for
  "why is it like this", not for "what is it now".
- **superseded** — describes a structure that has been deleted. Kept because the decision and
  its reasoning are still the historical record. Do not implement from it.

"Updated" is `git log -1 --format=%cs` for the file: the last commit that touched it, which
is not always the last time its content was true.

| File                                                                   | Purpose                                                          | Updated    | Status     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- | ---------- |
| [architecture.md](architecture.md)                                     | Boundaries, module map, source-of-truth table                    | 2026-11-02 | current    |
| [progress.md](progress.md)                                             | Living status, gate numbers, known-unproven claims               | 2026-11-02 | current    |
| [ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md)                 | AC01–AC18 verdict per criterion against the live app             | 2026-11-02 | current    |
| [view-audit-2026-11-01.md](view-audit-2026-11-01.md)                   | Every registry id classified real/partial/stub/guess             | 2026-11-02 | current    |
| [surface-coverage-2026-11-02.md](surface-coverage-2026-11-02.md)       | Every registry id walked in a browser: reachable/named/honest    | 2026-11-02 | current    |
| [laya-parity.md](laya-parity.md)                                       | Provenance of the vendored Laya shell, deliberate deviations     | 2026-10-29 | current    |
| [terminal.md](terminal.md)                                             | Terminal panel client + the bridge contract and reference bridge | 2026-11-01 | current    |
| [byok.md](byok.md)                                                     | Three engines, the never-hold-a-key rule, Jev boundary           | 2026-11-01 | current    |
| [auth.md](auth.md)                                                     | Optional Google OIDC, private notes, auth boundary proof         | 2026-11-02 | current    |
| [ai-mcp.md](ai-mcp.md)                                                 | Optional BYOK chat routes and the MCP client/server panels       | 2026-10-30 | current    |
| [integrations.md](integrations.md)                                     | Payment/email transport adapters, boundaries                     | 2026-09-08 | current    |
| [deployment.md](deployment.md)                                         | Vercel vs Node targets, build selection, host requirements       | 2026-11-01 | current    |
| [environment.md](environment.md)                                       | Every env var, default, and its actual consumer                  | 2026-11-01 | current    |
| [assets.md](assets.md)                                                 | Brand identity, asset paths, placeholder/custom status           | 2026-09-08 | current    |
| [assets-prompts.md](assets-prompts.md)                                 | Generated image briefs (`bun run assets:prompts`)                | 2026-10-29 | current    |
| [linting.md](linting.md)                                               | What prettier/eslint/Svelte-5 guard enforce                      | 2026-09-08 | current    |
| [releasing.md](releasing.md)                                           | Version bump, changelog, release gates                           | 2026-09-08 | current    |
| [svelte-best-practices.md](svelte-best-practices.md)                   | Svelte 5 / SvelteKit rules for this repo                         | 2026-09-08 | current    |
| [convex-best-practices.md](convex-best-practices.md)                   | Schema, validators, visibility rules                             | 2026-09-08 | current    |
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
| [ui-spec.md](ui-spec.md)                                               | Region hierarchy, tokens, responsive and focus contract          | 2026-10-27 | superseded |
| [state-model.md](state-model.md)                                       | Ten state axes, transitions, persistence, races                  | 2026-10-27 | superseded |
| [placeholder-copy.md](placeholder-copy.md)                             | Copy token contract and the `t()` resolver                       | 2026-10-28 | superseded |
| [cloud-handoff.md](cloud-handoff.md)                                   | Cloud start guide for the 0.3.0 shell and its route family       | 2026-10-28 | superseded |

† **PRD.md is mixed.** §5 (AC01–AC18) is the live acceptance bar and should not be rewritten
to match whatever currently passes — a bar that moves to meet the code measures nothing. §3.1
and §7 still name the `/workspace`, `/capabilities` and `/settings` route family that
`6ed1f3e` deleted; that part is superseded by [REBUILD-PLAN-laya-parity.md](REBUILD-PLAN-laya-parity.md).
Its AC pass/fail statement was removed in favour of a pointer, because that verdict belongs in
one place.

## Source of truth

| Fact                                             | Single home                                                    | Everything else must point here              |
| ------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------- |
| Which AC has a browser test                      | [ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md)         | PRD §7, implementation-plan §10, progress.md |
| Gate numbers (test counts, build, lint)          | [progress.md](progress.md) §Gates                              | byok.md §7, handover, README                 |
| Whether the auth boundary is proven              | [progress.md](progress.md) §auth boundary + [auth.md](auth.md) | handover, byok.md                            |
| Registry id count and which ids are real         | [view-audit-2026-11-01.md](view-audit-2026-11-01.md)           | handover, laya-parity                        |
| Where the shell came from / what was changed     | [laya-parity.md](laya-parity.md)                               | REBUILD-PLAN, architecture                   |
| Module boundaries and the authoritative file map | [architecture.md](architecture.md)                             | CONTRACT.md                                  |
| Env var names, defaults, consumers               | [environment.md](environment.md)                               | .env.example                                 |
| Bridge wire protocol                             | [terminal.md](terminal.md) §The bridge                         | progress.md §Terminal bridge                 |

## Superseded, and why they are still here

`implementation-plan.md`, `ui-spec.md`, `state-model.md`, `placeholder-copy.md` and
`cloud-handoff.md` all describe the same thing: a from-scratch 0.3.0 shell with a
`/workspace` · `/capabilities` · `/settings` route family and `slices/{app-shell,workspace,
composer,workbench,capabilities,settings-surface,placeholders}`. None of those slices or routes
exists on this branch — `ls slices/` returns `cloud`, `workspace-shell`, `workspace-surface`,
and the only route is `/`.

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

   | Document                                         | Claim                     | Measured on `dff55b3` |
   | ------------------------------------------------ | ------------------------- | --------------------- |
   | `handover-2026-11-01.md` (this repo)             | 23 views, 27 registry ids | 21 views, 25 ids      |
   | desktop `docs/HANDOVER-2026-11-01.md`            | 23 views, 29 registry ids | 21 views, 25 ids      |
   | `view-audit-2026-11-01.md` header                | "27 registry entries"     | 25 ids                |
   | `view-audit-2026-11-01.md` follow-up (same file) | "25 ids, not 27"          | 25 ids                |

   `src/lib/registry.ts` holds 25 ids today (18 in `SECTIONS`, 7 in `CHAT_OUTPUTS`), and
   `src/lib/views/` holds 21 files. The audit's own follow-up section is the version that
   matches the tree; its header is the pre-deletion snapshot. The 27 and 29 figures are
   unrecoverable from this branch without knowing exactly when each was counted, so they stay
   as written. **Treat [view-audit-2026-11-01.md](view-audit-2026-11-01.md) as the authority
   and the rest as dated observations.**

2. **`laya-parity.md` §2 lists a view set that does not exist.** It names 21 views including
   `Files`, `Browser`, `Performance`, `Parameters`, `Corpus`, `Schema` and `Reference`. Those
   files are gone (`6ed1f3e` removed `src/lib/views/` entirely; `d52e006` restored a different
   21). The real 21 are `Apps, BrowserCanvas, Chat, Compute, Devices, Embeddings, Faq,
FileCanvas, Manef, ModelKeys, Models, Overview, Playground, Pricing, Providers, Setup,
Snake, Terminal, ToolsSettings, Transcribe, Voice`. The count happens to match at 21, which
   is exactly why this was never caught. The §2 block is provenance — what Laya contained —
   not a claim about this tree; the file does not say which it means. **Unresolved: whether §2
   describes the copy at `84c1823` or the tree after the deletions.**

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

5. **`progress.md` baseline line says `d839f75` while its gate block now says `dff55b3`.**
   The baseline is where measurement _started_; the gate block is where it was last _run_.
   Both are correct and the distinction is not stated in the file. Left as-is rather than
   inventing a rule for it.

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
  Measured now: **36 files / 197 passed / 3 skipped** on `dff55b3`.
- **`terminal.md` contradicted itself**: the opening sentence said the bridge "is not part of
  this template" while §"The bridge that ships here" documents `bridge/terminal-bridge.mjs`,
  which exists and is exercised by six tests in
  `src/lib/runtime/terminal-bridge.spec.ts`. Resolved by evidence: the bridge ships. The
  opening was corrected to say the panel is the client half and the _remote_ bridge on the
  user's machine is theirs, which is what the rest of the file already said.

## Secret scan

`bash scripts/secret-scan.sh` must exit 0 before any commit. It scans every tracked file for
provider key shapes, literal bearer values, GitHub/Slack/AWS token shapes and PEM headers.
`--staged` restricts it to the index for use as a pre-commit hook.

Spec files are excluded: they hold deliberate fake credentials (one exists solely to prove the
log redactor strips it). That exclusion is a known ceiling — a real key pasted into a spec
would not be caught. `scripts/secret-scan.sh` did not exist on this branch before this pass,
although `handover-2026-11-01.md` claimed a secret had been "verified absent by
`scripts/secret-scan.sh`"; that claim is now true rather than aspirational.

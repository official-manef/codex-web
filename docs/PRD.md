# Product requirements — workspace shell (placeholder build)

Status: draft MVP scope, approved for cloud implementation. Owner: rahmanef63.
Product identity is intentionally unset; every string in the UI is a placeholder token.

> **Read [README.md](README.md) first.** This file is two documents in one. §5 (the AC bar) is
> current. §3.1 and §7 describe the `/workspace` · `/capabilities` · `/settings` route family
> that `6ed1f3e` deleted; that part is superseded by
> [REBUILD-PLAN-laya-parity.md](REBUILD-PLAN-laya-parity.md) and
> [laya-parity.md](laya-parity.md). The index explains the split.

## 1. What this is

A Codex-style assistant workspace: a compact global rail, a context sidebar, a primary
conversation region with a multimodal composer, an optional tabbed secondary work
region, a capability catalog and a categorized configuration surface.

The visual and structural reference is `docs/reference/workspace-prototype.html` — a
static prototype that renders six compositions from one state object. This repository
rebuilds that prototype as a real SvelteKit application on the rr starter contract.

Hard rule: **no invented product copy.** Headings, menu labels, empty states, error
copy and placeholder text stay as tokens (`{workspace_name}`, `{empty_context}`, …) so
the shell can be evaluated on structure alone. See
[placeholder-copy.md](placeholder-copy.md).

## 2. Audience and job

| Item                  | Value                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| Primary use           | Evaluating the shell structure and interaction contract before product copy |
| Secondary             | Being the rr starter baseline for assistant/workspace products              |
| Explicit non-audience | End users. Nothing here is a shippable product experience yet               |

The job to be done: _let a reviewer click through every workspace state — empty,
populated, split, overflow, catalog, configuration — at phone, tablet and desktop
widths, and confirm that no state, focus target or draft is lost on the way._

## 3. MVP scope

### 3.1 In scope (must ship)

| ID  | Capability                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------- |
| S1  | App shell: title bar, global rail, sidebar region, primary region, secondary region, overlays                    |
| S2  | Route family `/workspace`, `/workspace/[chatId]`, `/capabilities`, `/capabilities/[slug]`, `/settings/[section]` |
| S3  | Lazy typed registry for the repeated page families (capabilities, settings sections)                             |
| S4  | Unstarted surface: mode switch, entry heading, composer, support action bar                                      |
| S5  | Populated surface: context header, message timeline, activity summaries, constraint notice                       |
| S6  | Composer mechanics: draft text, attachments (preview + remove), submit guard, cancel, disabled reasons           |
| S7  | Secondary work region: tabs, tab close, resource toolbar, resource start body, splitter                          |
| S8  | Context summary popover, more-destinations menu with keyboard navigation                                         |
| S9  | Capability catalog: grouped installed list, detail pane, connected/not-connected state                           |
| S10 | Configuration surface: searchable category sidebar, grouped field rows (toggle/select/path/action)               |
| S11 | Shared state model: draft per draft key, tabs per workspace, overlay, process, persistence                       |
| S12 | Responsive composition: single column at `<650px`, rail+drawer at `650–850px`, split `>1100px`                   |
| S13 | Placeholder content catalog: every visible string resolves through one token dictionary                          |
| S14 | Verification: `bun run verify` green, Playwright at 390 / 768 / 1440, dev hydration smoke                        |

### 3.2 Out of scope (do not build in MVP)

- Authentication, accounts, tenancy. No login; the app runs without credentials.
- Any backend persistence. Convex stays wired but unused by this shell
  (`slices/*/api` adapters may return the local adapter only).
- Model calls, streaming, SSE, provider keys, BYOK, MCP tool execution.
- Real file upload or object storage. Attachments are local previews only
  (`URL.createObjectURL`), never persisted.
- Payments, email, analytics, i18n runtime switching.
- Marketing pages, onboarding, landing hero.
- Search across chats, usage history, parallel agents, terminal, code review.

### 3.3 Non-goals stated as rules

1. Do not replace the placeholder tokens with "realistic" copy. That is a separate,
   product-owned task that must arrive with a product name and audience.
2. Do not add a second design system. shadcn-svelte primitives + `src/lib/components/app-ui`
   only.
3. Do not clone the reference prototype's inline `<script>` DOM-string rendering. It is a
   specification, not an implementation to port line by line.

## 4. Slice plan

Consumer UI lives in root `slices/<slug>/`. Routes are thin adapters.

| Slice              | Owns                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `app-shell`        | Rail, title bar, shell regions, overlay host, composition state         |
| `workspace`        | Unstarted + populated surfaces, timeline, context header, mode switch   |
| `composer`         | Draft, attachments, submit guard, access + execution controls           |
| `workbench`        | Secondary region, tabs, resource toolbar, resource start body, splitter |
| `capabilities`     | Installed list, detail pane, connection state (registry-driven)         |
| `settings-surface` | Category sidebar, search filter, grouped typed field rows               |
| `placeholders`     | Token dictionary + typed `t(key)` resolver (shared, not a feature UI)   |

Field-row rendering is shared by configuration; if a second consumer appears, lift to
`src/lib/components/app-ui` on the second occurrence, not before.

## 5. Acceptance criteria

Scenario IDs map to `docs/reference/classification-uiux-state.json`
(`acceptance_scenarios`). MVP must pass AC01–AC18, restated here as testable checks:

| ID   | Given → When → Then                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| AC01 | New chat, no draft → page open → empty entry surface, submit disabled with a visible reason                     |
| AC02 | Valid image attached → validation done → thumbnail ready, submit enabled if product allows attachment-only send |
| AC03 | Two attachments, one failed → send pressed → send blocked, per-file reason, ready files kept                    |
| AC04 | Valid draft → submit clicked twice fast → exactly one request and one message appended                          |
| AC05 | Request not yet accepted → connection lost → draft retained, retry does not duplicate                           |
| AC06 | Response streaming → user cancels → partial output kept, cancelled status explicit                              |
| AC07 | Chat A has a draft → switch to B and back → A's draft restored, never mixed with B                              |
| AC08 | Work region with three tabs → hide then show → tabs and active tab preserved                                    |
| AC09 | Tab dirty → close → keep/discard/cancel offered; failed save keeps the tab open                                 |
| AC10 | Split layout on desktop → viewport shrinks → layout degrades without losing draft, tabs, context                |
| AC11 | More menu opened by keyboard → Escape → menu closes, focus returns to its trigger                               |
| AC12 | Setting changed twice quickly → first save resolves last → newest value wins                                    |
| AC13 | Capability installed but not connected → row shows "Connect", never claims ready                                |
| AC14 | Settings opened from chat → return to workspace → chat, draft and tabs restored                                 |
| AC15 | Populated list → search with no match → "no search results", not "no data"                                      |
| AC16 | Access unknown → composer holds a draft → send does not assume authorization                                    |
| AC17 | Reading old messages → new output arrives → scroll position kept, new-content marker shown                      |
| AC18 | Tab landing present but related-tab list empty → copy scopes the emptiness to that list                         |

### 5.1 Definition of done per slice

1. Barrel exports the slice surface; cross-slice import uses `$features/<slug>` only.
2. Co-located test covers the barrel API and one visible state transition.
3. Svelte 5 Runes only; no `$:`, `export let`, `on:click`, `createEventDispatcher`, `<slot>`.
4. Empty, loading, error and restricted states implemented, not only the happy path.
5. Keyboard reachable, visible focus, accessible name on every icon-only control.
6. Verified at 390 / 768 / 1440 in a real browser, not just typecheck.

## 6. Placeholder content contract

All copy resolves through `slices/placeholders`:

```text
t('workspace_name')            → {workspace_name}
t('empty_context')             → {empty_context}
t('recent_object_03')          → {recent_object_03}
```

Rules: tokens are `snake_case` inside braces; no locale prefix in MVP; the resolver is
pure and synchronous; unknown keys return the key wrapped in braces and log once in dev.
Collection counts are data (24 recent items, 16/6/5 settings categories), not copy.

## 7. Milestones

| #   | Milestone                                              | Exit check                                                   |
| --- | ------------------------------------------------------ | ------------------------------------------------------------ |
| M0  | Docs + contract updated, reference artifacts committed | This file reviewed, `CONTRACT.md` maps new files             |
| M1  | `app-shell` + `placeholders` + route family skeleton   | `/workspace` renders rail + sidebar + primary, mobile intact |
| M2  | Unstarted surface + composer guard                     | AC01, AC02, AC03, AC16 green                                 |
| M3  | Populated surface + timeline + submit lifecycle        | AC04, AC05, AC06, AC17 green                                 |
| M4  | Workbench + tabs + splitter                            | AC08, AC09, AC10 green                                       |
| M5  | Capabilities + settings surfaces                       | AC13, AC15, AC18 green                                       |
| M6  | Restore/persistence + overlay keyboard                 | AC07, AC11, AC12, AC14 green                                 |
| M7  | Full release evidence                                  | See §8                                                       |

The AC ids below are the acceptance **bar**. Which of them have a browser test today, and
which no longer have a surface to test, is recorded in exactly one place:
[ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md). Do not restate a pass/fail summary
here; it goes stale on the next route change.

> **History, kept on purpose.** This section claimed until 2026-10-30 (`cc33ef0`) that
> `tests/workspace.e2e.ts` and `tests/acceptance.e2e.ts` covered all of AC01–AC18. `6ed1f3e`
> ("rebuild on the Laya NPU workspace template") deleted both suites with the
> `/workspace`, `/capabilities` and `/settings` route family, and the claim survived unedited
> in this file **and** in [implementation-plan.md](implementation-plan.md) §10 **and** in
> [progress.md](progress.md) — three restatements of one stale fact, corrected at three
> different times. That duplication is what this note replaces. `tests/acceptance.e2e.ts` was
> restored on 2026-11-02 against the current single-route shell; the per-criterion verdict is
> in the coverage file, not here.

## 8. Release evidence

```bash
bun install --frozen-lockfile
bun run verify              # check + lint + unit + build
bunx playwright test        # production build, 390 / 768 / 1440
bun run test:dev            # dev-server hydration / navigation smoke
bun run assets:check
```

Evidence is recorded against an exact commit. A green typecheck is not browser proof.
Production deploy is out of MVP scope; when it happens, verify the deployed revision
and not an old alias response.

## 9. Open decisions (block product copy, not the MVP shell)

| Topic           | Question                                                         |
| --------------- | ---------------------------------------------------------------- |
| Identity        | Product name, audience, visual identity                          |
| Workbench tabs  | Which real content kinds ship (`browser`, `document`, `tool`, …) |
| Tab ownership   | Tabs belong to chat, project or workspace                        |
| Platform        | Web only, desktop shell, or both                                 |
| Authorization   | Which actions require confirmation                               |
| Attachments     | Types, sizes, count limits                                       |
| Settings source | Local preference vs backend-owned setting per key                |

Until these are answered, defaults are recorded in [state-model.md](state-model.md) and
must stay reversible.

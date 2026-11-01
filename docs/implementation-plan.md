# Implementation plan — placeholder workspace shell

Execution order for an agent working in the cloud. Each step lists exact paths, the exit
check, and the P0/P1 rules it touches. Steps are sequential; a step must pass its check
before the next begins.

Read first: [PRD.md](PRD.md), [ui-spec.md](ui-spec.md), [state-model.md](state-model.md),
[placeholder-copy.md](placeholder-copy.md), [CONTRACT.md](../CONTRACT.md).

## 0. Ground rules for every step

1. Svelte 5 Runes only. `scripts/check-svelte5.mjs` fails the build on `$:`, `export let`,
   `on:click`, `createEventDispatcher`, `<slot>`. [P1]
2. Bun only. One `bun.lock`. Never `npm`/`pnpm`/`yarn`. [P1]
3. Consumer UI in `slices/<slug>/`; routes adapt params and render the barrel. Cross-slice
   import is `$features/<slug>` only. [P1]
4. No hex in components; tokens come from `src/routes/layout.css`. [P1]
5. shadcn-svelte primitive before any hand-rolled control. [P1]
6. Every async region implements unknown/loading/empty/partial/error/restricted. [P1]
7. Optional capabilities stay off; a clean clone boots with no credentials. [P0]
8. No secrets, tokens, or per-user mutable state in a module or server singleton. [P0]
9. Every slice ships a co-located test of its barrel and one visible transition. [P1]
10. Conventional commits; P1 deviations carry `// TODO(rr): …` plus a commit-body note.

## 1. Retire the starter demo surface

Not a cleanup for its own sake — the MVP has one product and six compositions, and the
starter's demo slices would otherwise ship as fake features.

| Action                                     | Path                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Delete demo slices                         | `slices/dashboard`, `slices/live-data`, `slices/notes`, `slices/assistant`, `slices/settings` |
| Rewrite registry                           | `slices/app-shell/registry.ts` → destination registry, not feature registry                   |
| Rewrite registry types                     | `slices/app-shell/types.ts` → `Destination`, `Composition`, `AreaId`                          |
| Delete demo screens/tests referencing them | `slices/app-shell/*.spec.ts`, `src/routes/apps/**`                                            |

Keep: `src/convex/**` (unused by the shell but part of the contract), `src/lib/server/**`,
`src/lib/components/ui/**`, `src/lib/components/app-ui/**`.

Exit: `bun run check` passes with an empty-but-typed registry; no dangling imports.

## 2. Placeholder dictionary — `slices/placeholders/`

| File            | Content                                                              |
| --------------- | -------------------------------------------------------------------- |
| `index.ts`      | barrel: `t`, `tp`, `PLACEHOLDER_KEYS`, `GENERIC_LABELS`              |
| `resolve.ts`    | pure resolver, dev-only warn-once for unknown keys                   |
| `keys.ts`       | declared key families per [placeholder-copy.md](placeholder-copy.md) |
| `index.spec.ts` | coverage, unknown-key, `tp` padding, no-hand-inlined-token scan      |

Exit: `bun run test:unit` green. This slice has no DOM and no state.

## 3. Shell skeleton — `slices/app-shell/`

```text
slices/app-shell/
  components/app-shell.svelte        outer chrome, region slots
  components/title-bar.svelte        host labels, composition select (dev only)
  components/global-rail.svelte      destinations, active marker, overflow trigger
  components/sidebar-region.svelte   host for per-area context navigation
  components/overlay-host.svelte     one-overlay-at-a-time host + Escape/focus return
  components/composition-menu.svelte dev-only composition switch
  state.svelte.ts                    activeArea, sidebar, overlay, connectivity
  registry.ts                        DESTINATIONS (id, labelKey, icon, area, route)
  types.ts                           AreaId, Destination, Composition, OverlayId
  index.ts                           barrel
  registry.spec.ts                   registry ↔ route ↔ nav parity
  state.spec.ts                      one overlay at a time, focus return contract
```

Routes:

```text
src/routes/+layout.svelte            keep, add dark shell wrapper class
src/routes/+page.svelte              redirect to /workspace
src/routes/workspace/+page.svelte    C2/C1 host
src/routes/workspace/[chatId]/+page.ts + +page.svelte
src/routes/workspace/[chatId]/+error.svelte
src/routes/capabilities/+page.svelte + [slug]/+page.ts + +page.svelte
src/routes/settings/[section]/+page.ts + +page.svelte
```

Exit: `/workspace` renders rail + sidebar + primary at 390/768/1440 with no overflow;
rail navigation swaps the sidebar content without losing any state; `+page.ts` validates
slugs against the registry and 404s unknown ids with a recovery link.

Note on `apps/[slug]`: it is the starter's repeated-page pattern. If a second repeated
family appears, reuse one `[slug]` route rather than cloning route files. [P1]

## 4. Workspace primary — `slices/workspace/`

| File                                  | Responsibility                                               |
| ------------------------------------- | ------------------------------------------------------------ |
| `components/workspace-screen.svelte`  | switch unstarted ↔ populated by `populated`                  |
| `components/unstarted-surface.svelte` | mode control, entry heading, composer slot, support bar      |
| `components/context-header.svelte`    | object title, parent context, overflow                       |
| `components/message-timeline.svelte`  | user/assistant entries, activity rows, notice, entry actions |
| `components/context-summary.svelte`   | 4 grouped sections in a `Popover`                            |
| `state.svelte.ts`                     | mode, populated, activeObjectId, summary visibility          |
| `types.ts`, `index.ts`                | contracts + barrel                                           |
| `__tests__/workspace.spec.ts`         | empty→populated transition, mode switch preserves draft      |

Exit: AC01 surface, AC16 (no send without authority), AC17 (scroll retained on append).

## 5. Composer — `slices/composer/`

| File                                  | Responsibility                                                      |
| ------------------------------------- | ------------------------------------------------------------------- |
| `components/composer.svelte`          | textarea auto-grow, attachment strip, footer controls               |
| `components/attachment-strip.svelte`  | preview, remove, failed reason                                      |
| `components/access-control.svelte`    | authority selector (`DropdownMenu`)                                 |
| `components/execution-control.svelte` | execution option + effort (`DropdownMenu`)                          |
| `draft.svelte.ts`                     | draft keyed by `draftKey`, sessionStorage restore                   |
| `submit.ts`                           | `submitEnabled` / `submitReasonKey` derivation, single-flight guard |
| `__tests__/submit.spec.ts`            | AC01, AC02, AC03, AC04, AC05                                        |
| `__tests__/draft.spec.ts`             | AC07 per-key isolation                                              |

Rules: object URLs revoked on remove and on unmount; no upload, no network in MVP;
double submit produces exactly one request id.

## 6. Workbench — `slices/workbench/`

| File                                 | Responsibility                                       |
| ------------------------------------ | ---------------------------------------------------- |
| `components/workbench.svelte`        | secondary region + layout switch                     |
| `components/tab-strip.svelte`        | tabs, close, add, active marker                      |
| `components/resource-toolbar.svelte` | history, location form, reload, overflow             |
| `components/resource-body.svelte`    | start surface, quick tools, suggestions, recent list |
| `components/splitter.svelte`         | pointer + keyboard resize, `role="separator"`        |
| `state.svelte.ts`                    | tabs, activeTabId, layout, splitWidth (clamped)      |
| `__tests__/workbench.spec.ts`        | AC08, AC09 dirty-tab guard, AC10 resize keeps state  |

## 7. Capabilities — `slices/capabilities/`

```text
slices/capabilities/
  registry.ts                    16 entries: id, nameKey, type, icon, color
  components/capabilities-screen.svelte
  components/capability-list.svelte
  components/capability-detail.svelte
  state.svelte.ts                selectedId, connection per id
  __tests__/capabilities.spec.ts  AC13, AC15-variant (no-match vs empty), AC18
```

Registry-driven: 16 rows, types A/B, connection `not_connected` default. Selecting a row
loads the detail pane; connect toggles with pending → success/failure and never claims
ready while disconnected.

## 8. Settings surface — `slices/settings-surface/`

```text
slices/settings-surface/
  registry.ts                    sections: 16 configuration + 6 integration + 5 advanced
  fields.ts                      field descriptors (toggle/select/path/action) + defaults
  components/settings-screen.svelte
  components/category-sidebar.svelte   search + grouped rows + no-match state
  components/setting-row.svelte        typed row renderer
  components/setting-toggle.svelte / setting-select.svelte / setting-path.svelte / setting-action.svelte
  state.svelte.ts                query, values, persistence + revision
  __tests__/settings.spec.ts     AC12 late-save wins, AC15 no-match, AC14 return restores
```

Field rows are local to this slice. Lift to `src/lib/components/app-ui` only on the
second real consumer. [P2]

## 9. Tokens and shell styling

1. Add `--shell-*` tokens to `src/routes/layout.css` next to the shadcn tokens.
2. Set the dark theme as the default shell (single theme in MVP; the `.dark` class stays
   available so a light theme is additive later).
3. Remove starter demo styling from screens that were deleted.
4. Product identity in `src/lib/config/app.ts`: name stays generic
   (`Placeholder Workspace`), `locale: 'en'`, no invented tagline copy.

Exit: no `#` hex outside `layout.css` and `assets.config.ts`; contrast check on muted text
passes 4.5:1.

## 10. Tests and evidence

| Layer | File / command         | Covers                                                         |
| ----- | ---------------------- | -------------------------------------------------------------- |
| Unit  | `bun run test:unit`    | slice barrels, guards, registry parity, `t()` coverage         |
| Type  | `bun run check`        | svelte-check + `tsc -p src/convex`                             |
| Lint  | `bun run lint`         | prettier + eslint + Svelte-5 guard                             |
| Build | `bun run build`        | production bundle                                              |
| E2E   | `bunx playwright test` | none currently (only `tests/dev-smoke.e2e.ts` exists)          |
| Dev   | `bun run test:dev`     | hydration + navigation keeps drafts (`tests/dev-smoke.e2e.ts`) |

> **Corrigendum (2026-10-30, `cc33ef0`).** Earlier revisions assigned AC01–AC18 to
> `tests/workspace.e2e.ts` (AC01, AC02, AC04, AC07, AC08, AC10, AC16) and
> `tests/acceptance.e2e.ts` (AC03, AC05, AC06, AC09, AC11–AC15, AC17, AC18). Both files were
> deleted by `6ed1f3e` along with the route family they targeted, and no AC id appears
> anywhere in `src/` or `slices/` — the only browser suite currently present is
> `tests/dev-smoke.e2e.ts`. Recover the scenario list from history
> (`git show ad4a909:tests/acceptance.e2e.ts`) and re-point it at current selectors before
> claiming the AC; see [progress.md](progress.md).

> **Recovery (2026-11-02).** That re-pointing is done for 14 of the 18 criteria in
> `tests/acceptance.e2e.ts`. AC05, AC09, AC13 and AC16 are marked **no longer applicable**:
> the deleted route family took the `offline` retry path, the dirty-tab contract, the
> capability catalog and the composer's authorization input with it. Read
> [ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md) before treating §5 as a green bar —
> AC03, AC06 and AC12 are also narrower than their text.

Playwright selects by role/name. No snapshot-only assertions. Add one test per AC that is
not already covered by unit tests.

## 11. Definition of done

- `bun run verify` and both Playwright suites pass on the exact commit.
- All six compositions reachable, at three widths, keyboard-only.
- Zero placeholder tokens hand-inlined; `t()` coverage test green.
- `CONTRACT.md`, `docs/architecture.md`, `docs/ui-spec.md` describe the shipped shape.
- No demo slice, no dangling route, no unused registry entry.
- Clean clone boots without `.env`.

## 12. Known deviations to record

If, during implementation, one of these becomes necessary, add a `// TODO(rr): …` at the
site and a commit-body note:

1. Using `apps/[slug]` for the workspace family instead of explicit routes (justified only
   if a second repeated family appears).
2. Any client-side fetch introduced before a backend contract exists (should not happen
   in MVP).
3. Any slice exceeding cohesion boundaries split purely for size — do not do this; see
   the P2 file-modularity rule.

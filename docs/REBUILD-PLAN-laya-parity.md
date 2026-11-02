# Rebuild plan — align this repo with the Laya NPU workspace UI/UX

Status: **executed 2026-10-29** (steps 1–7 landed; see `docs/laya-parity.md` for the shipped
shape and step 8–10 status). Owner: rahmanef63. Date: 2026-10-28, updated 2026-10-29.
This document supersedes the shell structure described in `docs/PRD.md`, `docs/ui-spec.md`,
`docs/implementation-plan.md`, `docs/state-model.md` and `docs/placeholder-copy.md` for the
next milestone. Those files describe the shipped 0.3.0 shell, which the owner judged too far
from the target UI/UX. Do not delete them; mark them superseded when the rebuild lands.

## 1. Decision

- Repository and product name: **`rahmanef63/codex-web`**, package name `codex-web`. The old
  name `codex-clone-placeholder` is retired; GitHub keeps a 301 redirect from it, and the
  sibling repo `rahmanef63/codex-desktop` is unchanged. Everything below that says "template"
  refers to the shared Laya workspace shell, not to a name.
- The _contents_ are rebuilt to match `rahmanef63/laya-npu`'s workspace UI/UX, because the
  owner wants one shared template: Laya keeps building product features on its side, and the
  template pulls the UI/UX back from Laya so both stay aligned.
- Laya is the source of truth for the UI at the moment of copy. Sequence matters:
  **Laya settles → copy → this repo becomes the template source → Laya pulls from here.**
  Do not copy while Laya is mid-change; a rebase against a moving 49 KB shell is wasted work.
- Laya is a local-first product with an Intel NPU/Python backend. This repo stays 0 backend,
  0 credential. Backend-coupled parts are replaced by local stubs behind the same contracts.

## 2. Why the current shell misses the target

The shipped shell is a from-scratch interpretation, not a copy. The visible gap, measured
against Laya's `current-desktop.png` and `renderSidebar()`:

| Region        | Laya                                                          | This repo (0.3.0)                             |
| ------------- | ------------------------------------------------------------- | --------------------------------------------- |
| Sidebar       | Search chats · New chat · Pinned · Recents (real chat titles) | New object · Priority · Context · Recent 1–24 |
| Rail          | 8+ destinations incl. tools, settings, user menu              | 3 destinations                                |
| Title bar     | Back/Forward, Sidebar, app menus, connection status           | File/Edit/View/Help placeholders              |
| Composer      | Attach · model/device · Record · Send/Stop                    | Access scope · Execution                      |
| Support row   | Session · Resources · Automation · panel toggle               | Context · Resources · Capabilities            |
| Output region | Tabs + working/kept model + shared view header                | Simple tab strip, no kept-tab model           |
| Settings      | Separate grouped surface, searchable categories               | Two-pane registry list                        |

Root cause: `docs/placeholder-copy.md` fixed a structure (generic object collections) that has
no relation to a chat workspace, so every slice inherited the wrong information architecture.

## 3. What is portable from Laya (verified, not estimated)

`workspace-shell.svelte` does **not** import Chat, Settings, SiteHeader, HostedGate or
WorkspaceLauncher. All product surfaces arrive as props. Only these modules are imported:

| Path in Laya                                      | Size                  | Portability                                                                                                                                                                                                                       |
| ------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slices/workspace-shell/workspace-shell.svelte`   | 49 112 B              | Portable. Imports only the shared sub-slices below plus 7 pure `#lib` modules.                                                                                                                                                    |
| `slices/workspace-shell/shared/feature-registry/` | 3 290 B + lib         | Portable, pure TS. Validated immutable registry, fails closed on unknown/duplicate ids.                                                                                                                                           |
| `slices/workspace-shell/shared/menu/`             | 2 604 + 1 697 + 613 B | Portable. `WorkspaceMenuItem` with nested `children` and explicit `registerMenuShortcuts`.                                                                                                                                        |
| `slices/workspace-shell/shared/launcher/`         | 889 B                 | Portable. `configuredNavigation()` filters unknown rail ids.                                                                                                                                                                      |
| `slices/workspace-shell/shared/runtime/`          | 565 + types           | Portable. `WorkspaceRuntimeAdapter = { connection(), listBackends() }` — read-only, no auth.                                                                                                                                      |
| `slices/workspace-shell/shared/effort/`           | 4 875 + 854 B         | Portable. Selector only; options come from the consumer.                                                                                                                                                                          |
| `slices/workspace-shell/shared/approval-mode/`    | 6 520 + 764 B         | Portable. Modes are consumer-supplied; grants no authority.                                                                                                                                                                       |
| `slices/workspace-shell/shared/browser-toolbar/`  | 3 500 + 746 + 641 B   | Portable if the consumer exposes browser capabilities; otherwise render nothing.                                                                                                                                                  |
| `src/lib/reference_workspace.ts`                  | 1 697 B               | Portable. `validPinnedSessions`, `togglePinnedSession`, `isNearLatest`, plus `visitRoute`/`stepRoute`/`visibleRegions`.                                                                                                           |
| `src/lib/output_tabs.ts`                          | 4 616 B               | Portable. `OutputTabState { tabs, kept }`, `restoreOutputTabs` with v1→v2 migration, `navigateOutputTab`, `keepOutputTab`, `newOutputTab`, `closeOutputTab`, `lastOutputAfterClose`, `chatPanelForOutput` / `outputForChatPanel`. |
| `src/lib/workspace_layout.ts`                     | 13 620 B              | Portable. Layout math, resize bounds, injected persistence adapter.                                                                                                                                                               |
| `src/lib/drafts.ts` + `draft_storage.ts`          | 1 183 + 1 922 B       | Portable. Namespaced draft store; drop Laya's `setHostedDraftScope`.                                                                                                                                                              |
| `src/lib/Icon.svelte`                             | 2 487 B               | Portable. Icon-name → glyph map; the registry speaks icon names.                                                                                                                                                                  |
| `src/lib/PanelResizeHandle.svelte`                | 2 583 B               | Portable. Pointer + keyboard resize.                                                                                                                                                                                              |
| `src/app.css`                                     | 2 281 lines           | Portable as the token source; merge into `src/routes/layout.css`, do not overwrite ours wholesale.                                                                                                                                |

Total ≈ 103 KB across 8 modules plus one shell slice with six shared sub-slices. Zero Python.

## 4. What must be written here (stubs behind the same contracts)

| Contract consumed by the shell | What to build                                                                 | Constraint                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat: WorkspaceChatComponent` | `slices/chat/` — timeline, composer, attachments, Send/Stop, draft per chat   | No `http.ts`; local stub turns a send into a timeline entry after a short delay, cancel keeps partial text. Reuse the guards already proven in 0.3.0. |
| `settingsWindow`               | `slices/settings-surface/` rebuilt as the grouped searchable Settings surface | Registry-driven, 27 sections; keep the AC12/AC15 revision and no-match logic already written.                                                         |
| `siteHeader`                   | Small component: product name, connection status chip, primary action         | No network; status is a prop/adapter value.                                                                                                           |
| `hostedGate`                   | Stub that renders children and reports "local"                                | Never gates on credentials; the repo boots with zero config.                                                                                          |
| `runtimeControls`              | Device/model selector stub fed by `WorkspaceRuntimeAdapter`                   | `listBackends()` resolves a single local backend; never claims NPU/GPU.                                                                               |
| `workspaceLauncher`            | Tool launcher: search, suggestions, recents                                   | Reuse the existing capabilities registry as the catalogue.                                                                                            |
| `registry.ts`                  | Feature descriptors: id, label, icon, group, placement, optional `loadScreen` | Labels are human-readable copy, not tokens.                                                                                                           |
| `persistence`                  | `WorkspacePersistence` over `localStorage`/`sessionStorage`                   | Namespace `codex:*`, not `laya:*`. Per §6 of the old state model: no credentials, approvals or file objects.                                          |

## 5. Placeholder copy rule change

The owner's instruction is explicit: **placeholder labels must be readable text, not `{}`
tokens.** 0.3.0 already implements this (`slices/placeholders/copy.ts` + `humanize()`); the
rebuild keeps that resolver and extends the copy table to Laya's labels:

- Resolver stays the single source of visible copy; components keep calling `t()`.
- Values are sentence-case labels (`New chat`, `Pinned`, `Recents`, `Search chats`), with
  periods only on sentences.
- Laya's own strings are ordinary product copy (`Chat`, `Automation`, `Transcribe`,
  `Models & downloads`) — copy them as-is; they are not placeholders.
- Families stay numbered (`recent_object_01..24` → `Recent object 1..24`).

## 6. Execution order

1. **Wait for Laya to settle.** Re-check `rahmanef63/laya-npu` head; confirm the owner says the
   UI is stable. Do not start earlier.
2. Snapshot Laya: `git clone` at that exact commit, record the SHA in this document.
3. Copy `slices/workspace-shell/**` and the eight portable `src/lib` modules. Rewrite `#lib`
   imports to `$lib`. Delete Laya-specific imports (`http`, `webmcp`, `HostedGate`,
   `RuntimeControls`, `SettingsWindow`, `WorkspaceLauncher`, `SiteHeader`, `Chat`,
   `laya_workspace_*`) and replace each with a prop supplied by our route.
4. Merge `src/app.css` tokens into `src/routes/layout.css`. Keep our `dark` class contract and
   shadcn token block; add Laya's `--color-*` set and the 43px/52px geometry values.
5. Write the seven stub surfaces from §4.
6. Build `src/routes/+page.svelte` as Laya does: a 50-line composition root passing props.
7. Delete the superseded slices: `app-shell`, `workspace`, `composer`, `workbench`. Keep
   `placeholders` (extended), `capabilities` (as the launcher catalogue), `settings-surface`
   (rebuilt). Remove their routes; keep `/workspace`, `/capabilities`, `/settings/[section]`
   only if the new shell still reaches them, otherwise let the shell own navigation.
8. Rewrite the four spec documents to describe the rebuilt shape, then re-point
   `docs/cloud-handoff.md` at the new slice map.
9. Browser-verify at 375 / 390 / 768 / 1440: sidebar drawer, rail, output open/close, kept vs
   working tab, resize by pointer and keyboard, Escape focus return, draft survives navigation,
   long-label truncation, no horizontal overflow, zero console errors.
10. Rebuild the e2e suites against the new DOM. Assert on roles and names, never on the old
    `data-slot` names that will disappear.

## 7. Guardrails that do not change

- Zero backend, zero credential, zero network in this repo. A clean clone boots.
- No secrets or per-user mutable state in a module singleton.
- shadcn-svelte primitives + `src/lib/components/app-ui` only; no second design system.
- Svelte 5 runes only; `scripts/check-svelte5.mjs` must stay green.
- Bun only; one `bun.lock`.
- `bun run verify`, both Playwright suites and `node scripts/smoke-node.mjs` (with
  `DEPLOY_TARGET=node`) must pass on the exact commit before claiming done.

## 8. Known traps (learned the hard way in 0.3.0)

- `scripts/smoke-node.mjs` asserts routes; any route-family change must update it in the same
  commit or CI goes red.
- `bun run build` with the Vercel adapter needs `runtime: 'nodejs22.x'` pinned in
  `svelte.config.js`; otherwise the build depends on the host Node version.
- Mobile: a collapsed secondary region must not reserve viewport height. Measured defect in
  0.3.0: the primary timeline was squeezed to 57 px at 375 px until the region sized itself.
- Two controls can legitimately share a word (`Capabilities` in the rail and in the composer
  support row). Scope Playwright locators to the region instead of renaming copy.
- `pkill -f "vite preview"` inside an agent's own shell kills the agent. Free port 4197 from a
  separate command.
- The workbench persists its layout, so an "open the panel" test helper must be idempotent.

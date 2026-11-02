# UI/UX guide

The shell is vendored from `rahmanef63/laya-npu` @ `9a893b2`. Its visual and interaction
contract is the shell's own:

- `slices/workspace-shell/README.md` — consumer contract, source boundaries, composition
- `src/routes/layout.css` — token source; it imports `../app-laya.css` for the shell's
  `--color-*` variables and element defaults
- [docs/laya-parity.md](docs/laya-parity.md) — what shipped, what deviates, how to re-sync

[DESIGN.md](DESIGN.md) remains the starter's generic design doctrine for anything written
outside the shell. Where the two disagree, the vendored shell wins for shell surfaces and
DESIGN.md wins for new product surfaces you add.

## Region hierarchy (as shipped)

| Layer | Role                                                                   | Owner                               |
| ----- | ---------------------------------------------------------------------- | ----------------------------------- |
| L1    | global rail (destinations, overflow, back/forward)                     | `workspace-shell.svelte`            |
| L2    | context navigation (chat sessions, settings categories, feature lists) | shell + `src/lib/views/Chat.svelte` |
| L3    | primary region (chat surface or feature screen)                        | `Chat.svelte`, lazy screens         |
| L4    | secondary region (tabbed output, working vs kept)                      | shell                               |
| L5    | transient layer (menus, launcher, dialogs)                             | shell                               |
| L6    | feedback layer (status chip, inline notices, error boundary)           | shell + `feature-host`              |

## Tokens

`src/routes/layout.css` carries two token sets:

1. the starter's shadcn block (`--background`, `--foreground`, `--border`, …)
2. Laya's shell block (`--color-page`, `--color-panel`, `--color-ink`, `--color-line`,
   `--color-execution`, …) plus the geometry values `--chat-*`.

Shell components use set 2. New product surfaces outside the shell may use either, but must
not introduce a third palette. No hex in a component.

## Controls

The shell already ships its primitives: `WorkspaceMenubar`, `WorkspaceMenuItems`, `Icon`,
`PanelResizeHandle` (inside the layout module), `ChatComposer`, `ChatSurface`, `MessageFrame`,
`ModeSwitch`, `ChatListRow`, `ChatGroupHeader`, `ComposerPicker`, `ApprovalModeSelector`,
`EffortSelector`, `BrowserToolbar`. Use those before `$lib/components/ui`.

## Focus and keyboard

Implemented in the shell: Escape closes the topmost layer and returns focus to its trigger;
the menubar has roving focus and registered shortcuts; the split handle is a focusable range
input with arrow-key resize; the skip link jumps to the chat region. Do not re-implement any
of these in consumer code.

## Copy

Real copy, not `{}` tokens. The shell's `labels.ts` supplies the neutral defaults and
`WorkspaceApp` passes only the overrides it needs. Product copy belongs to the product; the
template's copy is deliberately generic (`Workspace Template`, `Chat`, `Notes`, `Files`).

No second copy resolver exists: `slices/placeholders` was removed with the 0.3.0 shell.

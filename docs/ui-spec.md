# UI specification — workspace shell

> **Superseded.** The region hierarchy and composition table below describe the 0.3.0 shell
> (`/workspace`, `/capabilities`, `/settings/[section]`), deleted by `6ed1f3e`. The shipped
> shell is Laya's, vendored — it does not follow this region hierarchy. Read
> [laya-parity.md](laya-parity.md) for the actual shape and [README.md](README.md) for the
> index. The token and focus decisions here remain the reasoning behind
> `src/routes/layout.css`.

Structural contract for the shell. Reference implementation for _layout only_ is
`docs/reference/workspace-prototype.html`; the tokens below are design decisions for this
repository, not measurements copied from any product.

## 1. Region hierarchy

Seven layers. Not every composition shows all seven.

| Layer | Role               | Owner slice    | Required                    |
| ----- | ------------------ | -------------- | --------------------------- |
| L0    | host frame         | —              | no (browser chrome owns it) |
| L1    | global navigation  | `app-shell`    | yes                         |
| L2    | context navigation | per area       | no                          |
| L3    | primary region     | `workspace`    | yes                         |
| L4    | secondary region   | `workbench`    | no                          |
| L5    | transient layer    | `app-shell`    | no                          |
| L6    | feedback layer     | shell + slices | yes                         |

Rules:

1. L1 keeps orientation constant while L2–L4 change.
2. L2 content follows the active area: workspace → collections, capabilities → installed
   list, settings → category tree.
3. L3 and L4 sit adjacent (`adjacent_regions`) or swap (`focused_region`) — never nested.
4. L5 never holds the only copy of long-lived information.
5. Exactly one outer chrome. `app-shell` owns it; areas mount inside.

## 2. Compositions

Six renderable compositions. MVP renders them as _states_, not as six separate routes.

| ID  | Name                                    | Trigger                         |
| --- | --------------------------------------- | ------------------------------- |
| C1  | populated primary + secondary + summary | object selected, workbench open |
| C2  | unstarted + expanded context navigation | `/workspace`, no object         |
| C3  | unstarted + split secondary             | `/workspace` + workbench open   |
| C4  | anchored destination overflow           | rail overflow trigger           |
| C5  | capability catalog                      | `/capabilities`                 |
| C6  | categorized configuration               | `/settings/[section]`           |

A composition is a product of state, never a URL. Only C5/C6 map to their own routes.
One `Composition` type in `slices/app-shell/types.ts` names them for tests and for the
prototype-parity harness.

## 3. Design tokens

Dark-first, single theme in MVP. Extend `src/routes/layout.css`; do not hardcode hex in
components.

```css
/* shell tokens, added alongside the existing shadcn tokens */
:root {
	--shell-rail: oklch(0.24 0 0);
	--shell-surface: oklch(0.2 0 0);
	--shell-surface-raised: oklch(0.26 0 0);
	--shell-border: oklch(0.3 0 0);
	--shell-fg: oklch(0.94 0 0);
	--shell-fg-muted: oklch(0.72 0 0);
	--shell-accent: oklch(0.62 0.16 300);
	--shell-accent-soft: oklch(0.62 0.16 300 / 0.14);
	--shell-warn: oklch(0.75 0.13 60);
	--shell-rail-width: 3.25rem;
	--shell-sidebar-width: 15rem;
	--shell-sidebar-width-narrow: 13.75rem;
	--shell-titlebar-height: 2.6875rem;
}
```

Component classes use semantic utilities: `bg-background`, `text-foreground`,
`border-border`, plus the `--shell-*` custom properties through Tailwind arbitrary values
where shadcn has no equivalent. A raw `#rrggbb` in a `.svelte` file fails review.

Contrast targets: body text ≥ 4.5:1, muted ≥ 4.5:1 on `--shell-surface`, focus ring
≥ 3:1 against both surface and rail. Placeholder tokens are `--shell-fg-muted`, never
lower.

## 4. Responsive composition

Mobile-first: single column base, then widen.

| Range        | Rail                           | Sidebar                                     | Primary           | Secondary                    |
| ------------ | ------------------------------ | ------------------------------------------- | ----------------- | ---------------------------- |
| `< 650px`    | 45px icon rail, drawer trigger | absolute drawer overlay, `100vw - 55px` max | full width        | full width, replaces primary |
| `650–850px`  | 52px                           | inline, hidden while split                  | flex-1            | replaces or narrows primary  |
| `850–1100px` | 52px                           | inline, 220px                               | flex-1, min 300px | 46%, min 340px               |
| `> 1100px`   | 52px                           | inline, 240px                               | flex-1, min 320px | 40%, min 390px               |
| `> 1600px`   | 52px                           | inline, 240px                               | flex-1            | 40% capped                   |

Additional rules:

- Touch targets ≥ 44×44 CSS px on touch widths; icon buttons get padding, not smaller icons.
- Splitter is keyboard-resizable (`ArrowLeft`/`ArrowRight`, 20px steps) and clamps to
  `[340, containerWidth - 320]`.
- Below 650px the secondary region takes over the primary region; going back restores
  the previous primary state (draft, scroll, tabs).
- The shell is `h-dvh` with `overflow: hidden`; only intended regions scroll.
- `prefers-reduced-motion` disables transition/animation, not state change.

## 5. Controls inventory

Every control names its primitive or its reason for not using one.

| Control                     | Primitive                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Rail destination            | `Button` (ghost, icon) + `aria-current`                                                       |
| Sidebar row                 | `Button` (ghost, full width) — not a link, it changes local state                             |
| Mode switch                 | `SegmentedControl` (`app-ui`)                                                                 |
| Composer textarea           | `Textarea` with auto-grow                                                                     |
| Attachment chip             | `Button` + remove `Button` (nested buttons are not allowed → use a group with two focusables) |
| Access / execution selector | `DropdownMenu`                                                                                |
| Submit                      | `Button` (icon, `aria-label` + reason tooltip)                                                |
| Tab close                   | `Button` (icon) inside a non-interactive tab container                                        |
| Setting toggle              | `Switch` (native semantics via bits-ui)                                                       |
| Setting select              | `Select`                                                                                      |
| Overflow menu               | `DropdownMenu` with roving focus                                                              |
| Context summary             | `Popover`                                                                                     |
| Toast                       | Shared feedback primitive (`app-ui`), `role="status"`                                         |
| Settings search             | `Input` with a labelled search region                                                         |
| Capability detail           | Plain semantic markup + `Button`                                                              |

Rules: no raw `<button>`/`<a>`/`<img>` for interactive UI (lint-enforced). Icon-only
controls require an accessible name. Destructive or irreversible actions need explicit
confirmation copy — placeholders here, real copy before any product release.

## 6. Focus and keyboard contract

1. One overlay at a time; opening a second closes the first.
2. `Escape` closes the topmost layer only, then returns focus to its trigger (AC11).
3. Overflow menus: `ArrowDown`/`ArrowUp` cycle, `Home`/`End` jump, `Escape` closes.
4. Tab order follows visual order: title bar → rail → sidebar → primary → secondary.
5. Drawer sidebar traps focus while open on mobile and restores it on close.
6. Splitter is focusable with `role="separator"`, `aria-orientation="vertical"`,
   `aria-valuenow` reflecting the clamped width.
7. Never move focus as a side effect of data arrival (AC14/AC17).

## 7. Feedback states

Every asynchronous region implements all of these. A missing state fails review.

| State        | Presentation                                              |
| ------------ | --------------------------------------------------------- |
| `unknown`    | skeleton, no spinner-only blank region                    |
| `loading`    | skeleton or inline status with an accessible name         |
| `empty`      | explanatory token + the action that fills it              |
| `partial`    | rendered data + a marker of what is missing               |
| `error`      | inline `SignalBanner` with retry; shell stays intact      |
| `restricted` | the control is present but disabled with a visible reason |

`alert()` is never product UX. Toasts are transient; anything durable is inline.

## 8. Copy surface

All strings are placeholder tokens resolved by `t()`. See
[placeholder-copy.md](placeholder-copy.md). The two exceptions are the generic
accessibility words `Close`, `Remove`, `Add` and real user data (file names, counts).

Do not write sentences that explain the prototype ("this is a demo", "coming soon") — the
absence of copy is the product statement here.

## 9. Verification

- Unit: composition derivation, submit guard, tab close guard, splitter clamp, `t()` coverage.
- Playwright (`390`, `768`, `1440`): C1–C6 reachable, drawer behaviour, Escape focus
  return, split toggle without state loss, no horizontal overflow.
- Dev smoke: hydration without mismatch, rail navigation keeps drafts.
- A11y: keyboard-only pass over the six compositions; accessible names asserted in tests,
  not eyeballed.

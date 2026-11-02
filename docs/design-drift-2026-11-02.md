# Design-system drift, 2026-11-02

Scope: the vendored Laya shell in `slices/workspace-shell/`, the screens in `src/lib/`, and the
two stylesheets that carry the tokens, `src/routes/layout.css` and `src/app-laya.css`.

Method: read both stylesheets and every `.svelte` file, then diff what each one declares against
what the markup actually consumes. Counts below are from that pass, not from a sample.

The finding in one line: the shell was vendored with its own naming scheme on top of an existing
shadcn token set, and the two were never reconciled. `layout.css` now defines the shadcn set three
times plus the shell set once, `app-laya.css` defines both again, and the components split roughly
evenly between the two vocabularies. A third of `app-laya.css` still styles a chat surface that no
longer exists.

## 1. Tokens

### 1a. Tokens used but never defined (real rendering bugs, all fixed)

These are the worst kind: `var()` with no definition and no fallback resolves to nothing, so the
declaration dies silently.

| Token                                                        | Call sites                                                                                                                       | Effect before the fix                                                                                                                          | Status                                                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--ink`, `--ink-2`, `--ink-3`, `--line`, `--panel`, `--mono` | `src/lib/Deps.svelte:171-301`, 18 uses                                                                                           | The whole dependency panel had no border, no background and no text colour. It inherited the page ink, so every muted label read as body text. | Fixed, mapped to `--color-ink*`, `--color-line`, `--color-panel`, `--font-mono`                                 |
| `--ink-3`                                                    | `src/lib/views/Chat.svelte:3717`                                                                                                 | `.reference-chat .project-create` lost its muted colour.                                                                                       | Fixed, mapped to `--color-ink-3`                                                                                |
| `--color-line-strong`                                        | `ModeSwitch.svelte:55`, `Chat.svelte:3865`, `ChatComposer.svelte:53`, `ComposerPicker.svelte:140`, `WorkspaceMenubar.svelte:181` | The selected chat mode lost its border. Three call sites already had a `var(--color-line)` fallback, two had none.                             | Fixed: token added at `layout.css:487` (`#343434`, the value the menubar already carried as a literal fallback) |
| `--color-error`                                              | `WorkflowCanvas.svelte:986`                                                                                                      | Failed nodes fell back to the literal `#e78585`.                                                                                               | Fixed, mapped to the existing `--color-destructive`                                                             |
| `--color-surface-2`                                          | `ArtifactFrame.svelte:51`                                                                                                        | Fell back to `rgba(0,0,0,.03)`, a light-theme wash on a dark panel.                                                                            | Fixed, mapped to the existing `--color-panel-2`                                                                 |
| `--color-nav`                                                | `ChatListRow.svelte:71`, `Chat.svelte:3692` and `:3864`                                                                          | Both always took the `var(--color-panel)` fallback, so the token did nothing.                                                                  | Fixed: call sites collapsed to `var(--color-panel)`, which is what they resolved to                             |

### 1b. Hardcoded colours that map to an existing token (fixed)

| Literal              | Where                                            | Mapped to                    | Note                                                                                                                                                                |
| -------------------- | ------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#262626`            | `layout.css:667` scrollbar thumb                 | `--color-panel-2`            | Same value; the scrollbar was the one place the theme could not reach.                                                                                              |
| `#2a2a2a`            | `layout.css:745` `.btn:hover` border             | `--color-line-2` (`#242424`) | **Behaviour change:** hover borders get 2.4% darker. Flagged rather than silent: the literal had no token because the hover state was patched in after the palette. |
| `#b2b2b2`            | `app-laya.css:1566` `--ring`                     | `var(--color-ink-2)`         | Same value, now one source.                                                                                                                                         |
| `#454545`            | `app-laya.css:1584` `.app-select-trigger` border | `var(--input)`               | Same value; `--input` is `#454545` at that scope.                                                                                                                   |
| `#202020`            | `WorkspaceMenubar.svelte:183`                    | `var(--color-frame)`         | The literal was a duplicate fallback for a token that exists.                                                                                                       |
| `#343434`            | `WorkspaceMenubar.svelte:181`                    | `--color-line-strong`        | The literal became the token's value.                                                                                                                               |
| `border-radius: 6px` | 34 sites in 14 files                             | `var(--radius-card)`         | Exact match, the token is `6px`.                                                                                                                                    |

### 1c. Hardcoded values with no token to map to (flagged, not invented)

Each of these is a real gap. I did not add a token for any of them, because the right value is a
design decision, not a mechanical substitution.

| Pattern                         | Sites                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Why it is flagged                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Semantic status literals        | `#43cb7a` ×6 (`Deps.svelte:205,255`, `Compute.svelte:135,181,248`, `Playground.svelte:638`), `#e9c93a` ×6 (`Deps.svelte:208,220,259`, `Compute.svelte:137,251`, `Voice.svelte:274`), `#f43e64` ×2 (`Compute.svelte:250`, `Playground.svelte:639`), `#e15b5b` (`BrowserAutomation.svelte:966`), `#f58c98` (`Recorder.svelte:219`), `#74bc95` (`workspace-shell.svelte:1926`), `#9cddb4` ×2 (`Apps.svelte:824,909`), `#6fa68a`/`#e8f2ec`/`#f5b96d` (`Snake.svelte` canvas) | There is no `--color-success`, `--color-warn` or `--color-info`. Eight slightly different greens are doing one job. Adding three tokens is a palette decision (see §5).                                      |
| Error-surface literals          | `#241417`+`#f9b5c0`+`#5c343c` (`app-laya.css:166-179`), `#241417`+`#ffb4c2`+`#69343f` (`app-laya.css:180-189`), `#241616`+`#7b3a3a`+`#ffb4b4` (`Snake.svelte:811-814`), `#715b36`+`#f2d6a3` (`SnakeHistory.svelte:396-397`), `#ffb4c2` (`Recorder.svelte:223`)                                                                                                                                                                                                           | Four hand-mixed error palettes. `--color-destructive` exists but has no surface/wash pair, so each author mixed their own. All pass 4.5:1 on their own background (checked), which is why they survive.      |
| Chart / visualisation literals  | `#88b29d`, `#d19564`, `#7cbc9e`, `#a5dfbd` ×3 (`Embeddings.svelte`), `#a66aff` ×2 (`BrowserCanvas.svelte:168,443`), `#35a8ff` ×2 (`BrowserAutomation.svelte:307,312`), `#030303` ×3 (`Playground.svelte:611,665`, `Voice.svelte:267`)                                                                                                                                                                                                                                    | Data-encoding and SVG-canvas colours. `--chart-1..5` exist and are unused; they are grayscale (generated from the shell palette), so they cannot encode two categories. Needs a decision, not a rename.      |
| Scrim opacity                   | `rgb(0 0 0 / .45)` ×2, `.55`, `.58`, `#0008`, `#0009`                                                                                                                                                                                                                                                                                                                                                                                                                    | Six scrim values across overlays and drawers. Consolidated the three dialog scrims to `.45` (§2); the drawer scrims stay as-is because they darken a different thing.                                        |
| Popover shadow                  | `0 8px 22px rgb(0 0 0 / .24                                                                                                                                                                                                                                                                                                                                                                                                                                              | .25                                                                                                                                                                                                          | .28)`, `0 8px 24px / .24`×3,`0 12px 30px #0004`×2,`0 12px 32px #0006`, `0 18px 48px / .4` | Seven elevation recipes, no `--shadow-*` token. Collapsing these needs an elevation scale, which is a design decision. |
| Arbitrary type sizes            | 323 occurrences of `text-[…px]` across 307 files (`text-[12px]` ×69, `text-[13px]` ×60, `text-[11.5px]` ×55, `text-[12.5px]` ×49, `text-[11px]` ×39, and ten more fractional steps)                                                                                                                                                                                                                                                                                      | The type scale lives in people's heads. The 13px root plus ten arbitrary sizes is a six-step scale spelled 323 ways. A token set here would be the single largest change in the app; flagged, not attempted. |
| Radii that are not on the scale | `12px` ×16, `8px` ×34, `7px` ×9, `4px` ×8, `2px` ×7, `5px` ×6, `3px` ×4, `10px` ×4, `16px`, `18px`, `20px`, `22px`, `24px`                                                                                                                                                                                                                                                                                                                                               | `--radius-card` (6px) covers the exact match. The rest are 12 distinct radii against a 4-step token scale. Only the 6px ones were safe to map.                                                               |

### 1d. Dark/light parity

There is no light theme. `+layout.svelte:130` hardcodes `<div class="dark …">` and
`layout.css:571` sets `color-scheme: dark`, so the `.dark` blocks are the shipping theme and the
`:root` light values are dead weight that still cost a cascade pass.

Concretely: `--chart-*`, `--sidebar-*` and `--radius` are defined in `:root` light **and** in both
dark blocks, but every component renders inside `.dark`, so the light values never apply. The
`layout.css` `:root` block at line 12 declares 40 tokens; 22 of them (the `--app-*` and `--shell-*`
groups) have no `.dark` counterpart at all — harmless today because they are layout dimensions, not
colours, but it means adding a light theme later silently inherits dark geometry.

Token blocks, in cascade order:

| File:line           | Selector        | Tokens                                              | Reached?                                                            |
| ------------------- | --------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `layout.css:12`     | `:root`         | 40 (light shadcn + `--app-*` + `--shell-*`)         | Layout tokens yes, light colours no                                 |
| `layout.css:57`     | `.dark`         | 18                                                  | Yes                                                                 |
| `layout.css:77`     | `@theme inline` | 20 aliases                                          | Yes (Tailwind)                                                      |
| `layout.css:465`    | `@theme`        | 44 tokens (`--color-page` … `--radius-4xl`)         | Yes (Tailwind)                                                      |
| `layout.css:570`    | `:root`         | 31 dark shadcn + chart + sidebar                    | Yes. **This block re-declares the theme as dark for everyone**      |
| `app-laya.css:1468` | `.dark`         | 31                                                  | Yes, identical values to `layout.css:570`                           |
| `app-laya.css:1503` | `:root`         | 19, remapping shadcn onto the `--color-*` shell set | Yes. **`--radius: 0.5rem` here overrides `layout.css`'s `0.75rem`** |

Two tokens resolve differently from what `DESIGN.md:64` claims:

- `DESIGN.md` says the base radius is `0.75rem`. The shipped value is `0.5rem` (`app-laya.css:1504`
  wins the cascade). At the 13px root that is 6.5px, while `--radius-card` is a hard `6px`. Two
  radii, 0.5px apart, both called "the base".
- `DESIGN.md:62` says the semantic tokens "have light/dark definitions". Only 18 of the 40 at
  `layout.css:12` do.

### 1e. Tokens defined and never consumed (dead, 39)

`--shell-accent`, `--shell-accent-soft`, `--shell-warn` (3 shell tokens, 0 uses), `--radius-2xl`,
`--radius-3xl`, `--radius-4xl`, `--card-spacing`, `--title`, plus the `--color-*` aliases and
`--color-chart-*`/`--color-sidebar-*` families that exist only so Tailwind's `@theme` can generate
utilities the app never asks for. The `--color-*` ones are load-bearing for shadcn primitives, so
they stay; `--shell-accent*` and `--shell-warn` are genuinely dead.

## 2. Duplication

### 2a. Dialog shells — three copies, consolidated

| Copy                 | Markup                             | Styles                                                                                         |
| -------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Settings             | `SettingsWindow.svelte:44-45`      | `:global(.settings-overlay)` + `:global(.settings-window)`, `SettingsWindow.svelte:83-105`     |
| Keyboard shortcuts   | `workspace-shell.svelte:1565-1566` | `:global(.shortcut-overlay)` + `:global(.shortcut-dialog)`, `workspace-shell.svelte:1633-1650` |
| Chat context summary | `Chat.svelte:2370-2371`            | `:global(.chat-summary-overlay)` + `:global(.chat-summary-dialog)`, `Chat.svelte:3371-3389`    |

Genuinely the same component: `bits-ui` `Dialog.Root` + `Portal` + `Overlay` + `Content`, centred,
`inset: 0` scrim, `--color-panel` surface, `--color-line` border, `12px` radius. Consolidated into
`.dialog-overlay` + `.dialog-shell` (`layout.css`, new `@layer components` block). Sizing, z-index
and padding stay per dialog, because they legitimately differ. Scrim opacity unified to `.45`; the
settings window had `.58`, which was a typo-level divergence, not a decision.

### 2b. Dropdown menus — two implementations, flagged

| Implementation       | Markup                                        | Styles                                                                                                       |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `WorkspaceMenuItems` | `shared/menu/menu-items.svelte:9-49`          | `:global(.workspace-menu-content)`, `:global(.workspace-menu-item)`, `menu-items.svelte:54-110`              |
| `WorkspaceMenubar`   | `shared/menu/WorkspaceMenubar.svelte:126-148` | `:global(.workspace-menubar-content)`, `:global(.workspace-menubar-item)`, `WorkspaceMenubar.svelte:152-229` |
| Browser menu (third) | `views/BrowserCanvas.svelte:241,268`          | `:global(.browser-menu)`, `:global(.browser-menu-item)`, `BrowserCanvas.svelte:509-543`                      |

Two are defensible: the menubar is a menubar (`bits-ui` `Menubar`, roving `data-highlighted`), the
other two are dropdowns. But the padding, radius and item height differ for no reason:
`min-height: 28px` vs `32px`, `border-radius: 4px` vs `10px` vs `8px`, `padding: 4px` vs `4px` vs
`5px`. The browser menu also never received the `:focus-visible` fix the other two have, so
ArrowDown moved focus invisibly there. **Fixed the focus ring; flagged the sizing.** Consolidating
the two dropdowns means rewriting `BrowserCanvas`'s two menus onto `WorkspaceMenuItems`, which
changes markup the acceptance tests read. Not done.

### 2c. Empty states — six anatomies, flagged

Same job, six treatments. Not merged: they carry different content (an icon is not always right,
one is inside an absolutely-positioned canvas).

| State                                          | Anatomy                                     | Centring                                                                       | Icon             |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ | ---------------- |
| `views/Apps.svelte:597` `.empty`               | icon, two paragraphs                        | `align-items: flex-start`, `min-height: 300px`                                 | `folder`, 28px   |
| `views/FileCanvas.svelte:412` `.empty`         | icon, strong, two paragraphs, CTA button    | centred, `min-height: 100%`, `padding: 32px`                                   | `folder`, 28px   |
| `views/Embeddings.svelte:528` `.empty-state`   | decorative route graphic, strong, paragraph | `flex-start`, `min-height: 420px`, `max-width: 48ch`                           | none             |
| `BrowserAutomation.svelte:628` `.canvas-empty` | icon, h3, paragraph                         | centred, `position: absolute; inset: 0`                                        | varies           |
| `WorkflowCanvas.svelte:842` `.canvas-empty`    | icon, h3, paragraph                         | `justify-items: center`, `padding: 70px 20px`, **has a border**, `radius 12px` | `workflow`, 32px |
| `SnakeHistory.svelte:163` `.empty`             | one line                                    | none, `padding: 8px 0`                                                         | none             |

Only `WorkflowCanvas` draws a border around its empty state; that is the clearest divergence. The
`BrowserAutomation`/`WorkflowCanvas` heading is `h3` at 16px, `FileCanvas`/`Apps` use `strong` with
no heading element. That is an a11y difference, not just visual: two of the six announce a heading
and four do not.

### 2d. Button, twice — flagged

`class="btn"` (160 uses, `layout.css:728-760`) and `<Button>` (70 uses,
`components/ui/button/button.svelte`). Both are "the button". They disagree on everything:

|            | `.btn`                                            | `<Button>`                                |
| ---------- | ------------------------------------------------- | ----------------------------------------- |
| Height     | `min-height: 36px`                                | `h-8` (26px at the 13px root)             |
| Radius     | `var(--radius-card)` (6px)                        | `rounded-lg` (`var(--radius-lg)` = 6.5px) |
| Padding    | `5px 10px`                                        | `px-2.5`                                  |
| Focus ring | `outline: 2px solid var(--color-ink)`, offset 3px | `focus-visible:ring-3 ring-ring/50`       |
| Border     | `1px solid var(--color-line)`                     | `border-transparent`                      |

Not merged: `<Button>` is vendored shadcn and is what the a11y suite's `[data-slot="button"]`
selectors and the focus-ring test target; `.btn` is the shell's own and is used for every
toolbar control. Merging either way is a visual-identity change. What is fixed is the divergence
that is purely a bug: 11 `<a class="btn">` elements styled as buttons (`Compute.svelte:267`,
`Voice.svelte:284`, `Pricing.svelte:66`, `Playground.svelte:369`, `Providers.svelte:58`,
`Setup.svelte:158-159`, `Overview.svelte:48,81,103,105`, `RecoveryNotice.svelte:33`,
`SiteHeader.svelte:108`) — these are correctly `<a href>` navigation, so the markup is right and
only the class is shared. No change needed; recording it so the next pass does not "fix" them into
`<button>`.

### 2e. Popovers — three, flagged

`effort-selector.svelte:125-134`, `approval-mode-selector.svelte:144-153` and
`menu-items.svelte:58-68` each define their own popover surface. The first two are identical
(`--color-panel-2`, `--color-line`, same shadow, `z-index: 110`) and differ only in radius
(`14px` vs `12px`) and width. Same component, different author.

### 2f. Dead CSS — removed

`app-laya.css` carried 350 lines of rules for a chat surface that no longer exists. Verified
against all 426 source files before removal: 69 rules, zero references.

Removed selectors: `.app-body`, `.app-sidebar`, `.site-header`, `.brand-mark`, `.header-tagline`,
`.workspace-toolbar`, `.desktop-breadcrumb`, `.workspace-privacy`, `.workspace-content`,
`.mobile-page-picker`, `.nav-group-title`, `.nav-footnote`, `.connection-alert`,
`.comparison-scope-note`, `.chat-layout`, `.chat-model`, `.chat-model-heading`,
`.chat-model-controls`, `.chat-details`, `.chat-setup-note`, `.chat-transcript`, `.chat-empty`,
`.chat-suggestions`, `.chat-message-content`, `.chat-user`, `.chat-metrics`, `.chat-generating`,
`.chat-composer-bottom`, `.chat-keyboard-hint`, `.chat-first-header`, `.primary-tabs`,
`.model-settings-trigger`, plus their nested and `@media` overrides. One `@media (max-width: 1100px)`
block was left empty by the removal and is gone too.

`layout.css` also still defines the shell layout classes (`.shell-root`, `.shell-rail`,
`.shell-body`, `.shell-sidebar`, `.shell-titlebar`, `.shell-primary`, `.shell-fg-muted`) and the
`--shell-*` token group. **These are not dead** — `docs/ui-spec.md:62-75` documents them as the
shell's public token contract and the vendored `workspace-shell.svelte` is the consumer of the
tokens even though it does not use those class names. Left alone.

## 3. Surface consistency

Heading scale, spacing rhythm, border and focus treatment compared across the four surfaces.
"Majority" is the value more than half of the surfaces use.

| Property             | Settings window                                       | Chat surface                                                   | Canvas views                                                                                                           | Panels / inspector                   | Majority                              | Divergent                                                                                                                                    |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Panel heading        | `19px/600` (`SettingsWindow.svelte:172`)              | `17px/600` (`app-laya.css:746`)                                | `18px/600` (`BrowserCanvas.svelte:679`), `19px` (`BrowserAutomation.svelte:819`), `16px` (`WorkflowStudio.svelte:600`) | `17px/600` (`Embeddings.svelte:602`) | none — 16/17/18/19 all used           | **all four**                                                                                                                                 |
| Dialog/section title | `15px/600`                                            | `18px` (`workspace-shell.svelte:1643`)                         | —                                                                                                                      | `12px` (`Chat.svelte:3553`)          | —                                     | shortcuts dialog is 18 against a 15 baseline                                                                                                 |
| Sub-heading          | `h3` `13px/600` (`approval-mode-selector.svelte:156`) | `13px/600` (`app-laya.css:753`)                                | `13px` ×7, `15px` ×2, `16px` ×3                                                                                        | `13px/600` (`Embeddings.svelte:608`) | `13px/600` (10 of 16)                 | `15px` (`Snake.svelte:727`, `SnakeHistory.svelte:312`), `16px` (`Apps.svelte:678`, `Playground.svelte:733`, `BrowserAutomation.svelte:1007`) |
| Border               | `1px solid var(--color-line)`                         | same                                                           | same, but `WorkflowCanvas` empty state adds one where none exists                                                      | same                                 | `--color-line` 1px                    | consistent                                                                                                                                   |
| Focus ring           | none of its own; inherits base `:focus-visible`       | `2px solid var(--color-ink)`                                   | mixed: `--color-ink` ×2, `--color-execution` ×3, `--color-ink-2` ×1                                                    | inherits base                        | `2px solid var(--color-ink)`, 8 of 13 | **`--color-execution` (5 sites) and `--color-ink-2` (`RichText.svelte:143`)**                                                                |
| Empty-state          | n/a                                                   | `conversation-empty` — logo, h1, paragraph, suggestion buttons | six different anatomies (§2c)                                                                                          | n/a                                  | —                                     | **all**                                                                                                                                      |
| Content padding      | `24px 28px`                                           | `24px max(24px, …)` (`ChatSurface.svelte:88`)                  | `20px 16px` → `1.5rem 1.75rem`                                                                                         | `24px 20px` (`app-laya.css:745`)     | 24px inline start                     | canvas views at 20px                                                                                                                         |
| Section gap          | `22px`                                                | `16px`                                                         | `12px`/`14px`/`18px`                                                                                                   | `10px`-`18px`                        | —                                     | **all**                                                                                                                                      |
| Sidebar width        | `225px`                                               | `248px` → `260px` (`app-laya.css:566,1121`)                    | —                                                                                                                      | `340px` → `360px`                    | —                                     | settings `225` vs chat `248`                                                                                                                 |

The heading table is the sharpest result: **there is no heading scale**. `h2` is set to 12px in
three places (`WorkspaceLauncher.svelte:112`, `SectionNav.svelte:61`, `Chat.svelte:3553`) and to
19px in two. Fifteen distinct `(tag, size)` pairs across 30 declarations. Flagged, not fixed: a
type scale is the design decision the whole app is missing, and inventing one here would be a
redesign.

The focus ring is the one I would fix next: `--color-execution` is the purple accent
(`#8050ce`), and at 2.85:1 against `--color-panel-2` it fails the 3:1 non-text contrast bar
(antislop-human §Non-Text Contrast, WCAG 1.4.11). Measured with
`skills/antislop-human/contrast-check.py`. It is used for the effort and approval-mode selectors'
focus rings, which is exactly the control a keyboard user needs to see.

## 4. What was fixed

| Change                                                                                       | Files                                                                                               |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Six undefined tokens mapped to the tokens that already meant the same thing                  | `Deps.svelte`, `Chat.svelte`, `WorkflowCanvas.svelte`, `ArtifactFrame.svelte`, `ChatListRow.svelte` |
| `--color-line-strong` added with the value the menubar was already hardcoding                | `layout.css`                                                                                        |
| Six literal colours replaced with the token of the same value                                | `layout.css`, `app-laya.css`, `WorkspaceMenubar.svelte`                                             |
| 34 × `border-radius: 6px` → `var(--radius-card)`                                             | 14 files                                                                                            |
| Three dialog implementations consolidated to `.dialog-overlay` + `.dialog-shell`             | `layout.css`, `SettingsWindow.svelte`, `workspace-shell.svelte`, `Chat.svelte`                      |
| Missing keyboard focus ring on the browser menu                                              | `BrowserCanvas.svelte`                                                                              |
| Missing keyboard focus ring on the launcher search (had `outline: none` with no replacement) | `WorkspaceLauncher.svelte`                                                                          |
| 350 lines of dead chat CSS removed, plus one emptied `@media` block                          | `app-laya.css`                                                                                      |

Net: 24 files, +108 / −496.

Nothing in the visual identity moved. The two deliberate visual changes are the `.btn:hover`
border (2.4% darker) and the settings scrim (`.58` → `.45`), both listed above so they can be
reverted if they were intended.

## 5. Open decisions (for a human, not an agent)

1. **Is there ever a light theme?** If no, the `:root` light blocks at `layout.css:12` and
   `layout.css:77` (light half) should be deleted and `document.documentElement` should get
   `class="dark"` from the markup rather than relying on a hardcoded `:root` override at
   `layout.css:570`. If yes, 22 `--app-*`/`--shell-*` tokens have no light counterpart to design.
2. **Base radius: `0.5rem` or `0.75rem`?** `DESIGN.md` says one, the cascade ships the other, and
   `--radius-card` is a third value 0.5px off both.
3. **A type scale.** 323 arbitrary sizes is not a token gap, it is the absence of a scale. This
   needs a decision before any component work.
4. **Status colours.** `--color-success`, `--color-warn`, `--color-info` and a `--color-destructive`
   surface/wash pair would absorb 17 of the 35 literal colours. Eight greens currently do one job.
5. **Elevation scale.** Seven shadow recipes, no token.
6. **One button.** `.btn` and `<Button>` disagree on height by 10px. Pick one before adding UI.

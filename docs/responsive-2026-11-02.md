# Responsive audit and fixes (2026-11-02)

Scope: the workspace shell (`slices/workspace-shell/`) and the eight surfaces reachable from
the rail and the launcher (`chat`, `manef`, `apps`, `transcribe`, `files`, `browser`,
`terminal`, `overview`). Every number below was measured in Chromium against the shipped
build, not read off a stylesheet. Each defect has a Playwright test in
`tests/responsive.e2e.ts` that fails if it returns. No new dependency.

Prior state: the only responsive coverage was the `narrow-mobile` project (iPhone SE,
320x568) and the `mobile` project (iPhone 13, 390x844), each running the acceptance and
a11y specs. Nothing asserted overflow, nothing measured a target, and no test touched a
tablet, a laptop, a large monitor, landscape, or zoom.

## Two measurement notes that change the result

**1. `scrollWidth` alone proves nothing here.** `html` and `body` both carry
`overflow: hidden` (`src/routes/layout.css:593-596`), so `document.documentElement.scrollWidth`
equals `innerWidth` even when a child sticks out. The audit measures twice: it walks every
element, skips any that an `overflow: hidden|scroll|auto` ancestor already clips, and also
re-reads the document width with the clip removed. Both agree in every cell below.

**2. `24x24` is not the whole of SC 2.5.8.** The success criterion exempts targets that sit
inline in a sentence of non-target text, and targets whose 24px circle does not touch another
target. The measurement applies both, so the offender list is the real one rather than a list
of every inline prose link.

## Breakpoint x surface matrix

Read this table for what it is: **one regression sweep, not a tuned breakpoint grid.** The
layout has two real width rules plus one JavaScript threshold, and they are the only widths
anything is designed against:

| Rule                                                         | Where                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `@media (max-width: 1100px)`                                 | `slices/workspace-shell/workspace-shell.svelte`, `src/lib/views/Chat.svelte`                         |
| `@media (max-width: 600px)`                                  | `slices/workspace-shell/workspace-shell.svelte` (two), `shared/chat-ui/ComparisonTabs.svelte`        |
| JS threshold `viewportWidth > 1100` (sidebar vs drawer)      | `slices/workspace-shell/workspace-shell.svelte` (six sites), `src/lib/views/Chat.svelte`             |
| `@media (min-width: 650px)` — page chrome, not the workspace | `src/routes/layout.css`                                                                              |
| Narrow niceties: `max-width: 480px`, `max-width: 400px`      | `shared/chat-ui/ChatSurface.svelte`, `src/lib/views/Chat.svelte`, `shared/chat-ui/ModeSwitch.svelte` |

**There is no 768px rule anywhere.** `grep -rn 768 src slices shared` (excluding spec files)
returns only `BrowserCanvas.svelte`'s device presets (`tablet: [768, 1024]`, `laptop: [1366,
768]`). 768 is a **test width**, and so are the other ten. Any claim that the layout is "tuned
per breakpoint" across eleven widths describes the test matrix, not the CSS.

`PASS` in the table means zero visible overflow **and** `scrollWidth <= innerWidth` with the
`html`/`body` clip removed, at that width. The eleven widths are the test's own list
(`tests/responsive.e2e.ts:17`), chosen to cover phones, tablet, laptop and large monitor; the
`doc` column of the raw run printed the same value as `innerWidth` at every cell
(`chat=320/320`, `apps=1024/1024`, `overview=2560/2560`, ...), so the matrix is one verdict per
cell.

| width | chat | manef | apps | transcribe | files | browser | terminal | overview |
| ----- | ---- | ----- | ---- | ---------- | ----- | ------- | -------- | -------- |
| 320   | PASS | PASS  | PASS | PASS       | PASS  | PASS    | PASS     | PASS     |
| 360   | PASS | PASS  | PASS | PASS       | PASS  | PASS    | PASS     | PASS     |
| 390   | PASS | PASS  | PASS | PASS       | PASS  | PASS    | PASS     | PASS     |
| 414   | PASS | PASS  | PASS | PASS       | PASS  | PASS    | PASS     | PASS     |
| 768   | PASS | PASS  | PASS | PASS       | PASS  | PASS    | PASS     | PASS     |
| 834   | PASS | PASS  | PASS | PASS       | PASS  | PASS    | PASS     | PASS     |
| 1024  | PASS | PASS  | PASS | PASS       | PASS  | PASS    | PASS     | PASS     |
| 1280  | PASS | PASS  | PASS | PASS       | PASS  | PASS    | PASS     | PASS     |
| 1440  | PASS | PASS  | PASS | PASS       | PASS  | PASS    | PASS     | PASS     |
| 1920  | PASS | PASS  | PASS | PASS       | PASS  | PASS    | PASS     | PASS     |
| 2560  | PASS | PASS  | PASS | PASS       | PASS  | PASS    | PASS     | PASS     |

The layout has no width cap: at 2560px the chat column stays a centred reading measure while
the output region takes the rest, which is what the shell already did. Nothing overflows
because nothing is sized in fixed px against a viewport it does not know about.

## Other checks

| check                                          | result                  | note                                                                                                                                                    |
| ---------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tap targets 24x24 at 320/360/390/414/768       | PASS after fixes        | see the offender table                                                                                                                                  |
| Drawer opens / traps focus / Escape / backdrop | PASS                    | 40 Tab steps and 10 Shift+Tab steps never leave `#chat-sessions`                                                                                        |
| Drawer does not reach the composer             | PASS                    | it is a modal: scrim covers the composer, chat surface is `inert`, a tap at the composer's own coordinates closes the drawer and leaves the draft empty |
| Landscape 740x360 composer reachable           | PASS                    | composer box ends at y=326 of 360                                                                                                                       |
| Landscape rail controls reachable              | FAIL before, PASS after | see defect 3                                                                                                                                            |
| 200% zoom (640x400 layout)                     | PASS                    | no overflow on any of the 8 surfaces, composer in viewport                                                                                              |
| 200% text-only zoom (390px, root 26px)         | PASS                    | no clipped controls                                                                                                                                     |
| `env(safe-area-inset-*)`                       | not used by the shell   | see below                                                                                                                                               |

### Safe areas

The shell does **not** depend on safe-area insets. `env(safe-area-inset-*)` appears only in
the `.app-*` rules in `src/routes/layout.css` (topbar, mobile dock), and the workspace shell
does not render any `.app-*` element — measured directly: no element under `.workspace-host`
resolves a padding or margin containing `env(`.

Consequence on a notched device: the titlebar's first control sits at y=7 and the rail's
bottom control ends at y=834 of an 844px viewport, so nothing is _inside_ the 16px inset band
today, and the composer is 310px above the bottom edge. It works, but it works by luck of the
existing padding, not by intent. A `viewport-fit=cover` device with a home indicator over a
shorter composer would land the last control under the bar. Flagged as a design decision
rather than changed, because adding the padding alters the titlebar height on every device.

## Tap-target offenders, before and after

Measured with `getBoundingClientRect()` on the shipped element. "Spacing" is the SC 2.5.8
spacing exception: `clear` means no other target's 24px circle touches it, so it passes
despite the size.

### Before

| size      | surface  | control                                   | cause                         |
| --------- | -------- | ----------------------------------------- | ----------------------------- |
| 17x17     | browser  | Downloads                                 | scoped-CSS miss, see defect 1 |
| 17x17     | browser  | Browser options                           | same                          |
| 22.8 high | manef    | Add step                                  | `size="sm"` = `h-7` = 22.75px |
| 22.8 high | manef    | Clear workflow                            | same                          |
| 22.8 high | manef    | Generate preview                          | same                          |
| 22.8 high | manef    | Refresh declarations                      | same                          |
| 17.6 high | apps     | Preview steps (0)                         | `<summary>`, no min-height    |
| 19.2 high | apps     | What this workflow controls               | same                          |
| 19.5 high | overview | What each model is, and what it cannot do | same                          |

The 22.8 and 19.5 numbers are the root cause of most of this: `html, body { font-size: 13px }`
(`src/routes/layout.css:606`) makes `1rem` 13px, so Tailwind's `h-7` (1.75rem) is 22.75px and
`h-6` is 19.5px. Every rem-sized control in the app is at 81% of the size its class name
promises. `--app-touch-target: 2.75rem` — the token clearly meant to be 44px — is **35.75px**.

### After

| size     | surface  | control               | verdict                               |
| -------- | -------- | --------------------- | ------------------------------------- |
| 30.8x15  | terminal | Tools                 | PASS (inline in a sentence)           |
| 73.9x14  | overview | Setup check           | PASS (inline in a sentence)           |
| 90.2x15  | terminal | Paired devices        | PASS (inline in a sentence)           |
| 117.5x14 | apps     | Decision simulation   | PASS (inline in a sentence)           |
| 117.5x14 | overview | Decision simulation   | PASS (inline in a sentence)           |
| 8x605    | files    | Resize file list      | excluded, design decision — see below |
| 8x375    | apps     | Action timeline width | excluded, design decision — see below |

The two 8px-wide controls are the panel resize handles in
`src/lib/PanelResizeHandle.svelte`. They are 8px on purpose (a 24px hit area would take 16px
off a pane), they only exist from 768px up, and they answer to Arrow keys, Home and End. They
are excluded in the test with that reason in a comment, and left for a design call.

## What was fixed

### 1. Two browser-toolbar triggers had no padding (17x17)

`.browser-navigation button` is a Svelte-scoped selector, so it only matches elements the
component itself rendered. `DropdownMenu.Trigger` renders its own element with the `icon-button`
class but not the scope hash, so Downloads and Browser options got none of the `6px 9px`
padding and rendered at the icon's own 17x17.

Fix: `src/lib/views/BrowserCanvas.svelte` — add
`.browser-navigation :global(.icon-button)` to the same rule. Measured after: both are 35x29,
above the bar in both axes.

### 2. A 24px floor for controls the 13px root shrank below it (22.8px, 19.5px, 17.6px)

The root font size is 13px, so every rem-based control lands at 81% of its nominal size.
Changing the root would reflow the entire application, which is a design decision and not a
CSS fix, so the floor is applied where it is needed and nowhere else:

```css
button,
summary,
[role='button'] {
	min-height: 24px;
}
button:not(:has(> :is(span, small))) {
	min-width: 24px;
}
```

`min-height` only grows a control already under 24px; anything at or above keeps its exact
size, so no layout moves. `min-width` is limited to buttons with no text element child —
square icon buttons, which are the only case where the width also falls short — because a text
button is already several times wider than 24px and a blanket `min-width` would distort the
`btn` and `Button` shapes.

Measured after: `Add step` 64.2x24, `Preview steps` 24 high, `What this workflow controls`
24 high, `What each model is...` 24 high.

### 3. Landscape phone clipped the rail's bottom controls (real, unreachable)

At 740x360 the rail is 417px tall inside a 317px shell. `margin-top: auto` on `.rail-bottom`
pushed Server controls (y 375-419) and the user menu (y 426-454) past the 360px edge, and the
rail had `overflow: visible` with no scroll, so **Settings and Server controls were
unreachable in landscape and the page could not be scrolled to them**.

Fix: `slices/workspace-shell/workspace-shell.svelte` — `.desktop-rail` gets `min-height: 0`,
`overflow-y: auto`, `overscroll-behavior: contain` and a hidden scrollbar. `margin-top: auto`
collapses to 0 while the content overflows, so a viewport that already fits is unchanged.
Test: `every rail control is reachable in landscape` scrolls to each and asserts its box is
inside 0..360.

### 4. `playwright.config.ts` webServer timeout

The production build takes 14-45s depending on machine load, and the default 60s timeout
sometimes expired before `vite preview` was up, failing every test with
`ERR_CONNECTION_REFUSED`. Raised to `180_000`. Without this the gate is unreliable on this
host, independent of any test content.

## Flagged as design decisions (not changed)

1. **Root font size 13px.** `html, body { font-size: 13px }` scales every rem token to 81%.
   `--app-touch-target: 2.75rem`, clearly written to be 44px, resolves to 35.75px. Fixing it
   properly means either moving the shell to a 16px root (reflows every screen) or rewriting
   the tokens in px. The 24px floor above is the minimum to meet the standard; the 44px
   guideline is still unmet.
2. **`--app-touch-target` is 35.75px, not 44px.** Same root cause. A design decision because
   the fix is the same one as above.
3. **The 8px panel resize handles.** Deliberate, keyboard-operable, 768px and up.
4. **No `viewport-fit=cover`, no safe-area insets in the shell.** Today's padding happens to
   keep controls out of the notch band, but nothing reserves it. Adding it is a visual change
   to the titlebar on every device.
5. **No max content width at 2560px.** The chat column stays a readable measure, so this is
   not a defect; noted because a 2560px window does spread the shell very wide.

## Verification

Measured on the branch this work landed on; current totals are in
[progress.md](progress.md) §Gates.

```sh
PLAYWRIGHT_PORT=4518 npx playwright test tests/responsive.e2e.ts   # see below
npx prettier --check .                                            # clean
npx eslint .                                                      # clean
npx svelte-check --threshold error                                # 0 errors, 0 warnings
```

**That command line was wrong.** It said `23 passed (9 cases x 3 projects)` — 9×3 is 27, and 23
is only the **per-project** count, not a total. Measured on `98549c9` with `npx playwright test
--list tests/responsive.e2e.ts`: **69 registered = 23 cases per project × 3 projects**. The 9
`test()` statements expand to 23 because two of them loop over 11 widths and 5 widths
respectively. The run itself was **not** performed on this commit, so the pass/fail count is
unverified here. Unit totals are in [progress.md](progress.md) §Gates; the `441 passed` line
that used to sit in this block was a second home for a number that belongs in one place.

The webServer `timeout` is now `300_000` in `playwright.config.ts` (defect 4 above), which is the
same fix `edge-cases-2026-11-02.md` §11 landed independently. It does not stop the remaining
flake: at more than one worker the preview can still be reaped while other workers navigate, and
every failure reports `net::ERR_CONNECTION_REFUSED`. `--workers=1` is green.

Known flake, **pre-existing and not caused by this work**: `AC17 an append while reading keeps
the position and marks new content` (`tests/acceptance.e2e.ts:395`) fails intermittently when
the suite runs at 8 workers. Reproduced on the untouched tree with `--repeat-each=3`
(2 failures in 304 tests, both AC17, on `mobile` and `desktop`). It passes 3/3 in isolation
and passes on the baseline run. It asserts a scroll position within 2px, which is
load-sensitive.

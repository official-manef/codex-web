# AC01–AC18 coverage, mapped to the live app (2026-11-02)

**This file is the single authority for which acceptance criterion has a browser test.**
[PRD.md](PRD.md) §7 and [implementation-plan.md](implementation-plan.md) §10 carry a pointer
here instead of a verdict; [progress.md](progress.md) keeps the same correction only as
history. If this file and a test disagree, the test wins and this file is wrong — fix it.

`docs/PRD.md` §5 still states AC01–AC18 as the acceptance bar. `6ed1f3e` ("rebuild on the
Laya NPU workspace template") deleted the route family those scenarios were written against
(`/workspace`, `/workspace/[chatId]`, `/capabilities`, `/settings/[section]`) together with
`tests/workspace.e2e.ts` and `tests/acceptance.e2e.ts`. The corrigendum in §7 and §10 is
correct: nothing in `src/` or `slices/` referenced an AC id until this file.

`tests/acceptance.e2e.ts` **is back** — `5cdf2a9`, 14 tests. `tests/workspace.e2e.ts` is still
absent and nothing re-points it. So this file now measures the tests that exist, not a plan.

## Verdict vocabulary

This file used to say `no-longer-applicable` for four criteria, which read as "the criterion
went away". It did not. **The product never built the surface.** The label is now
`UNIMPLEMENTED`, and it means: no test, and no product — four rows that were N/A made the
report look green while four of eighteen criteria had nothing behind them at all.

| Label           | Means                                                                            |
| --------------- | -------------------------------------------------------------------------------- |
| `covered`       | the test asserts the criterion's own scenario, as written                        |
| `WEAKER`        | a test exists but asserts less than the bar; the gap is named per row            |
| `UNIMPLEMENTED` | no test and no product surface. A **product gap**, not a missing test            |
| `UNTESTED`      | the product exists, nothing asserts it. A test gap, fixable without product work |

`needs-new-test = 0` was the wrong summary: it counted only `UNTESTED`, so four product gaps
showed as zero work. Both counts are reported below.

This is the inventory the recovery started from. It maps each criterion to what exists
today, so a gap is recorded as a gap instead of being papered over with a test that asserts
something else.

## What the app is now

The app route is `/` → `src/routes/+page.svelte` → `$features/workspace-surface` →
`WorkspaceShell`. (`/home`, `/privacy` and `/terms` are public pages added in `98549c9` and are
outside every AC's scope.) Navigation is a hash (`/#files`, `#tools`), settings are a `Dialog`
(`SettingsWindow`), the secondary region is the output tab strip, and the chat is the copied
Laya `Chat.svelte` (`src/lib/views/Chat.svelte`) served by an in-browser stub transport
(`src/lib/http.local.ts`).

The stub is the reason several criteria cannot be carried: it has no token stream, no
network failure path and no authorization model. Those are stated below, not simulated.

## Inventory

| ID   | Verdict       | Reasoning and the surface a test drives today                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC01 | WEAKER        | `#chat-message` is empty on the entry surface, the heading is "What would you like to do?", and `button[aria-label="Send message"]` is natively `disabled`. **The bar asks for "submit disabled with a reason that is visible"** — there is no visible reason. `tests/acceptance.e2e.ts:89` asserts only `toBeDisabled()`; its own comment (`:74-77`) says the composer has no inline "why" copy and that the test deliberately asserts nothing about one. The disabled state is real, the reason is absent. |
| AC02 | WEAKER        | `input[type="file"]` → one `.composer-attachments > div` chip ("Preview only · model cannot see this file"), a `Remove …` button, and send becomes enabled. **The bar asks for "thumbnail ready"** — the stub stores metadata only, so there is no thumbnail and no preview. `tests/acceptance.e2e.ts:109` asserts the chip text, nothing about an image.                                                                                                                                                    |
| AC03 | WEAKER        | The per-file reason lands in `[role="alert"]` ("File is too large…", "Other attached files were kept") and the ready chip survives. **The send is not blocked** — the ready file is what keeps it open. Only the reason and the retention are asserted.                                                                                                                                                                                                                                                      |
| AC04 | covered       | Two `element.click()` calls in one tick on the send button produce one `.conversation-turn`; the run guard is what collapses them.                                                                                                                                                                                                                                                                                                                                                                           |
| AC05 | UNIMPLEMENTED | **Product gap.** Nothing in `src/`, `slices/` or `shared/` listens for `offline`: `grep -rn "'offline'" src slices shared` only hits the shell's `connection` union and an OAuth field. There is no request-identity/retry path and no draft-retention-on-disconnect. Faking a retry would test nothing.                                                                                                                                                                                                     |
| AC06 | WEAKER        | `.stop-button` → `.reply-note` "Generation stopped. Partial replies, if any, are shown above.", turn kept across a reload. **No partial text exists**: the stub reply is atomic, so "partial output kept" has nothing to hold.                                                                                                                                                                                                                                                                               |
| AC07 | covered       | Two chats via `New chat`, per-chat drafts persist in `laya-draft-v1:chat:<id>`; switching rows restores `draft A` / `draft B` without mixing. Drawer-aware below 1100px.                                                                                                                                                                                                                                                                                                                                     |
| AC08 | WEAKER        | Keep tab → New tab → rail `Browser` gives **two** tabs; View ▸ Toggle output panel hides them (`/#chat`), the `Show output panel` control restores both with the same `aria-selected` vector. **The bar says "work region with three tabs"**; `tests/acceptance.e2e.ts:236` and `:251` both assert `toHaveCount(2)`. Two tabs is what was built; three was never tested because three was never built.                                                                                                       |
| AC09 | UNIMPLEMENTED | **Product gap.** No dirty-tab contract exists: `grep -rn dirty src slices shared` returns nothing, and output tabs close directly through `closeOutputTab`. The keep/discard/cancel prompt and the failed-save path went with the `#workbench-region` tab bodies.                                                                                                                                                                                                                                            |
| AC10 | covered       | 1440px → `group[aria-label="Visible workspace region"]` absent (side-by-side); 700px → the group appears, tabs survive, draft survives, no horizontal overflow.                                                                                                                                                                                                                                                                                                                                              |
| AC11 | covered       | `More tools` (rail overflow trigger) focused, `Enter`, menu items visible, `Escape` → items gone and focus back on the trigger. Same shape for the menubar's own `View` menu.                                                                                                                                                                                                                                                                                                                                |
| AC12 | WEAKER        | Tools ▸ `[id$="-files"]` toggled twice quickly stays `aria-checked="true"`, the value in `localStorage` is the newest one, and a reload reads it back. **No async revision exists** to lose a race — the store writes synchronously — so "first save resolves last" is not a property of this build.                                                                                                                                                                                                         |
| AC13 | UNIMPLEMENTED | **Product gap.** The capability catalog is gone. There is no `button[data-connection]`, no `article[data-connection]`, no `{capability_connection_none}` → "Connect" transition. MCP management renders "Cloud mode is not configured…" with no `Connect` button (`PUBLIC_CONVEX_URL` unset).                                                                                                                                                                                                                |
| AC14 | covered       | Draft + open `Files` tab, `User menu` → `Help`, Escape closes the dialog, the tab is still there and `Chat` shows the draft unchanged.                                                                                                                                                                                                                                                                                                                                                                       |
| AC15 | covered       | Two chats, `Search chats` → `#session-search` focused, fill `zzzz` → "No matching chats." inside `aside[aria-label="Chat sessions"]` and never "Your saved chats appear here.".                                                                                                                                                                                                                                                                                                                              |
| AC16 | UNIMPLEMENTED | **Product gap.** The composer has no authorization input at all: send is enabled by draft + installed model + ready device, and a draft _always_ opens it (see AC01). Asserting "holds the send closed on unknown access" would assert the opposite of what the build does.                                                                                                                                                                                                                                  |
| AC17 | covered       | 30 seeded turns (via `addInitScript`, because the stub needs a round trip per send), scroll to 150, append, `button` "New messages" appears, `scrollTop` moves ≤2px, click clears the marker at the bottom.                                                                                                                                                                                                                                                                                                  |
| AC18 | covered       | `Find an open tab` opens `.workspace-tab-picker` listing `Files`; searching `zzz` renders "No matching open tab." inside the picker only, count 1, and no other list inherits it.                                                                                                                                                                                                                                                                                                                            |

## Counts

| Verdict       | Count | IDs                                            |
| ------------- | ----- | ---------------------------------------------- |
| covered       | 8     | AC04, AC07, AC10, AC11, AC14, AC15, AC17, AC18 |
| WEAKER        | 6     | AC01, AC02, AC03, AC06, AC08, AC12             |
| UNIMPLEMENTED | 4     | AC05, AC09, AC13, AC16                         |
| UNTESTED      | 0     | —                                              |

Two different numbers, and both matter:

- **Test gaps (fixable with a test alone): 0.**
- **Product gaps: 4** — AC05, AC09, AC13, AC16 have no surface to test. Plus **6 WEAKER rows**
  where a product change, not a test change, would close the gap: a visible disabled reason
  (AC01), a real thumbnail (AC02), a blocked send (AC03), partial output (AC06), a third tab
  (AC08), an async save that can race (AC12).

## What a full pass would require

**All of it is product work, not test work.** Nothing in the list below can be closed by
writing a test; a test written against today's build would have to assert something else.

The four `UNIMPLEMENTED` criteria:

1. **AC05** — a transport failure path plus a request identity the retry reuses. Today every
   `api.*` call is a local `switch` that cannot fail.
2. **AC09** — dirty tracking on output tabs and a save path that can fail. The tab strip has
   neither: tabs hold no editable state.
3. **AC13** — a capability catalog with a connection state machine. The deleted slice owned
   exactly this; it would have to come back before the row can honestly say "Connect".
4. **AC16** — an access model the composer can consult. Right now nothing downstream of the
   composer distinguishes "unknown authority" from "ready".

The six `WEAKER` criteria, each one small but real:

5. **AC01** — render the reason next to the disabled send control (copy plus wiring).
6. **AC02** — a real thumbnail: the stub keeps metadata only, so this needs an upload/decode path.
7. **AC03** — block the send while a file is unresolved, not just report the reason.
8. **AC06** — partial output, which needs a token stream the stub does not have.
9. **AC08** — a third tab kind; two exist.
10. **AC12** — an async save that can lose a race, i.e. a real transport.

Restoring the four scenarios as tests without those surfaces would be worse than the gap:
it would report green on behaviour the app does not have.

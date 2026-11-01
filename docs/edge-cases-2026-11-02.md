# Edge cases: an adversarial pass (2026-11-02)

Goal: break the app the way a person would, not confirm it works. Every row below was
reproduced in a real browser (or against the real module, for the pure cases) before anything
was changed. Where a row says **fixed**, the test named in the last column fails if the defect
comes back.

Gate at the end of this pass, all green: `npx playwright test` (180 passed, 3 projects),
`npx vitest run` (473 tests), `npx prettier --check .`, `npx eslint .`,
`npx svelte-check --threshold error` (0 errors, 0 warnings).

Tests: `tests/edge-cases.e2e.ts` (browser), `src/lib/session_storage.spec.ts`,
`src/lib/chat_dispatch.spec.ts`, `src/lib/reference_workspace.spec.ts`,
`src/lib/runtime/bridge_token_edge.spec.ts` (module level).

## The summary

| #   | Area      | Input                                                                                         | Observed before                                                                                                                                                                                                         | Verdict                | Test                                                                                                              |
| --- | --------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Storage   | `sessionStorage` sessions = `[null]`                                                          | `initialize()` threw `Cannot read properties of null (reading 'id')`. Composer **disabled**, no chats in the list, "New chat" also failed. Only clearing storage by hand recovered.                                     | fixed                  | `corrupt session storage (a null row) still boots a usable composer`                                              |
| 2   | Storage   | session row from an older schema (no `turns`)                                                 | `Cannot read properties of undefined (reading 'length')`. Same dead composer.                                                                                                                                           | fixed                  | `corrupt session storage (a row from an older schema)…`                                                           |
| 3   | Storage   | session row with `turns: null`                                                                | `Cannot read properties of null (reading 'length')`. Same dead composer.                                                                                                                                                | fixed                  | `corrupt session storage (a null turn list)…`                                                                     |
| 4   | Storage   | `turns: [null, 5, {...}]`                                                                     | Page error `Cannot read properties of null (reading 'attachments')`, chat unusable.                                                                                                                                     | fixed                  | same loader, covered by `src/lib/session_storage.spec.ts` → `turns: null and junk rows inside turns are dropped…` |
| 5   | Storage   | sessions = `{"not":` (corrupt JSON)                                                           | Fell back to an empty store, app usable.                                                                                                                                                                                | acceptable             | `corrupt session storage` group                                                                                   |
| 6   | Storage   | sessions = `{"sessions":[]}` (valid JSON, wrong shape)                                        | Treated as empty, app usable.                                                                                                                                                                                           | acceptable             | `corrupt JSON and a non-array root…` (vitest)                                                                     |
| 7   | Storage   | draft = `{"version":1,"value":{"content":42}}`, pin list = `"oops"`                           | Both rejected by the existing envelope check; composer empty, sidebar fine.                                                                                                                                             | acceptable             | `a corrupt draft and a corrupt pin list are dropped, not rendered`                                                |
| 8   | Storage   | Session write refused (`QuotaExceededError`)                                                  | Turn appeared in the log and looked saved. Reload lost it. **No message at all.**                                                                                                                                       | fixed                  | `a session write the browser refuses is reported instead of silently lost`                                        |
| 9   | Storage   | Quota full, then a draft typed, then reload                                                   | Draft survived, because `sessionStorage` still had room for a small value.                                                                                                                                              | acceptable             | `a draft typed while the quota is full survives a reload`                                                         |
| 10  | Storage   | `localStorage` + `sessionStorage` access throws outright (private mode)                       | App booted and the composer worked; every persist path already failed closed.                                                                                                                                           | acceptable             | covered by existing `projects.spec.ts` / `memories.spec.ts` "storage that throws"                                 |
| 11  | Storage   | 55 chats created                                                                              | Only 50 written. The oldest chat vanished on reload with no notice.                                                                                                                                                     | fixed                  | `past 50 chats the oldest are reported as dropped, not lost without a word`                                       |
| 12  | Streaming | Upstream closes with **no `done`** frame                                                      | Partial text was presented as a finished reply; nothing said it was cut.                                                                                                                                                | fixed                  | `an upstream that closes with no done frame is reported, not shown as complete`                                   |
| 13  | Streaming | Last frame has no trailing `\n`                                                               | Frame sat in the buffer and was discarded: reply came back **empty** and was saved as a successful blank answer.                                                                                                        | fixed                  | `a reply whose last frame has no trailing newline is not silently dropped`                                        |
| 14  | Streaming | Body is SSE (`event:` / `data:`) rather than NDJSON                                           | Every frame failed to parse, result was a blank success. Now reports the connection closed early.                                                                                                                       | fixed                  | `names a body with no parseable frames…` (vitest)                                                                 |
| 15  | Streaming | Empty body, closed immediately                                                                | Blank successful reply. Now named as a truncated connection.                                                                                                                                                            | fixed                  | same as 14                                                                                                        |
| 16  | Streaming | `{"type":"error"}` frame after text                                                           | Error shown, partial text kept.                                                                                                                                                                                         | acceptable             | existing `surfaces stream errors delivered via ChatEvent`                                                         |
| 17  | Streaming | Stop clicked mid-stream                                                                       | Reply was discarded; turn never written; `signal is aborted without reason` was printed next to the user's own message.                                                                                                 | fixed                  | `stopping mid-reply keeps the partial text and settles into a stated state`                                       |
| 18  | Streaming | Abort **before** the first byte                                                               | `streamServerChat` rejected with a raw `AbortError`, and the raw message reached the UI.                                                                                                                                | fixed                  | `treats an abort before the first byte as a stated stop, not a crash` (vitest)                                    |
| 19  | Streaming | Abort with a body that never errors                                                           | `reader.read()` never settled: the promise hung forever, composer disabled. Needed a page reload.                                                                                                                       | fixed                  | `treats a caller abort mid-stream as a stated stop…` (vitest)                                                     |
| 20  | Streaming | Stream throws after a partial frame                                                           | The user's message **disappeared**: no turn row, nothing to retry from.                                                                                                                                                 | fixed                  | `a stream that errors after a partial frame keeps the turn…`                                                      |
| 21  | Streaming | Send with AI enabled but no key in the tab                                                    | Synthetic job id stayed set → `busy` stayed true → composer **disabled forever** and the draft was gone.                                                                                                                | fixed                  | `a send with no provider key in the tab does not lock the composer`                                               |
| 22  | Streaming | Reply arrives for a BYOK turn                                                                 | `/api/sessions/update` ignored `turns`, so **every** BYOK and cloud reply lived only in memory until the next reload.                                                                                                   | fixed                  | `a reply that finishes normally is saved and survives a reload`                                                   |
| 23  | Streaming | A `job-` job polled for a BYOK turn                                                           | "That generation is no longer available" was printed over an already-arrived reply, every 250 ms.                                                                                                                       | fixed                  | covered by 22 and 17                                                                                              |
| 24  | Streaming | Reload mid-stream                                                                             | No stuck stop control, composer usable, fresh entry surface.                                                                                                                                                            | acceptable             | `reloading while a reply is streaming leaves a stated, usable state`                                              |
| 25  | Files     | Zero-byte file, no-extension file, `fake.png`, `../../etc/passwd`, 200-char name, all at once | All accepted; names were **all replaced with the literal `attachment`**, and images could not be previewed.                                                                                                             | fixed                  | `a rejected file names itself and the accepted files stay`                                                        |
| 26  | Files     | Five files at once (cap is 4)                                                                 | Fifth refused by name, first four kept.                                                                                                                                                                                 | acceptable             | `a fifth file is refused with a reason instead of silently dropped`                                               |
| 27  | Files     | 50 MB file                                                                                    | Refused by name before upload; nothing reached the composer.                                                                                                                                                            | acceptable             | `an oversized file is refused by name and never reaches the composer`                                             |
| 28  | Files     | Name with RTL override + emoji                                                                | Rendered inside a chip with `overflow-wrap: anywhere`; no layout escape.                                                                                                                                                | acceptable             | covered by the chip assertions in 25                                                                              |
| 29  | Layout    | 320px wide                                                                                    | No horizontal document scroll; composer usable, send button visible. Two composer icon rows overlap by 10px inside their own box, which clips one icon's right edge but does not affect the document or any tap target. | acceptable (cosmetic)  | `a 320px viewport has no horizontal scroll and keeps the composer usable`                                         |
| 30  | Layout    | 4000px wide                                                                                   | Shell fills the window, no overflow.                                                                                                                                                                                    | acceptable             | `a 4000px viewport does not stretch the shell past the window`                                                    |
| 31  | Layout    | 200% zoom (640 CSS px)                                                                        | Nothing clipped, no overflow.                                                                                                                                                                                           | acceptable             | covered by 30's assertion at a zoom-equivalent width                                                              |
| 32  | Layout    | 4000-character unbroken string in the composer and the timeline                               | No horizontal document scroll (`overflow-wrap: anywhere` already present).                                                                                                                                              | acceptable             | `a 4000-character unbroken message does not push the page sideways`                                               |
| 33  | Layout    | 500 turns in one chat                                                                         | All 500 rendered, newest in view, composer still usable, ~2s to load.                                                                                                                                                   | acceptable             | `a chat with 500 turns loads and still takes a message`                                                           |
| 34  | Layout    | 5000-character chat title                                                                     | Truncated by the row's `text-overflow`; no sidebar overflow.                                                                                                                                                            | acceptable             | `a 5000-character chat title does not overflow the sidebar`                                                       |
| 35  | Tabs      | Two tabs, one chat each                                                                       | Each tab kept its own chat; the shared `laya-session` pointer moved to tab B, but reloading tab A still landed on its own chat.                                                                                         | acceptable             | `each tab keeps its own sessionStorage chat list…`                                                                |
| 36  | Tabs      | `laya-session` points at a chat this tab has never seen                                       | Opened the first available chat, no error.                                                                                                                                                                              | acceptable             | `a remembered chat that this tab no longer has opens a fresh chat…`                                               |
| 37  | Tabs      | Chat store emptied behind the tab                                                             | Fresh chat, no error banner.                                                                                                                                                                                            | acceptable             | `a chat store emptied behind the tab opens a fresh chat instead of an error`                                      |
| 38  | Tabs      | `storage` events                                                                              | Never listened to, and not needed: the chat store is per-tab `sessionStorage`, and `laya-session` is only read at boot.                                                                                                 | acceptable (by design) | —                                                                                                                 |
| 39  | Pins      | Pin a chat                                                                                    | Control did nothing at all: the only id shape accepted was `[a-f0-9]{32}`, but the store issues `session-<base36>-<n>`, so every pin filtered itself out.                                                               | fixed                  | `a chat can be pinned and stays pinned after a reload`                                                            |
| 40  | Bridge    | Token in storage from an older build / foreign device / with `+`/`/`/`=`                      | All rejected, read as "no token".                                                                                                                                                                                       | acceptable             | `a stored token this build would not have written` (vitest)                                                       |
| 41  | Bridge    | Device id with `../`                                                                          | Refused as a storage key and as a token key.                                                                                                                                                                            | acceptable             | same file                                                                                                         |
| 42  | Bridge    | Storage throws on get/set/remove                                                              | Read → `''`, save → `false`, clear does not throw.                                                                                                                                                                      | acceptable             | `a storage that throws on every call` (vitest)                                                                    |
| 43  | Terminal  | Send before connect                                                                           | Input control is disabled until `status === 'open'`, and `send()` no-ops before open.                                                                                                                                   | acceptable             | existing `ignores send and resize before the socket opens`                                                        |
| 44  | Terminal  | Connect twice                                                                                 | `connect()` closes the previous client before creating the new one.                                                                                                                                                     | acceptable             | existing `close is idempotent…`                                                                                   |
| 45  | Terminal  | 0-byte frame, oversized frame, non-text frame                                                 | All bounded and reported; oversized frames dropped with a stated limit.                                                                                                                                                 | acceptable             | existing `drops an oversized inbound frame…`, `rejects non-text frames…`                                          |
| 46  | Terminal  | Upstream killed while attached                                                                | `onclose` fires once with the bridge's code and reason, and the panel shows it with a Reconnect control.                                                                                                                | acceptable             | existing `reports closed once with the bridge reason`                                                             |

## Defects found: 12 fixed, 0 left broken

Cheap and clear, so all of them are fixed rather than documented as known-broken. In the order
they hurt a real user:

1. **Corrupt or older-schema session storage bricked the chat.** Four shapes (`[null]`, no
   `turns`, `turns: null`, junk rows inside `turns`) each threw inside `initialize()`, which
   left `session` null, the composer disabled, and "New chat" unable to recover because it
   bails on `!session`. A reload loop was the only symptom a user could see.
   Fix: `loadSession()` in `src/lib/http.local.ts` rebuilds every row into the shape this
   build issues, and drops rows it cannot rebuild.

2. **Every BYOK and cloud reply was never saved.** `/api/sessions/update` accepted `title` and
   `settings` and silently ignored `turns`, which is exactly what both streaming paths send
   back. The reply was on screen and gone after a refresh. This is the largest data-loss bug in
   the pass.
   Fix: the route validates and stores `turns`.

3. **A full storage quota lost chats silently.** `persist()` swallowed the `QuotaExceededError`
   and returned `void`, so the view could not tell the difference between "saved" and "not
   saved". Past the 50-chat write cap the oldest chats were also dropped with no notice.
   Fix: `persist()` reports failure and the drop count through `/api/sessions`, and the chat
   says so in a `role="status"` line.

4. **A truncated stream looked like a finished reply.** No `done` frame, an SSE body, or an
   empty body all produced a "successful" reply containing whatever text arrived. A reply whose
   final frame had no trailing newline produced an _empty_ successful reply.
   Fix: `streamServerChat` flushes the trailing buffer and requires a `done` frame; both cases
   now return a named error while keeping the partial text.

5. **Stopping a reply threw away what had arrived,** printed `signal is aborted without reason`,
   and wrote nothing to the session. Aborting before the first byte rejected outright, and
   aborting against a body that never errors hung the reader forever.
   Fix: abort is raced against `reader.read()` and returns `{ aborted: true }` with the partial
   text, which the view records as a `cancelled` turn.

6. **A transport failure ate the user's message.** When the stream threw after a partial frame,
   `send()` only set an error banner — no turn row, so there was nothing to retry from.
   Fix: the turn is recorded as `error` with the reason, and the partial text is shown alongside
   the notice instead of being replaced by it.

7. **Sending without a provider key locked the composer permanently.** The early return left the
   synthetic job id set, so `busy` stayed true. The draft was already cleared, so the message was
   gone too. Only a reload recovered.
   Fix: clear the job and hand the text and attachments back.

8. **A BYOK reply was immediately contradicted by a poll error.** `pollJob` polled the synthetic
   `server-…` id against `/api/chat/job`, which only knows real `job-` ids, so "That generation
   is no longer available" appeared over a reply that had already arrived.
   Fix: `pollJob` only polls ids the local job store issued.

9. **The pin control was dead.** `validPinnedSessions` only kept `/^[a-f0-9]{32}$/`, but this
   build issues `session-<base36 time>-<n>`. Every pin filtered itself out on write, so the icon
   never changed and nothing was stored.
   Fix: accept the id shape the store actually issues, and keep the legacy hex form so an
   existing pin is not silently dropped.

10. **Every attachment was named `attachment`,** and images could not be previewed because
    `kind` was never set. The upload stub ignored the request body and returned a fixed object.
    Fix: echo `name`, `type`, `size`, and a derived `kind`.

11. **Playwright's own gate could not boot the suite.** The configured 60s `webServer` timeout is
    shorter than a cold `vite build` on this repo (~2 min), so the whole run failed with
    "Timed out waiting from config.webServer" instead of running tests.
    Fix: `timeout: 300_000` on the `webServer` block.

12. **Test-only race, recorded because it fooled me for a round:** the two-tab test snapshotted
    the session before the stub's 700ms reply had settled. The app was correct; the test was
    reading a half-written turn. The test now waits for the reply.

## Deliberately not changed

- **Composer icon rows overlap by 10px at 320px.** `.composer-left-actions` shrinks to 52px while
  its two buttons need 62px, so the approval icon's right edge is clipped inside its own box. The
  document does not scroll and no tap target falls below 24px, so this is cosmetic. The fix is
  `flex-shrink: 0` on both action rows (verified in the browser), but it pushes `.composer-right-actions`
  past the composer box at that width, which is a worse trade. Left as-is; noted here.
- **`storage` events are never listened to.** Nothing is broken by that today: the chat list is
  per-tab `sessionStorage` and `laya-session` is read once at boot. Cross-tab sync would be a
  feature, not a fix.
- **The chat list cap stays at 50.** It is a real ceiling, not a defect, now that it is reported.
  Raising it would need a different storage strategy.
- **`src/lib/workspace_persistence.ts` duplicates `laya_workspace_persistence.ts`.** Both are
  live; only one is wired (`workspacePersistence`). Removing the unused one is a cleanup, not an
  edge case, so it is left for whoever owns that decision.

## What surprised me

- The worst bug was not in the hostile input path. Corrupt storage was survivable; what actually
  lost data was `/api/sessions/update` quietly ignoring the `turns` field that both streaming
  paths send. Any reply from a real provider was never persisted, on every single turn.
- The `pin` control had never worked in this build at all. A regex left over from a different id
  scheme made a visible, focusable, clickable control a no-op — and the empty state next to it
  ("Pin a chat to keep it here.") made it look like user error.
- Abort was three separate bugs, not one: a rejection before the first byte, a hang when the body
  does not error, and a silent discard of the partial text. Only a fake socket factory with a body
  that never errors exposes the hang; a real `fetch` hides it.
- `reader.read()` is not required to reject on abort. Trusting it to is the difference between a
  1-second stop and a permanently disabled composer.

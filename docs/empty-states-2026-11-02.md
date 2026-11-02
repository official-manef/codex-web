# Empty, loading, degraded and error states (2026-11-02)

One anatomy for every state where a screen has nothing to show. Written after an
enumeration of all 28 registry ids, not a sample. Index: [README.md](README.md).

Related: [surface-coverage-2026-11-02.md](surface-coverage-2026-11-02.md) (which ids are
reachable and honest), [state-model.md](state-model.md) (the `data` axis this encodes),
[edge-cases-2026-11-02.md](edge-cases-2026-11-02.md).

## Why this exists

`docs/surface-coverage-2026-11-02.md` proved each surface _can_ say why it is degraded. It did
not prove every state of every dependency is covered. Two failures survive that check:

- a **blank box**: the surface says nothing while its first request is in flight, or when a
  successful response carries an empty list (`Manef.svelte` rendered an empty module grid and
  read "No modules" in one field while the request was still out);
- a **false start**: the surface answers a _loading_ state with its _empty_ copy, so a
  two-second boot reads as "No provider data. Reconnect a runtime" (`Providers.svelte`,
  `Compute.svelte`, before this pass).

Both are defects. A spinner that never resolves and a panel claiming "Connected" over a stub
are the same defect in different clothes.

## The four states

| State      | Question it answers                           | What the reader must be able to do after reading it   |
| ---------- | --------------------------------------------- | ----------------------------------------------------- |
| `loading`  | what am I waiting for, and is it still coming | keep waiting, or know it is slow on purpose           |
| `empty`    | there is nothing here, and that is correct    | add the first item, or go where items come from       |
| `degraded` | something is absent that this build lacks     | understand it is not their fault and not fixable here |
| `error`    | a real request failed                         | retry, or act on the specific thing that failed       |

`empty` and `degraded` are not interchangeable. `empty` means the store is working and holds
zero rows. `degraded` means the store, the transport or the model is not there at all. A build
with no backend is always `degraded`; it is never `empty`.

## The anatomy

`src/lib/StateNote.svelte`. One component, four slots, always in this order:

1. **`title`** — a noun phrase naming what is absent or which list is empty. "No speech model
   in this build", "No automations recorded". Not an apology, not a status code.
2. **`detail`** — one or two sentences: why it is absent, and what the reader would see if it
   were there. This is where a build difference belongs ("the desktop app is the build that
   reports real devices here").
3. **`fix`** — who can change it, as one of four fixed sentences:
   - `you` — "You can change this on this screen."
   - `operator` — "A server operator can change this; nothing here can."
   - `build` — "This build has no runtime for it. The desktop app is the build that does."
   - `none` — "Nothing you can do here changes it."
4. **`action`** — at most one control, rendered only when it actually helps. A retry that
   cannot succeed, a link to the screen you are already on, and a disabled button are all
   worse than no action.

The `role` follows the state: `alert` for `error`, `status` for the other three. Copy inside
the component is fixed; `title` and `detail` are the only per-screen text.

## Tone

- No exclamation marks. No "Oops". No "Something went wrong" with no object.
- Never "Error." alone: name the thing that failed. "The repository status did not load" is a
  sentence; "Error" is a shrug.
- No exclamation-mark-free cheer either. A degraded state is not a feature.
- Second person, present tense, active voice: "A server operator can change this", not "This
  may be changeable by configuration".
- Say the number when the number is real, and only then. "4 of 20" is fine when the store
  reported it; a count invented from a missing field is not.
- Name the variable or the verb only when the reader can act on it. `GIT_SURFACE_ENABLED` is
  for an operator and is worth naming in an `operator` state. `src/lib/http.ts` is not, and
  never appears.

## What each state may and may not say

| State      | May say                                                   | May not say                                                  |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| `loading`  | what is being read, that it is still running              | "none", "no X configured", "empty", any count                |
| `empty`    | the list is empty, how to add the first row, the cap      | "not configured", "no backend", "unavailable"                |
| `degraded` | which piece is absent, which build has it, who can fix it | "error", "failed", a stack trace, a source file path         |
| `error`    | what failed, what to retry, whether input was preserved   | that the feature is unavailable when only one request failed |

Two rules follow from the table:

- **A loading state may never be answered with empty copy.** If the transport has not answered
  yet, the screen does not know there is nothing; it only knows it does not know.
- **A degraded state may never be answered with error copy.** "This build has no runtime" is
  not a failure, so it does not get an `alert`, a red border or a retry that cannot work.

## Surface × dependency coverage

`L` loading, `E` empty, `D` degraded, `X` error. `+` added by this pass.

| Surface          | Dependency                         | L   | E   | D   | X   |
| ---------------- | ---------------------------------- | --- | --- | --- | --- |
| `chat`           | session list (`/api/sessions`)     | yes | yes | –   | yes |
| `chat`           | model catalogue (`/api/chat`)      | +   | yes | yes | yes |
| `chat-tools`     | MCP status, resources, tools       | yes | yes | yes | yes |
| `chat-settings`  | catalogue, capability list         | +   | yes | yes | yes |
| `chat-session`   | session object                     | yes | yes | –   | yes |
| `workspace-home` | static registry                    | –   | yes | –   | –   |
| `files`          | chosen files (memory)              | yes | yes | –   | yes |
| `browser`        | entered address (memory)           | –   | yes | yes | yes |
| `terminal`       | paired devices (Convex)            | yes | yes | yes | yes |
| `manef`          | `/api/manef/modules`               | +   | +   | yes | yes |
| `apps`           | `/api/automation/status`           | +   | yes | yes | yes |
| `transcribe`     | `/api/asr`                         | yes | yes | yes | yes |
| `overview`       | `backends` prop                    | +   | +   | yes | yes |
| `voice`          | `/api/pipeline`                    | yes | yes | yes | yes |
| `playground`     | `/api/tasks` (optional metadata)   | –   | yes | yes | yes |
| `snake`          | `/api/capabilities`                | –   | yes | yes | yes |
| `embeddings`     | `/api/embeddings`, capabilities    | yes | yes | yes | yes |
| `models`         | `/api/models`                      | yes | yes | yes | yes |
| `models`         | `/api/models/recommendations`      | +   | +   | yes | yes |
| `setup`          | `/api/health`, `/api/driver`       | yes | –   | yes | yes |
| `backends`       | `backends` prop, `/api/driver`     | +   | +   | yes | yes |
| `providers`      | `backends` prop                    | +   | yes | yes | yes |
| `pricing`        | none (static)                      | –   | –   | yes | –   |
| `keys`           | Convex session                     | yes | –   | yes | yes |
| `faq`            | none (static), search filter       | –   | yes | –   | –   |
| `tools`          | feature settings, paired devices   | +   | +   | yes | yes |
| `devices`        | Convex `devices.list`              | yes | yes | yes | yes |
| `memories`       | `localStorage` / Convex `memories` | yes | yes | yes | yes |
| `git`            | `/api/git`                         | yes | yes | yes | yes |
| `automations`    | Convex `automations.list`          | +   | yes | +   | +   |
| `mcp-apps`       | `/api/mcp/apps`                    | +   | yes | yes | yes |

`–` where the dependency cannot be absent, empty or loading. `setup` has no `empty`: four
fixed checks always render.

## What is deliberately not unified

- **`RecoveryNotice`** stays for a failed _action_ (a send, a save, a download) where the
  message is the server's own and the recovery hint is message-matched. It carries an error
  code and a retry for an operation; `StateNote` describes a state, not an operation.
- **Existing inline state copy stays** where it already names the missing piece, the reason and
  who can act (Git's `GIT_SURFACE_ENABLED` line, Transcribe's "No speech model in this build",
  Terminal's "No terminal can open yet"). Rewriting those would churn copy that pinned tests
  assert for no gain. `StateNote` is used where a state was **missing**, or where the copy
  answered a _loading_ state with _empty_ copy.
- **`Deps`** keeps its inline "No dependency report: this build runs in the browser" line. It
  is a disclosure header inside a panel, not a state for the panel.
- **Per-row reasons** in `Tools`, `Devices` and `BrowserAutomation` stay as one-line `<p>`
  under the row they describe. A `StateNote` per row would triple the height for no gain.

## Tests

`tests/empty-states.e2e.ts` forces each state by stubbing the route or the storage, then
asserts the title text appears and, for `error`, that the element has `role="alert"`. Forcing
matters: a state reached only by luck is not covered.

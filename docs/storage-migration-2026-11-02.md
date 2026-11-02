# Persisted state: inventory, versioning, migration

> Scope: everything this template writes into `localStorage` / `sessionStorage`.
> Branch `w3/store`, 2026-11-02. Supersedes nothing; extends `docs/state-model.md` (which
> describes the deleted 0.3.0 axes) for the storage keys that actually ship.

## 1. The problem this closes

Every persisted key in this app was **unversioned**. The reader had to guess what it was
looking at, and the writer replaced whatever it could not recognise. Three concrete
consequences, all reproduced in `src/lib/storage_migration.spec.ts` and
`src/lib/session_storage.spec.ts`:

1. A shape the reader rejected became **silent data loss** on the next write. `memories.all()`
   returned `[]` for a hand-edited payload, and the next `add()` wrote that empty list back.
   Same for projects, pins, drafts and the tool list.
2. A shape from a **newer** build was indistinguishable from corruption, so a downgraded client
   (a stale tab, a rollback, a second profile sharing the origin) overwrote it.
3. Nothing told the user. The only signal was "my chats are gone".

A previous pass fixed the _bricking_ (`[null]` rows threw during `initialize()` and left the
composer disabled). It did not fix the versioning: the data was still dropped, just politely.

## 2. Key inventory (before this change)

Storage legend: **L** = `localStorage` (survives the tab), **S** = `sessionStorage` (dies with
the tab). "Reader" names the function that reads it today.

| Key                                          | Store | Written by                               | Read by                             | Shape today (v0)                                                | Older shape                                | Newer / unknown shape                                              |
| -------------------------------------------- | ----- | ---------------------------------------- | ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `workspace-template:sessions`                | S     | `http.local.ts` `persist()`              | `http.local.ts` `load()`            | `LocalSession[]`                                                | row missing `turns`/`settings` → defaulted | **dropped from the view, then replaced on the next write**         |
| `workspace-template:backend`                 | L     | `workspace_persistence.ts`               | same                                | raw string (backend id)                                         | —                                          | n/a (plain string, still read as-is)                               |
| `workspace-template:chat-backend`            | L     | `workspace_persistence.ts`               | same                                | raw string                                                      | —                                          | n/a                                                                |
| `workspace-template:tools-v1`                | L     | `feature_settings.svelte.ts`             | same                                | `{ version: 1, enabled: string[] }`                             | no `version` → `null` → defaults           | **any other version → `null` → defaults, then rewritten**          |
| `workspace-template:device-tools-v1`         | L     | `device_tools.svelte.ts`                 | same                                | `string[]` (bare array)                                         | —                                          | non-array → `[]`, then rewritten on the next toggle                |
| `laya-draft-v1:<key>`                        | S     | `draft_storage.ts` (`saveDraft`)         | `draft_storage.ts` (`readDraft`)    | `{ version: 1, value }`                                         | no envelope → fallback                     | **version ≠ 1 → fallback, then overwritten by the next keystroke** |
| `laya-draft-v1:chat:<sessionId>`             | S     | `Chat.svelte`                            | `Chat.svelte`                       | `{ content, attachments }` inside the draft envelope            | —                                          | as above                                                           |
| `laya-draft-v1:pinned-sessions`              | S     | `Chat.svelte` `pinSession`               | `Chat.svelte` `validPinnedSessions` | `string[]` inside the draft envelope                            | hex-only ids rejected by the old filter    | non-array → `[]`, then rewritten                                   |
| `laya-draft-v1:chat-mode:<sessionId>`        | S     | `Chat.svelte`                            | `Chat.svelte`                       | `"chat" \| "compare"`                                           | —                                          | unknown value → default                                            |
| `laya-draft-v1:chat-scroll:<sessionId>`      | S     | `Chat.svelte`                            | `Chat.svelte`                       | number                                                          | —                                          | non-number → 0                                                     |
| `laya-draft-v1:chat-list-sort`               | S     | `Chat.svelte`                            | `Chat.svelte`                       | string                                                          | —                                          | unknown value → default                                            |
| `laya-draft-v1:workspace-layout`             | S     | `shared/workspace-layout`                | same                                | `{ output, lastOutput, outputRatio, navWidth, inspectorWidth }` | missing fields → clamped defaults          | each field clamped individually                                    |
| `laya-draft-v1:desktop-output-tabs-v2`       | S     | `workspace-shell.svelte`                 | same                                | object                                                          | `v1` key is a _different key_              | shape unknown → `null` → defaults                                  |
| `laya-draft-v1:desktop-navigation-collapsed` | S     | `workspace-shell.svelte`                 | same                                | boolean                                                         | —                                          | `!== true` → false                                                 |
| `laya-draft-v1:byok-key`                     | S     | `byok_key.ts` `saveProviderKey`          | `byok_key.ts` `readProviderKey`     | string inside the draft envelope                                | —                                          | not `KEY_PATTERN` → `""`                                           |
| `laya-draft-v1:<view>` (per-screen)          | S     | each view (`SpeechControls`, `Snake`, …) | same                                | per-view object                                                 | —                                          | read per field; unknown → default                                  |
| `laya-session`                               | L     | `Chat.svelte` `rememberSession`          | `Chat.svelte` `initialize`          | **raw id, no JSON quoting**                                     | same (it never changed)                    | anything else → `""` → first chat opens                            |
| `laya-browser-rpa`                           | L     | `BrowserAutomation.svelte`               | same                                | **raw 24-hex run id**                                           | same                                       | non-id → ignored                                                   |
| `laya-desktop-rpa`                           | L     | `BrowserAutomation.svelte`               | same                                | raw 24-hex run id                                               | same                                       | non-id → ignored                                                   |
| `bridge-token:v1:<deviceId>`                 | S     | `runtime/bridge_token.ts`                | same                                | `{ version: 1, value }`                                         | —                                          | version ≠ 1 → `""` (deliberate: a credential is not migrated)      |
| `codex-web:memories:v1`                      | L     | `memories.ts`                            | same                                | bare `Memory[]`                                                 | —                                          | non-array → `[]`, **then rewritten by the next add**               |
| `codex-web:projects:v1`                      | L     | `projects.ts`                            | same                                | bare `Project[]`                                                | —                                          | non-array → `[]`, then rewritten                                   |
| `codex-web:project-members:v1`               | L     | `projects.ts`                            | same                                | bare `Record<sessionId, projectId>`                             | —                                          | non-object → `{}`, then rewritten                                  |
| `workspace-template:sessions` (chat job map) | —     | in memory only                           | —                                   | not persisted                                                   | —                                          | —                                                                  |

Not persisted, checked and confirmed: **BYOK provider key** (`byok_key.ts` holds it in module
scope only — deliberate, see §6), **automations** (Convex-only; the local screen is an honest
"not available" state), **terminal output** (component state; `terminal_buffer.ts` is pure
trimming, no storage), **composer settings** (they live in each chat's `settings` field, so they
are covered by the sessions key).

## 3. Version scheme

One envelope, one module: `src/lib/storage_version.ts`.

```
{ "version": <number>, "value": <payload> }
```

- **Absent envelope = version 0.** Every key above that shipped before this change wrote a
  bare payload (array, string, number, or the ad-hoc `{version:1,enabled:[…]}`). Those are
  version 0 by definition, so no migration is needed for data written by a build that never had
  a version.
- **`version` is the shape's version, not the app's.** Each key owns its own `current`, so
  bumping the session shape does not touch memories.
- **The key name never changes.** `codex-web:memories:v1` keeps its `v1` suffix; renaming a key
  orphans the data behind it. The envelope carries the version instead.
- **`fromLegacy` produces the _current_ shape, directly.** A build three versions ahead does not
  replay old steps for unversioned data; `steps[n]` exists only to lift an _envelope_ written by
  a numbered older build.

### Per-key state after this change

| Key                                           | Version       | Migration (v0 → v1)                                                           |
| --------------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `workspace-template:sessions`                 | 1             | rebuild each row (`loadSession`), count rows that cannot be rebuilt           |
| `workspace-template:tools-v1`                 | 1             | lift `{version:1, enabled}` → `{version:1, value}`; unknown ids kept          |
| `workspace-template:device-tools-v1`          | 1             | `string[]` → envelope; ids this build does not ship stay out, not dropped     |
| `laya-draft-v1:<key>`                         | 1             | bare value → envelope; an object _with_ `version` is not read as a bare value |
| `laya-session`                                | 1             | bare id **and** JSON-quoted id both read; validated as a short string         |
| `laya-browser-rpa` / `laya-desktop-rpa`       | 1             | bare 24-hex id → envelope; anything else quarantined                          |
| `codex-web:memories:v1`                       | 1             | `Memory[]` → envelope; rows validated, count preserved                        |
| `codex-web:projects:v1`                       | 1             | `Project[]` → envelope                                                        |
| `codex-web:project-members:v1`                | 1             | record → envelope                                                             |
| `bridge-token:v1:<deviceId>`                  | — (unchanged) | deliberate exception, §6                                                      |
| `workspace-template:backend`, `:chat-backend` | — (unchanged) | single opaque string, validated by the consumer                               |

## 4. What each migration does

All migrations run on read, not on boot: nothing runs until a screen asks for the data, so a
broken payload can never block the app from starting.

1. **Read** `raw = store.getItem(key)`. Blocked storage → `{status:'empty'}`, no throw.
2. **Size guard.** `raw.length > maxChars` → quarantine (it is not ours).
3. **Parse.** `JSON.parse` failure → `fromLegacyText(raw)` when the spec declares one (the raw
   pointer keys), otherwise quarantine.
4. **Envelope check.** An object with both `version` and `value` is an envelope. A bare payload
   is version 0. `{version:1, enabled:[…]}` deliberately does _not_ count as an envelope, because
   it has no `value`: reading it as one would hand the view `undefined` and reset every toggle.
5. **Newer check.** `version > current` → return `{status:'newer'}`. Value untouched, and the
   write path refuses the same key.
6. **Migrate.** Version 0 → `fromLegacy`; version _n_ → `steps[n]`, `steps[n+1]`, … A missing step
   is a failure, not a partial migration.
7. **Validate.** Shape validation returns `{value, dropped}`. `null` = unreadable.
8. **Preserve before replacing.** `dropped > 0` → copy the original bytes to
   `<key>:quarantine` (first copy wins) → status `quarantined`, value still returned.
9. **Write back on read only when the version was older.** One `setItem` of the finished text.
   If that write throws, the original bytes are still the entire payload.

## 5. Failure policy

| Situation                                     | Behaviour                                                                                         | User signal                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Older shape (v0 or older envelope)            | Migrated forward, written back once, subsequent reads are no-ops                                  | none — it worked                                                |
| Newer shape                                   | Never read, **never written**; defaults are used for this session                                 | Chat banner: "written by a newer version … nothing was changed" |
| Unreadable bytes (bad JSON, wrong root)       | Copied verbatim to `<key>:quarantine`, then the live key may be rewritten by the first real write | Chat banner names the quarantine key; `status().quarantined`    |
| Rows validation rejects inside a good payload | Good rows load, original payload copied to `<key>:quarantine` first                               | same banner; `status().dropped > 0`                             |
| Migration step missing or throws              | Treated as unreadable → quarantine, never a half-migrated value                                   | banner + `quarantined`                                          |
| Write fails (quota, private mode)             | Return value `false`; original bytes untouched; live state still works                            | Existing "could not be saved" banner (unchanged)                |
| Storage blocked entirely                      | Every read returns empty, every write returns `false`                                             | Defaults; no throw                                              |
| Validation itself throws                      | Caught in `storage_version.ts`; result is `quarantined`                                           | banner                                                          |

The two "unreadable" rows deserve precision, because they are not the same promise:

- **A failed migration write** leaves the live key byte-identical to what it was (tested: the
  original still parses as the complete old payload).
- **A payload quarantined on read** is copied _before_ the app can write anything, and then the
  normal first write (creating a chat, adding a note) replaces the live key with a readable
  shape. The user's bytes still exist — at `<key>:quarantine`, byte for byte, first copy wins.

**Nothing is deleted.** There is no `removeItem` in any migration path. The only deletions in
the codebase are explicit user actions (delete a chat, delete a project, delete a recording) and
the deliberate `clear()` calls behind a "Clear all" button.

## 6. Deliberate exceptions

- **`bridge-token:v1:<deviceId>`** keeps its own reader and is _not_ migrated. It already has a
  version field, and a pairing token is a credential: silently lifting an old token forward is
  worse than asking the user to pair again. A future shape bump should invalidate, not migrate.
- **The BYOK provider key** (`byok_key.ts`) is one tab-scoped `sessionStorage` draft, written and
  read by that module alone, and checked against `KEY_PATTERN` on the way out so a malformed value
  is never sent. It is never `localStorage`; that was the leak this inventory exists to prevent.
- **`workspace-template:backend` / `:chat-backend`** are opaque one-value strings. An envelope
  would add bytes and no safety: the consumer already falls back to `localBackend` for anything
  it does not recognise.

## 7. Tests that prove it

`src/lib/storage_migration.spec.ts` (23 cases) — the shared policy:

- v0 → current, written back exactly once, second read is a verified no-op
- current → current idempotent, zero writes
- newer → refused, bytes byte-identical after read **and** after a write attempt
- corrupt → quarantined, original left in place, first copy wins
- migration whose _write_ fails → original still parses as the complete old payload
- missing step → quarantine, no throw
- `validate` that throws → quarantined, never propagates

`src/lib/session_storage.spec.ts` (12 cases) — the chat store end-to-end:

- legacy array migrates to the envelope on first read
- a newer chat list is reported (`storage.newer`) and a `sessionCreate` does not replace it
- an unreadable list is copied to `workspace-template:sessions:quarantine`, the tab still opens,
  and the rescue copy survives the first real write
- a row this build cannot address is quarantined while the good rows load
- the 50-chat cap, the quota-failure banner and the "reply survives a reload" cases still hold

`tests/edge-cases.e2e.ts` → `storage from another version` (3 cases) — the shipped bundle, in a
browser, because the store loads at import time:

- a newer chat list renders the banner and survives a real send (the write that used to replace it)
- an unreadable list is quarantined byte-for-byte before the first write replaces the live key
- a legacy chat list **and** the legacy bare `laya-session` pointer both migrate to `version: 1`
  in place, and the turns still render

Per-store coverage in the same file: memories (plus the cap is not counted as corruption),
projects + membership (newer payload refuses `create`; a hand-edited row is quarantined while
good rows load), drafts (v0 migrated, newer refused and reported, corrupt quarantined),
`laya-session` (bare id, quoted id, newer refused), RPA pointer (bare id migrated, non-id
quarantined, invalid save refused).

The e2e suites seed storage directly — `tests/edge-cases.e2e.ts` and `tests/acceptance.e2e.ts`
write **raw v0 arrays** — so they double as the "an existing user's data still loads" proof: they
were not rewritten to the new shape, and they pass unchanged apart from reading the envelope when
they assert on what was stored.

## 8. What was not done

- No state library, no dependency. `storage_version.ts` is ~200 lines and imports nothing.
- No boot-time migration run. Migrations are lazy, per key, on first read.
- No schema version for the Convex (cloud) side; that data is not in this browser and versioning
  it belongs to the backend, not to a client migration.
- No automatic compaction of `<key>:quarantine`. It is one extra payload at most; deleting it
  would be exactly the thing this document forbids.

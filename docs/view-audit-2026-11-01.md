# View audit — 2026-11-01

> **This file is the authority for registry ids and their realness.** Its header figure
> ("3 real / 4 partial / 15 stub / 5 guess", "27 registry entries") is the **pre-deletion
> snapshot**; the follow-up sections at the end supersede it, and `src/lib/registry.ts` holds
> 25 ids on `dff55b3`. Other documents that quote 27 or 29 ids are dated observations, not
> contradictions to resolve. Index: [README.md](README.md).

Which of the 27 registry entries are backed by something real, and which were reconstructed from
screenshots of Codex Desktop. Read this before building any screen.

**3 real / 4 partial / 15 stub / 5 guess.**

> **Status after the follow-up session (2026-11-01, `a77b9d2` and after).** The three fabrications
> below are fixed, and the audit's recommended order was carried out in part:
>
> - Fabrication 1 (Setup claiming a server): `http.local.ts` `/api/health` now answers `ok: false`,
>   and `Setup.svelte` requires a literal `true`.
> - Fabrication 2 ("measured on this machine"): the numbers are gone from the render paths.
>   `measured.ts` is null placeholders and the views say so.
> - Fabrication 3 ("Available"/"Installed"): stub rows carry `stub: true` and render
>   "not configured" / "no model is installed".
> - `chat` is no longer a stub: `src/lib/chat_dispatch.ts` routes Convex → `/api/ai/chat` → stub.
> - The three id spaces are one: see the navigation note below.
>
> Still guessed: `pricing`, `parameters`, `faq`, `performance`, `workspace-home`. Their invented
> numbers are removed, but none has a data source, so the classification stands. `Corpus`,
> `Reference` and `Schema` were deleted — they were registered by nothing and called by nothing.
>
> **Superseded 2026-11-02** by the follow-up at the end of this file: `performance` and
> `parameters` are deleted, and `pricing`/`faq`/`workspace-home` are kept with their unbacked
> claims removed. The registry is 25 ids, not 27.
>
> **Projects is no longer absent.** `src/lib/projects.ts` + `projects.spec.ts` (10 tests) give a
> chat a local project membership; `move-project` / `remove-project` dropped their
> `disabledReason` and the sidebar has a "New project" affordance. It is local state on the
> `draft_storage` pattern — no schema table, no route, no new dependency, and no permission.

| State     | Meaning                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `real`    | reads or writes through a real route or Convex function, and that has a test |
| `partial` | has a route or module but no test, or a test but no route                    |
| `stub`    | reads only from `src/lib/http.local.ts`, the in-browser stub                 |
| `guess`   | pure UI; no data source at all                                               |

## Backed by something real

| id         | backed by                                                          | state   |
| ---------- | ------------------------------------------------------------------ | ------- |
| `manef`    | `/api/manef/[...path]`, `server/manef.ts`, `manef.spec.ts`         | real    |
| `devices`  | Convex `devices.{list,register,revoke}`, `store.spec.ts`           | real    |
| `terminal` | Convex `devices.list`, `runtime/terminal.ts`, `terminal_buffer.ts` | real    |
| `keys`     | Convex `credentials.*` via ProviderManager; no test                | partial |
| `tools`    | Convex `devices.list`, `mcp.ts` tested, `deviceTools` untested     | partial |
| `files`    | browser File API; layout modules untested                          | partial |
| `browser`  | real `<iframe>` to a user URL; no route, no test                   | partial |

## The fifteen stubs

`chat`, `apps`, `transcribe`, `models`, `overview`, `voice`, `playground`, `snake`, `embeddings`,
`setup`, `backends`, `providers`, `chat-tools`, `chat-settings`, `chat-session`.

All of them read from `http.local.ts`. That file is a `sessionStorage` switch with fixed shapes
and fixed replies — it is not a backend. A stub is fine as a demo; it is not fine when the screen
asserts it is connected to a server.

## The five guesses

`performance`, `pricing`, `parameters`, `faq`, `workspace-home`.

No data source. `parameters` even documents `POST /api/custom`, a route that does not exist.

## Three fabrications worth fixing first

**1. Setup claims a server exists.** `Setup.svelte:42` treats `typeof health?.ok === 'boolean'` as
proof, and `http.local.ts:462` returns `{ ok: true, runtime: 'browser-stub' }`. The row renders
"Local server — Ready — The app is connected to the server on this laptop." There is no server.
`Deps.svelte:97` does the same with "0 packages missing".

**2. "Measured on this machine" is another machine's number.** `Compute.svelte:303-307` prints
`NPU 27.5 ms · GPU 30.8 ms · CPU 142.0 ms`, compile `14.1 s`, labelled _Measured on this machine ·
2026-10-26_. The values are literals in `measured.ts:25-30`, recorded against `"Intel Core Ultra 9
386H"` — a Laya/OpenVINO NPU that is not part of this repo. The claimed regeneration path,
`tests/bench_backends.py`, **does not exist** (`tests/` holds `dev-smoke.e2e.ts` only). The same
numbers repeat at `Overview.svelte:123`, `Faq.svelte:51`, `Transcribe.svelte:237-241`,
`Performance.svelte`.

**3. "Available" and "Installed" come from hard-codes.** `Providers.svelte:29` renders `Available`
from `b.ready`, hardcoded `true` at `http.local.ts:218`. `Chat.svelte:2736` renders
`Installation: Installed` from `installed: true` at `http.local.ts:241`, for `qwen3-npu`, `size: 0`.
Nothing is installed; nothing is available.

## Two findings that change the plan

**The real backend is not connected to any screen.** `/api/ai/chat` and `/api/mcp/tools` exist and
are tested — `server/ai/chat.spec.ts:90`, `mcp.spec.ts:87` — and their only caller is
`bin/codex-cli.mjs`. Zero references to `/api/ai` in `src/lib/views/**`.

Likewise `src/lib/cloud/chat.ts`: wired in `+layout.svelte:52-58`, six tests, and called by **no
view**. `Chat.svelte` has zero references to `cloudTurn` or `cloudAvailable`. So the chat screen
shows the stub while a working Convex chat path sits unused beside it.

That is the cheapest real win available: wire the two existing paths, delete the stub they
replace.

**The navigation model is half right.** Entry + `loadScreen` + hash destination maps cleanly onto
the shell's own pattern (hidden panels stay mounted,
`workspace-shell.svelte:1446-1452`). What fights it is one id space split across three files:
`registry.ts`, `SECTION_IDS` (`workspace-shell.svelte:833`) and `workspace_routes.ts:12-16`.
**Five** ids have no `loadScreen` (`chat`, `chat-tools`, `chat-settings`, `chat-session`,
`workspace-home`); three of those resolve through the chat panel via a hand-written map, `chat` is
passed as the `chat` prop directly, and `workspace-home` is the launcher. So an entry can be
"registered" and still do nothing. `registry.ts:238-246`
(`hasFeatureScreen`/`loadFeatureScreen`) is dead code — the shell re-implements both locally at
`:609-618`. (An earlier revision of this document said "seven"; the file-level count is five.)

Merge the id space into one before registering anything new, or every desktop surface added later
inherits the same ambiguity. **Done:** `workspace_routes.ts` now resolves every id through
`registry.ts` and throws at module load on a mismatch, and `src/lib/registry.spec.ts` asserts the
registry, the access rules and the routes name the same ids.

## Not determined

- Whether `PUBLIC_CONVEX_URL` is set in the deployed build. Every Convex screen is null-guarded on
  it; with it unset they render only the "not configured" branch. And the deployment is empty, so
  `credentials.*`, `chat.send` and `mcp.*` cannot be exercised locally either — no test covers them.
- Whether the `MEASURED` numbers were ever true for anyone. The bench script they point at is
  absent, so the values can only be confirmed as literals.
- Whether `cloud/chat.ts` being unused is intentional or drift.
- Whether `BrowserCanvas` ever renders a real page — depends on the target's `X-Frame-Options`;
  no test, no fixture.
- ~~`Corpus.svelte`, `Reference.svelte`, `Schema.svelte` exist but are **not registered** — dead
  views. Pruning or drift, unknown.~~ **Resolved:** all three were deleted in `d52e006`. They
  were registered by nothing and called by nothing, so drift was ruled out — they were
  fabrications, and they are gone rather than left as dead weight.

## Recommended order

1. Delete or clearly mark the five guesses. They carry invented numbers.
2. Fix the three fabrications above. A console that lies about being connected is worse than one
   that says "not configured".
3. Wire `/api/ai/chat` and `cloud/chat.ts` to `Chat.svelte`; remove the stub reply path.
4. Merge the three id spaces into one.
5. Only then adapt desktop behaviour onto the Svelte stack.

# Follow-up — 2026-11-02 (branch `feat/guessed-views`)

The five guesses are resolved. Two were deleted, three were kept after the unbacked claim in each
was removed. Nothing new was registered; the registry shrank from 27 ids to 25.

| id               | verdict    | what it was                                                    | what it is now                                                                                                         |
| ---------------- | ---------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `performance`    | **delete** | placeholder tables over `measured.ts` nulls                    | gone: view, registry entry, access rule, both inbound links                                                            |
| `parameters`     | **delete** | schema for an endpoint that does not exist                     | gone: view, registry entry, access rule                                                                                |
| `pricing`        | **keep**   | prose; no invented number, but two rows implied this build ran | kept as informational copy, subtitle now says this build has no billing route and the desktop-app rows are labelled so |
| `faq`            | **keep**   | accurate about the desktop app, wrong about this build         | kept, with a "This browser build" group first and desktop-only groups labelled in their headings                       |
| `workspace-home` | **keep**   | no view file — it is the launcher _host_, not a screen         | kept, and now asserted as a host in `registry.spec.ts` instead of being an unexplained absence of `loadScreen`         |

## Evidence per row

**`performance` — deleted.** `Performance.svelte:5-13` was six hardcoded rows whose only values
were `"—"` and the string `"Placeholder · unmeasured"`; `Performance.svelte:28,52` gave both tables
the heading "(unmeasured)". The data module behind it, `measured.ts`, was already nulls
(`:21-33`) — but it also still carried non-null literals nothing rendered: `whisperSizeMb: 85`,
`costPerRequest: "$0"`, `parameters: 421293830`, `download_mb: 405`, `iterations: 0`
(`measured.ts:11-18,44-49`). `measured.ts` had **zero importers** — no file in `src/`, `slices/`,
`shared/`, `scripts/`, `tests/` or `bridge/` imported it, and its only `eslint.config.js:160`
mention was an ignore-list entry. So the screen was a table of em-dashes over a module nobody
read. A table that can only say "unmeasured" is not a view; the honest statement belongs in the
place that would otherwise link to it. Deleted: the view, the registry entry (`registry.ts:114-121`),
the `feature_access.ts:23` rule, both `href="#performance"` links (`Overview.svelte:123`,
`Pricing.svelte:52`), `measured.ts`, and the two ignore-list lines that named it. The replacement
copy in `Overview.svelte` points at `#playground`, which does report the device and time of a real
run — that is the only measured number this repo can show, because the browser measures the
roundtrip itself (`Playground.svelte:322-330`).

**`parameters` — deleted.** `Parameters.svelte:80` documented `POST /api/custom` while telling the
reader it does not exist, and `:5,50` titled two of its three groups "schema (unimplemented)".
That is honest, but it is a reference page for an interface this repository does not implement:
`http.local.ts:588` maps `api.custom` to `post('/api/custom', …)`, which falls through
`dispatch()`'s `default` to `stubResponse()` and therefore returns
`{ error: reason, stub: true, reason }` — never a decision. The two callers that read it,
`Playground.svelte:230,248` and `Snake.svelte:150`, both check `d.error` and surface it as an
error, so no screen was lying. The cost of keeping it was a settings destination that teaches a
payload shape no code in the repo accepts. Deleted the view, the registry entry
(`registry.ts:154-161`) and the `feature_access.ts:33` rule. `api.custom` itself stays: `Snake`
and `Playground` need the call site so the real transport swap point is already wired, and both
handle its failure.

**`pricing` — kept, two claims corrected.** The rows carried no price and no number: `:4-25` were
statements like "No per-request fee" and "You supply the computer, electricity…". That is not a
fabrication. Two things were wrong, though. First, `:32` called this "this template" while
describing behaviour of the laya-npu desktop app — in this build there is no local inference to
avoid charging for. Second, `:14` said "Chat model size appears during setup", which no screen in
this build can show. Both fixed in the subtitle and the affected rows; `:9` now says this browser
build has no model rather than implying one is installed. The `#performance` button became
`#playground`. Kept because "what does this cost" is a real question about a local-first product
and the answer — you pay for hardware and electricity, not per request — is true and needs no data
source. A cost table only becomes a guess when it quotes a figure.

**`faq` — kept, provenance made explicit.** The content was accurate about the desktop app and
misleading about this one. `:113` told the reader to start `laya-npu.cmd` and press Reconnect;
`:92` described a `LAYA_PORTAL` heartbeat that no file outside the FAQ mentions; `:96` described a
working BYOK path while `http.local.ts:77-83` makes `configureEndpoint` an explicit no-op; `:100`
said chats "are saved locally … reloading preserves saved sessions" when the store is
`sessionStorage` (`http.local.ts:154-179`) and does not survive a tab close. `:9` sent the reader to
"Workflow Studio", which is an Automation tab (`Apps.svelte:313`), not a destination. All of that
is corrected, and a new first group, "This browser build", states what the page in front of you
actually is. Kept because a help screen's job is explanatory prose, and prose is not "guessed" once
each claim is either scoped to the product that has it or removed. It is the only reachable
description of the model contract (`choice`/`score`/`noul`, English-only, 256 tokens) and
`workspace_routes.ts:34` maps the shell's own Help menu item to it.

**`workspace-home` — kept, and now explained.** It has no `loadScreen` because it is not a screen:
`workspace_routes.ts:38` exports it as `launcherId`, `workspace-app.svelte:114` passes
`{ ...LAUNCHER_CONFIG, id: launcherId }`, and the shell mounts `WorkspaceLauncher` under that id at
`workspace-shell.svelte:1427-1445`, gated by `hasFeatureScreen` returning `false` for it
(`:609-612`) _so that_ the host component renders instead. Deleting the id would mean deleting the
launcher, which the shell contract requires (`slices/workspace-shell/README.md:45`). The real
defect was that "no `loadScreen`" was indistinguishable from the `Corpus`/`Reference`/`Schema` case,
where an id resolved to nothing at all. `registry.spec.ts` now separates the two: a registered id
either loads a view or appears in a closed `HOSTED` map with a written reason.

## The test that guards this

`src/lib/registry.spec.ts` gained three assertions, and is the file to extend if the shape changes:

1. **every registered id resolves** — a view with `loadScreen`, or an entry in `HOSTED`. An id with
   neither fails with `"<id>" has no loadScreen and no host. Delete it, or give it a real view.`
   Verified by adding an `orphan-probe` id: the suite fails and names it.
2. **the host list does not outlive the ids** — every `HOSTED` key must still be registered, every
   `chatPanels` id must be in it, and `launcherId` must map to the launcher. This is what stops
   `HOSTED` from becoming a second hand-maintained id list, which is the drift the audit's
   navigation section was about.
3. **no loader names a file that is not on disk** — the registry source is read and every
   `import('…svelte')` target is `stat`-ed. `loadScreen` is a dynamic import, so a deleted view is
   a click-time 404 that neither `tsc` nor `svelte-check` catches; this catches it.

Nothing pre-existing was weakened: the access-rule, route and uniqueness assertions are unchanged.

## What this does not settle

- **`performance` was not replaced by a benchmark screen.** The only real measurement this build
  can produce is a Playground roundtrip (`Playground.svelte:322-330`) and a Snake recording
  (`SnakeHistory.svelte:27-36`). A dedicated screen should be built on those two sources, or not at
  all — not on a `measured.ts`-style constant table.
- **`parameters` was not replaced by a live schema screen.** `api.custom` still answers
  `{ error, stub: true }`. When a transport is wired, the schema belongs next to it with a test,
  not in a settings page that describes a route as unimplemented.
- **`pricing` still has no metering.** That is the point: it states a policy, not a measurement.
  If hosted billing is ever added (`src/lib/server/integrations/payments.ts` exists and is
  unexercised), the table gains a real data source and should then show actual figures.

# View audit — 2026-11-01

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

# Cold start and long-session memory (2026-11-02)

Two perf passes came before this one. `docs/runtime-perf-2026-11-02.md` measured what the app
costs **while it runs** (4002 attribute writes per send → 6, `Intl.DateTimeFormat` reuse, keyed
turns) and the bundle pass cut 59 kB off first paint. Neither measured **cold start** or
**long-session memory**, and neither looked at **storage growth**. This document is those three.

Everything below was produced by a Playwright harness driving the built preview
(`DEPLOY_TARGET=node` → `node build`) in real Chromium, importing nothing from the app. The
harnesses live outside the repo in `/tmp/opencode/w3-perf/`; the numbers are reproducible from
them and the method for each is named in the table.

## Verdict up front

| Area                | What the numbers said                                                                                                                                               | What was changed                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Cold start          | Composer usable at **389 ms** (median), **223 ms** after `DOMContentLoaded`. Every millisecond of that gap is first-party module evaluation; nothing is deferrable. | **Nothing.** All candidate fixes measured below their own null noise.          |
| Long-session memory | Retained heap grows **linearly** with turns: 4.5 → 66.4 → 127.3 MB at 0/500/1000. It all returns on clear (6.4 MB, flat across stages).                             | **Nothing.** No leak.                                                          |
| Tab lifetime        | Idle drift **+0.03 MB / 45 s**. Streaming holds **≈2 bytes per streamed character** and returns it on stop.                                                         | **Nothing.**                                                                   |
| Storage             | **Unbounded.** 30 create/delete cycles left 30 `chat-mode:` keys, 6 → 36 keys, +4.1 kB. Nothing ever pruned a deleted chat's keys.                                  | **Fixed.** `pruneSessionDrafts` + `clearSessionDrafts` in `src/lib/drafts.ts`. |

One fix, and it is the only one the measurements condemned.

## How the numbers were taken

- Built preview of this worktree, `node build` on a free port, `Network.setCacheDisabled(true)`
  so "cold" means cold.
- Metrics from `PerformanceObserver` (`paint`, `largest-contentful-paint`,
  `long-animation-frame`, `longtask`), the Navigation Timing entry, and CDP
  `Performance.getMetrics` (task/script/layout/style, heap, node count) and `HeapProfiler`.
- **Composer usable** is measured the only way that means anything: an in-page
  `requestAnimationFrame` loop polls `#chat-message` for `!disabled`, records
  `performance.now()`, then a real keystroke is typed and the timestamp at which the field's
  value changes is recorded separately. "Enabled" and "accepts a keystroke" are therefore two
  different numbers, not the same one twice.
- **Noise discipline.** This host ran between load average 13 and 53 on 16 cores for the whole
  session (sibling agents). A **null A/B** — the same build against itself, same protocol — was
  run for every claim, and it moved by more than the candidate effects did. So no cold-start
  change is claimed below, including ones that looked favourable.

### Null A/B (same build vs itself, interleaved, median of 5)

| Metric           |   Arm A |   Arm B |       Null Δ |
| ---------------- | ------: | ------: | -----------: |
| FCP              |  764 ms | 1216 ms |  **+452 ms** |
| DOMContentLoaded |  781 ms | 1172 ms |  **+391 ms** |
| Composer usable  | 1322 ms | 2533 ms | **+1212 ms** |

That is the noise floor. It is larger than every cold-start delta measured here.

## 1. Cold start breakdown

Fresh navigation, no cache, median of 3 runs, on an idle-ish stretch of the host.

| Stage                            |              Value | Method                                                                                                   |
| -------------------------------- | -----------------: | -------------------------------------------------------------------------------------------------------- |
| DNS                              |             0.1 ms | Navigation Timing `domainLookupEnd - domainLookupStart`                                                  |
| Connect                          |             0.2 ms | `connectEnd - connectStart` (loopback, so trivial by construction)                                       |
| TTFB                             |            11.7 ms | `responseStart`                                                                                          |
| Response end (HTML)              |            13.2 ms | `responseEnd`                                                                                            |
| First contentful paint           |         **176 ms** | `PerformanceObserver('paint')`, `first-contentful-paint`                                                 |
| Largest contentful paint         |         **416 ms** | `PerformanceObserver('largest-contentful-paint')`, last entry                                            |
| DOMContentLoaded                 |         **166 ms** | `domContentLoadedEventEnd`                                                                               |
| `load`                           |             187 ms | `loadEventEnd`                                                                                           |
| Time to interactive              |         **816 ms** | first moment after FCP from which 5 s pass with no long task > 50 ms (`PerformanceObserver('longtask')`) |
| Composer **enabled**             |         **389 ms** | `rAF` poll of `#chat-message:not([disabled])`                                                            |
| Composer **accepts a keystroke** |         **484 ms** | `rAF` poll for a non-empty `.value` after a real keypress                                                |
| DCL → composer enabled           |         **223 ms** | difference of the two rows above                                                                         |
| DCL → keystroke accepted         |         **318 ms** | difference                                                                                               |
| JS decoded at first paint        | 622 kB in 35 files | `resource` entries, `decodedBodySize`                                                                    |
| CSS decoded at first paint       | 218 kB in 21 files | same                                                                                                     |
| Long tasks before quiet          |                  2 | `longtask`                                                                                               |
| Longest single task              |             303 ms | same                                                                                                     |

The headline is the last group: **the whole DCL → usable gap is 223 ms**, and nothing in it is
network. `responseEnd` is 13 ms and every script has landed by 243 ms.

### Where the 223 ms goes

Sampling profile (`Profiler.setSamplingInterval` 100 µs) windowed to
`[domContentLoadedEventEnd, composerEnabled]`, self time aggregated per `chunk.js :: function`.
Median of 2 runs, 0 turns seeded.

| Self time in the gap | Attribution                                                      |
| -------------------: | ---------------------------------------------------------------- |
|             121.7 ms | `s7Kb9efD.js :: (anonymous)` — the Svelte 5 client runtime chunk |
|              95.8 ms | `(program)` — V8 parsing/compiling module bodies                 |
|              57.3 ms | `2.CcejcniW.js :: (anonymous)` — the page node (shell + chat)    |
|              45.0 ms | `s7Kb9efD.js :: Hr` — Svelte's template/hydration helper         |
|              42.3 ms | Garbage collector                                                |
|              30.8 ms | `DgQoguWG.js :: o`                                               |
|              24.4 ms | `2.CcejcniW.js :: Ss` — the chat component's own mount function  |
|              21.4 ms | `s7Kb9efD.js :: ra`                                              |
|              18.3 ms | `Do9ZKdhg.js :: (anonymous)`                                     |
|              16.5 ms | `s7Kb9efD.js :: B`                                               |
|              16.3 ms | `appendChild` (native)                                           |

A Chrome trace of the same window agrees: one 236.9 ms `RunTask` immediately after the
`load` event, of which **226.7 ms is a single `RunMicrotasks`** — SvelteKit's
`import(start, app).then(kit.start)` chain — followed by 15.8 ms of `Layout`/`Paint`. The
`FunctionCall` events inside it total 16.9 ms; the rest is module evaluation attributed to
`(program)`.

**Attribution, named:** the gap is the Svelte 5 runtime plus the shell node. It is not one slow
effect, not one bad chunk, and not a mount that could be deferred — the mounts that exist on
first paint are the shell, the sidebar, the chat surface and the launcher, and each is on screen.

### What first paint actually mounts

`document.getElementsByTagName('*').length` at composer-usable: **227 elements, 6 hidden.**

|                             Region | Nodes            |
| ---------------------------------: | ---------------- |
| Chat surface (`.conversation-app`) | 97               |
|                           Launcher | 71               |
|                               Rail | 49               |
|                    Session sidebar | 46               |
|                   Runtime controls | 9                |
|                            Menubar | 9                |
|                  Dialogs (bits-ui) | 0 — none mounted |
|                       Output panel | 0 — none mounted |

That is already lean, and the lazily-loaded screens are genuinely absent: **0 JS files and 0 CSS
files are requested after the composer becomes usable.** The 59 kB bundle pass did its job.

### Cold start as a function of a stored session

Not part of the task's list, but the same harness answered it and it is the one number that
scales badly. Median of 3, seeded session, no cache.

| Stored turns |    FCP |    DCL | First turn painted | Composer usable |   Script |  Style | Layout |   Nodes |
| -----------: | -----: | -----: | -----------------: | --------------: | -------: | -----: | -----: | ------: |
|            0 | 132 ms |  75 ms |                  — |      **296 ms** |    18 ms |  18 ms |  44 ms |   1 609 |
|          100 | 156 ms | 150 ms |             595 ms |      **595 ms** |   209 ms |  50 ms |  77 ms |  26 433 |
|          500 | 136 ms | 121 ms |           1 375 ms |    **1 375 ms** |   762 ms | 192 ms | 148 ms | 125 233 |
|         1000 | 176 ms | 108 ms |           3 001 ms |    **3 001 ms** | 1 692 ms | 497 ms | 371 ms | 235 168 |

Superlinear in practice (500 → 1000 turns costs 2.2× the time for 2× the turns) and it is all
timeline rendering. This is the same ceiling `docs/runtime-perf-2026-11-02.md` already named:
the transcript is never virtualised. Not re-fixed here — it is a restructure, and the previous
pass documented why `content-visibility` breaks the AC17 scroll contract.

## 2. Long-session memory

Seeded sessions of 0/10/100/500/1000 turns go into `sessionStorage['workspace-template:sessions']`
before navigation; each turn is one message plus one reply containing bold, a list and inline code
so `RichText` renders real nodes. After load, `HeapProfiler.collectGarbage` twice, then CDP
`Performance.getMetrics`. Then the chat is deleted **through the UI** (Chat actions → Delete chat →
Confirm delete) and the same read is taken again. What does not return is a leak.

| Turns | Heap loaded | Δ vs empty |   Nodes | After clear | **Retained** |
| ----: | ----------: | ---------: | ------: | ----------: | -----------: |
|     0 |     4.54 MB |          — |   1 440 |           — |            — |
|    10 |     6.06 MB |   +1.52 MB |   4 093 |     6.11 MB |     +1.57 MB |
|   100 |    17.28 MB |  +12.74 MB |  27 043 |     6.32 MB |     +1.78 MB |
|   500 |    66.39 MB |  +61.85 MB | 129 043 |     6.39 MB |     +1.85 MB |
|  1000 |   127.28 MB | +122.74 MB | 256 543 |     6.39 MB |     +1.85 MB |

**Linear, not worse.** Retained per turn: 124 kB at 100, 124 kB at 500, 123 kB at 1000. No
knee, no doubling.

**After clear: 6.39 MB, and it stops moving.** 500 and 1000 turns both land on 6.39 MB with
1 619 nodes — the same node count as a 10-turn clear. The +1.85 MB over the 4.54 MB empty
baseline is fixed overhead that does not scale with turn count (10 turns retains 1.57 MB, 1000
retains 1.85 MB: the difference between the two is 0.28 MB across a 100× turn increase).

The previous pass reported the same thing at 500 turns (1.7–1.8 MB retained) and called it
correctly. This pass extends it to 1000 turns and confirms the _shape_: it is O(1), not O(n).

A heap-snapshot diff of the retained set after clearing 500 turns, aggregated by node type,
confirms there is no object type holding the transcript:

| Node type                                             | Δ after clear vs empty |
| ----------------------------------------------------- | ---------------------: |
| `code` (InstructionStream, BytecodeArray, ScopeInfo…) |               +1.14 MB |
| `native`                                              |                +369 kB |
| `string`                                              |                +337 kB |
| `array`                                               |                 +69 kB |
| `object shape`                                        |                 +65 kB |
| `closure`                                             |                 +21 kB |

That is compiled code and one-off shapes — the JIT warming up having executed 500 turns' worth of
paths — not retained data. A targeted retainer search for the seeded turn text
(`UNIQUEMARKER`) after clearing found **0 retained strings**: the transcript itself is fully
released.

**No memory fix was made, because there is nothing to fix.**

## 3. Tab lifetime

Page left open with a reply that never ends. The stream is synthesised in-page by patching
`window.fetch` so chunk delivery is genuinely incremental — Playwright's `route.fulfill`
buffers a `ReadableStream` and would have measured nothing (verified: with `route.fulfill` the
app never received a partial and never rendered `.streaming-text`).

**Endless streaming reply, 5 minutes, 25 deltas/s, heap sampled every 15 s after double GC:**

|     t |    Heap | DOM nodes | Listeners | Streamed chars |
| ----: | ------: | --------: | --------: | -------------: |
|     0 | 5.57 MB |       315 |       103 |             14 |
|  60 s | 6.20 MB |       315 |       103 |         13 800 |
| 121 s | 7.29 MB |       315 |       103 |         28 560 |
| 181 s | 7.18 MB |       315 |       103 |         43 290 |
| 242 s | 8.68 MB |       315 |       103 |         57 820 |
| 302 s | 7.76 MB |       315 |       103 |         72 760 |

+2.19 MB over 5 min, but **DOM nodes, listeners and element count are flat at 315/103/315 for the
whole run.** Nothing accumulates per update. The growth tracks the text length: a separate run
holding text length constant (`same`, 120 s) grew **+0.81 MB for 445 000 characters ≈ 1.9 bytes
per character**, which is the UTF-16 size of the reply string and nothing else.

**Control, and recovery:** 45 s idle on a loaded page drifts **+0.03 MB**. Streaming 60 s grows
+0.77 MB and **0.27 MB of that returns within 3 s of stopping**. Three consecutive 45 s streams
grow +1.48, +0.42, +0.17 MB — the later increments are the committed turns themselves (nodes
1793 → 1976 → 2159, i.e. one more turn in the DOM each time), not accumulating garbage.

**Timer-driven surface:** Scheduled tasks (`#automations`) left open 5 minutes on the same
harness. No heap creep beyond the idle control; the view holds no interval of its own and shows
its "unavailable, no deployment" state. The surfaces that _do_ hold intervals
(`Setup`/`Deps` at 8 s, `RuntimeControls` at 15 s, the shell at 30 s, `Models` only while a
download runs) each clear them in their `onMount` cleanup, and none is mounted unless its screen
is open.

**Streaming's real cost is not memory, it is layout.** Task time went 0.5 s → 75.6 s of CPU over
5 minutes, 5.51 s of it in `LayoutDuration` — every delta re-lays-out the growing reply. That is
the same unvirtualised-transcript ceiling as above, unchanged by this pass.

## 4. Storage growth

`sessionStorage` + `localStorage` byte totals (UTF-16 code units × 2) after seeding N turns and
sending one more, so the persist path runs.

| Turns | sessionStorage | localStorage |    Total |
| ----: | -------------: | -----------: | -------: |
|     0 |           1 kB |         1 kB |     2 kB |
|   100 |          61 kB |         1 kB |    62 kB |
|   500 |         299 kB |         1 kB |   300 kB |
|  1000 |         597 kB |         1 kB |   598 kB |
|  2000 |       1 199 kB |         1 kB | 1 200 kB |

Linear at **~0.6 kB per turn**, all of it the single `workspace-template:sessions` blob. Quota on
this build is ~19 968 kB (probed by writing until `setItem` threw). At 0.6 kB/turn a tab hits it
around **33 000 turns**, and the store already caps at `MAX_SESSIONS = 50` chats and reports the
overflow — so the session blob is bounded and self-reporting. `localStorage` stays at 1 kB
regardless of turn count: `workspace-template:tools-v1` (0.7 kB) plus `laya-session` (0.1 kB).

### The one thing that was unbounded

Per-chat draft keys are written under `laya-draft-v1:` and keyed by session id. Three of them
per chat: `chat:<id>` (the unsent draft), `chat-mode:<id>` (presentation mode), `chat-scroll:<id>`
(scroll offset). The delete path cleared **only** `chat:<id>`. Nothing ever pruned the other two,
and nothing pruned any key for a chat dropped past the write cap.

Measured by driving the UI — 30 cycles of New chat → type → Delete chat → Confirm:

|                     |                             Before |           After fix |
| ------------------- | ---------------------------------: | ------------------: |
| sessionStorage      |                1.5 kB → **5.6 kB** | 1.5 kB → **1.5 kB** |
| sessionStorage keys |                         6 → **36** |           6 → **6** |
| Growth per cycle    |                         **+140 B** |             **0 B** |
| Orphan keys left    | 30 (`chat-mode:` + `chat-scroll:`) |                   0 |

At +140 B per deleted chat this is unbounded and slow — a user would need thousands of chats to
notice — but it is unbounded by construction, which is exactly the shape that ends in a quota
error nobody can explain. The earlier pass fixed the quota _error_'s reporting; this fixes the
growth.

**Fix** (`src/lib/drafts.ts`):

- `clearSessionDrafts(id)` — drops all three per-chat keys. The delete path calls it instead of
  clearing the draft body alone.
- `pruneSessionDrafts(knownIds)` — sweeps every `laya-draft-v1:{chat,chat-mode,chat-scroll}:<id>`
  whose `<id>` is not in the live set. Called from `refreshSessions()`, which is the only point
  where the live session ids are known. It ignores keys that are not per-chat
  (`pinned-sessions`, `workspace-layout`, `byok-key`, `microphone`, `speech-controls`,
  `chat-list-sort`), treats everything after the first colon as the id (so an id containing a
  colon cannot be mistaken for a new prefix), and returns the number removed.

Guarded by `src/lib/drafts.spec.ts` (4 assertions): orphans swept, non-per-chat keys untouched,
colon-in-id handled, `clearSessionDrafts` drops all three.

## What was measured and found acceptable

- **DNS and connect on loopback** (0.1 ms, 0.2 ms). Trivial here by construction; only meaningful
  against a remote origin, which this harness cannot reach.
- **HTML delivery** (TTFB 11.7 ms, 35 kB document). Not a bottleneck.
- **Script and CSS volume at first paint** (622 kB JS in 35 files, 218 kB CSS in 21 files).
  Nothing is requested after the composer is usable — 0 late JS, 0 late CSS.
- **Heap per turn** (124 kB, linear 100 → 1000 turns). Expected for a DOM-per-turn transcript and
  returned in full on clear.
- **Heap after clear** (+1.85 MB, flat 500 → 1000 turns; 0 retained turn strings). Compiled code,
  not data.
- **Idle drift** (+0.03 MB / 45 s).
- **Streaming memory** (~1.9 B per streamed character = the string itself; DOM nodes flat).
- **Timer cleanup** on every surface that holds an interval.
- **Session blob growth** (0.6 kB/turn, capped at 50 chats, overflow reported to the user).

## What was measured and deliberately not changed

- **Cold start.** DCL → usable is 223 ms of first-party module evaluation (Svelte runtime +
  shell node). Every candidate — deferring the launcher, dropping the view-only stylesheets —
  moved by less than the null A/B (+1212 ms on composer-usable). Blocking the 10 view-only
  stylesheets (52 kB, all for screens that are not mounted) timed out the boot entirely, so they
  are not free to remove either: they are pulled by the page node's module graph, not by a mount.
  Doing this properly is a bundling change, not a deferral, and its effect would be unprovable on
  this host.
- **The unvirtualised transcript.** The real ceiling, named again: 1000 turns costs 3.0 s to
  become usable and 124 kB of heap per turn. Both are the same root cause, both need the AC17
  scroll contract re-proven, and both are a restructure this task's scope excludes.
- **Streaming layout cost** (5.5 s of layout per 5 minutes of streaming). Same root cause.

## Could not measure on this machine

- **DNS/connect/TLS to a real origin.** The preview is on `127.0.0.1`; there is no route from
  here to a representative remote host, so those rows are loopback numbers and are reported as
  such rather than extrapolated.
- **A stable cold-start delta.** Load average ran 13–53 on 16 cores throughout, and the null A/B
  moved 391–1212 ms. Any cold-start change made here would have been unfalsifiable.
- **`performance.memory` as a primary source.** Used only for cross-checking; all heap figures
  come from CDP `Performance.getMetrics` after `HeapProfiler.collectGarbage`×2, which is precise
  and not subject to the 100 kB bucket quantisation or the 20-minute `performance.memory` timer.
- **Scheduled tasks as a live timer.** `#automations` needs a Convex deployment to hold rows, and
  `PUBLIC_CONVEX_URL` is empty in this build, so it renders its unavailable state and holds no
  timer. Measured as "no creep", which is true but is not the same as measuring a running
  scheduler. No scheduler exists in this build.

## Gate

```
PLAYWRIGHT_PORT=4756 npx playwright test --workers=2
npx vitest run
npx prettier --check .
npx eslint .
npx svelte-check --threshold error
```

Results are in the commit message. One pre-existing failure is worth naming: the typed-ESLint
spec `src/lib/config/linting.spec.ts` boots a full TypeScript project service and times out its
30 s budget on this host when load is high. It fails identically on a clean checkout of
`597fdaf` with no changes applied, so it is the host, not this work.

# Runtime performance (2026-11-02)

Bundle weight was already measured and cut elsewhere: `25816fd` removed `tailwind-variants`
from `button.svelte` and lazified `ChatTools`/`SpeechControls`, 59 kB (~8.7%) off first paint.
This document is the other half — what the **running** app costs, measured in Chromium against
the built preview, and the three defects that measurement condemned.

Everything here was produced by a Playwright harness that drives the shipped UI and imports
nothing from the app. No new dependency; `@playwright/test`'s bundled `playwright` and CDP only.

## How the numbers were taken

- Built preview of this worktree (`DEPLOY_TARGET=node` → `node build`), two servers on
  separate ports, **interleaved** A/B: each repetition measures base then fix, and the next
  repetition flips the order. Medians of 5.
- CPU throttle via `Emulation.setCPUThrottlingRate` at **1×** and **6×**. 6× is the useful
  one: it is roughly a mid-range phone, and it exposes work that 1× hides inside idle time.
- Seeded sessions go into `sessionStorage['workspace-template:sessions']` before navigation,
  the same store `tests/acceptance.e2e.ts` uses. Each seeded turn is one message plus one
  reply containing bold, a list and inline code, so every turn renders real `RichText`.
- Metrics come from CDP `Performance.getMetrics` (task/script/layout/style durations),
  `PerformanceObserver('longtask')`, and DOM `MutationObserver`.

**Noise discipline.** This host carried a load average of 20-27 on 16 cores for most of the
session (sibling agents). Wall-clock medians therefore move by more than the effect at 6×.
So a **null A/B** was run: the same base build against an identical copy of itself, same
protocol. Every table below prints the null delta next to the real one. A metric is only
claimed as a win when it beats its own null noise.

## Results

### The gate on the timeline (fix 2) — the one clear win

`500 turns`, one send, append cost. `null` is the same-build control.

| Metric                                    |  1× base |            1× fix | null Δ | 6× base |            6× fix | null Δ | How measured                         |
| ----------------------------------------- | -------: | ----------------: | -----: | ------: | ----------------: | -----: | ------------------------------------ |
| Script time for one append                |   138 ms |  **52 ms** (−62%) |    −18 | 1193 ms | **379 ms** (−68%) |    −19 | CDP `ScriptDuration`                 |
| Total blocking time, append               |   460 ms | **259 ms** (−44%) |    +20 | 4103 ms |           2931 ms |   +897 | `PerformanceObserver('longtask')`    |
| Longest single task, append               |   266 ms | **130 ms** (−51%) |     +2 | 3050 ms |           2212 ms |  +1037 | same                                 |
| Recalc-style, append                      |   347 ms |            259 ms |     −7 | 2129 ms |           1946 ms |   +953 | CDP `RecalcStyleDuration`            |
| Wall clock, append                        |  1293 ms |           1231 ms |    +16 | 5320 ms |           4087 ms |   +818 | `Date.now()` around the send         |
| **Timeline attribute mutations per send** | **4002** |             **6** |      − |       — |                 — |      — | `MutationObserver` on `[role="log"]` |

The last row is the deterministic proof and the one to trust: 4002 → 6 attribute writes.
Wall clock at 6× (5320 → 4087) is _not_ claimed, because the null control moved by 818 ms.

### `messageTime` (fix 1)

`Date#toLocaleTimeString([], {hour, minute})` constructs a new `Intl.DateTimeFormat` on every
call. Measured in-page, 1000 calls each:

| Call                                                                  | Cost per call |
| --------------------------------------------------------------------- | ------------: |
| `date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })` |    **285 µs** |
| Reused `Intl.DateTimeFormat#format`                                   |    **2.6 µs** |
| `date.toISOString()`                                                  |        0.6 µs |

The timeline called it **twice per turn** — `messageTime(...).text` and
`messageTime(...).iso`, two separate calls on the same value in the same attribute pair.
A 500-turn render therefore spent ~1000 × 285 µs ≈ **285 ms** building throwaway formatters
before it painted anything. Counted directly: 1000 calls, 551 ms of wall time inside them.

### Flat, and reported flat

These did not move beyond their own null noise, so nothing was changed for them.

| Metric                                          |                 base |      fix | null Δ | Verdict                                                        |
| ----------------------------------------------- | -------------------: | -------: | -----: | -------------------------------------------------------------- |
| Time to interactive, 0 turns, 1×                | 286 ms (at 50 turns) |   276 ms |    −18 | flat                                                           |
| Time to interactive, 500 turns, 1×              |               971 ms |   896 ms |    +59 | flat — within noise                                            |
| Time to interactive, 500 turns, 6×              |              9206 ms |  8363 ms |  +1486 | flat — null noise exceeds the delta                            |
| Script time, whole load, 500 turns, 1×          |               422 ms |   337 ms |      − | mostly module parse + hydrate; only ~20% is timeline rendering |
| Keystroke → character painted, 500 turns, 1×    |               7.8 ms |   5.0 ms |     ±4 | flat                                                           |
| Keystroke → character painted, 500 turns, 6×    |              41.1 ms |  32.6 ms |    ±10 | flat                                                           |
| Scroll frame rate, 500 turns, 1×                |             60.6 fps | 60.3 fps |     ±2 | flat                                                           |
| Scroll frame rate, 500 turns, 6×                |             21.6 fps | 25.6 fps |     ±4 | flat                                                           |
| JS heap retained after clearing a 500-turn chat |               1.8 MB |   1.7 MB |      — | flat (nothing leaks)                                           |

## Defects the instrumentation exposed

### 1. `messageTime` rebuilt an `Intl.DateTimeFormat` per call, twice per turn

`Chat.svelte:578` called `date.toLocaleTimeString([], {...})`, which is specified to create a
fresh formatter. It was invoked twice for the same timestamp:

```svelte
time={messageTime(turn.created_at).text}
datetime={messageTime(turn.created_at).iso}
```

At 500 turns that is 1000 formatter constructions per render, each ~285 µs, all before first
paint. **Fix:** one module-scope `Intl.DateTimeFormat`, and one `{@const}` per turn so the
pair shares a call.

### 2. Every send wrote `disabled` to ~6 buttons per turn, and each write invalidated style document-wide

The message actions (`Edit in a new branch`, `Delete message and replies`, `Branch from this
reply`, `Delete assistant reply`) each bound
`disabled={busy || !!operation || attachmentWorking || voiceWorking || micActive}`. The
timeline re-renders on `session` changes, so every send re-wrote those attributes on every
turn: **4002 attribute mutations at 500 turns** (measured).

The writes are cheap; the _invalidation_ is not. Isolated:

| Operation on 3000 timeline buttons                                   |           Cost |
| -------------------------------------------------------------------- | -------------: |
| write a non-matching attribute (`data-probe`)                        |           2 ms |
| toggle `disabled` on all 3000 (stylesheet intact)                    | **425-915 ms** |
| toggle `disabled` on all 3000 (all stylesheets disabled)             |         117 ms |
| toggle `disabled` on all 3000 (the 23 `:disabled` rules neutralised) |      **65 ms** |

So ~85% of the cost was style recalculation driven by the 23 `:disabled` selectors in the
bundle, and it is spread across many rules, not one — stripping the global
`button:disabled` alone only took 430 → 350 ms. Containment did not help (`contain: style`
made it worse, `contain: strict` worse still). `content-visibility: auto` did make the churn
cheap (~20 ms) but corrupted `scrollHeight` on the transcript — 164 688 px vs 209 775 px —
which breaks the app's own scroll-to-end and AC17. Rejected.

**Fix:** one gate on the container. The four actions carry `class="gated-action"`; a single
`.timeline-gated` class toggle applies `pointer-events: none` and `opacity: .5`, and
`aria-busy` on the same element announces the state. The handler guards
(`forkSession`, `askMessageRemoval` both return early when `busy || operation`) already
existed and are unchanged, so a click that slips through is still refused.

### 3. The turn/reply `each` blocks were unkeyed

`{#each (session?.turns ?? []).filter(...) as turn}` and the reply loop had no key. Any filter
change re-associated DOM by index. **Fix:** `(turn.id ?? turnIndex)` and `(replySlot)`. This
is a correctness fix as much as a perf one — it is what makes appending one turn leave the
other 499 subtrees alone.

## Re-render storm: the classic Svelte defect, and it is NOT present

This was the headline suspicion and the instrumentation acquits the app.

With 500 turns seeded, typing 10 characters into the composer produced:

| Probe                                                           |                                                    500 turns |
| --------------------------------------------------------------- | -----------------------------------------------------------: |
| `MutationObserver` on the conversation log                      |                                              **0 mutations** |
| `MutationObserver` on the sidebar                               |                                              **0 mutations** |
| `MutationObserver` on the shell                                 |                                              **0 mutations** |
| `MutationObserver` on the composer                              | 1 (the `<button class="btn btn-solid">` that `Send` enables) |
| `Intl.DateTimeFormat` calls (would fire on any timeline render) |                                                        **0** |

Typing re-renders the composer and nothing else. The only cross-component write is the send
button's `disabled`, which is a single element — the correct scope.

Keystroke cost does rise with turn count (1.5 ms → 7.8 ms at 1×, 14.6 → 41.1 ms at 6×), but
hiding the timeline entirely (`display: none`) only recovers 12.8 → 9.5 ms at 50 turns and
26.4 → 18.6 ms at 500. That residual is layout for the whole chat surface, not a re-render,
and it was left alone: the alternative is virtualising the timeline, which is a restructure
this task's scope forbids.

## What was deliberately not changed

- **The timeline is not virtualised.** 30 800 DOM nodes at 500 turns is genuinely heavy, and
  `content-visibility` / windowing is the real fix. Both are restructures, and
  `content-visibility` measurably breaks `scrollHeight` and the AC17 scroll contract. Left as
  the largest remaining win, named below.
- **No debounce was added anywhere.** Draft saving on keystroke was measured: 11 `setItem`
  calls for 11 keystrokes, `JSON.stringify` total 0.5 ms. Not hot, so not touched.
- **No storage reads were moved.** `localStorage.getItem('laya-session')` runs once in
  `initialize()`; it is not on a keystroke path.
- **CSS was not "optimised."** Removing `:disabled` selectors would have moved the needle,
  but ~23 rules produce legitimate visual state, and the same 4002 mutations would remain.
  Fixing the writer was correct; fixing the reader would have been cosmetic.
- **`scrollEnd`'s forced layout was investigated and left alone.** It reads
  `scrollTop`/`clientHeight`/`scrollHeight` then `scrollTo`. Instrumented: 13 layout reads,
  **8 ms total** per send. Not worth a restructure.
- **Load time was not chased.** 500-turn load is ~800 ms of script at 1×, but the profile is
  module parse and hydrate — not timeline. Bundle work belongs to the sibling task.
- **No memory fix.** Clearing a 500-turn chat drops the heap from 62.3 MB to 6.4 MB against a
  4.6 MB empty baseline. 1.7-1.8 MB retained is unchanged by this work and is not a leak
  proportional to turn count.

## The remaining ceiling, named

`conversation-turn` count is the dominant cost of everything that touches layout, because all
of it is in the document at all times. Virtualising (or `content-visibility: auto` with a
correct `contain-intrinsic-size` and an explicit scroll-anchor strategy) is the next 10× on
append and scroll. It needs the AC17 scroll-preservation contract re-proven, which is why it
is a separate task and not part of this one.

## Gate

```
PLAYWRIGHT_PORT=4708 npx playwright test   # 102 passed
npx vitest run                            # 441 passed, 3 skipped (50 files)
npx prettier --check .                    # clean
npx eslint .                              # clean
npx svelte-check --threshold error        # 0 errors, 0 warnings
```

(`PLAYWRIGHT_PORT=4486` was occupied by another worktree's preview for the whole session; the
suite is port-agnostic via that variable, and 4708 was the free port.)

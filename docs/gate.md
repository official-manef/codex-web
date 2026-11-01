# The gate

`bin/gate` is the single command that decides whether this branch is shippable. There is no CI
in this repository, so it is also the only thing that does. It replaces a habit of running
`bun run check && bun run lint && bun run test` by hand and reading a green tail as proof.

```bash
bin/gate
```

Exit codes are the interface:

| Exit | Meaning                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Every step ran and passed. Nothing was skipped.                                                                                                    |
| `1`  | At least one step failed. The failing step, its duration and the tail of its output are printed.                                                   |
| `2`  | Nothing failed, but something did not run: a skip, a missing browser, a missing dependency. **This is not green** and must not be treated as such. |

Exit `2` exists because the alternative was a lie that already happened here twice in one day.

## Why a third state

Two green runs of the same commit disagreed about the same suite:

```
npx vitest run   # with a live-but-empty local Convex deployment
      Tests  197 passed | 3 skipped (200)

npx vitest run   # with nothing answering
      Tests  197 passed | 3 skipped (200)
```

That pair is reproducible on this branch today, but the handover for this repository reported
`179 passed, 4 skipped` as a fact. Both numbers are real; neither is a property of the code.
They are a property of **what happened to be listening on `127.0.0.1:3210`** when the suite
ran. A reader of the summary line alone cannot tell which run produced which number — the skip
count moved for reasons the summary does not name.

The damage is not hypothetical. A sibling repository pinned `CONVEX_URL` to a dead port
`9999`. Four security tests — anonymous queries refused, anonymous mutations refused, forged
identity rejected — skipped themselves permanently. The gate stayed green for as long as
nobody read the skip count, and an authentication boundary that had never been exercised was
reported as tested. In this repository the same three tests in
`src/convex/deployment.spec.ts` take exactly that path whenever the deployment is missing or
has no functions pushed.

So the gate distinguishes three outcomes per step, and only one of them is pass:

- **PASS** — the step ran and exited 0, and nothing in it was skipped.
- **FAIL** — the step ran and exited non-zero.
- **UNPROVEN** — the step could not prove what it exists to prove: tests skipped, no browser, no
  dependency. Printed with the reason and the command that fixes it.

The word is deliberately not "SKIP". `SKIP` reads like housekeeping; `UNPROVEN` reads like what
it is, which is a missing proof.

## What each step proves, and what it does not

| Step           | Passes when                                    | Proves                                                                                                   | Does **not** prove                                                                                                      |
| -------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `prettier`     | `prettier --check .` exits 0                   | The tree matches the committed formatting, so diffs stay reviewable.                                     | Anything about behaviour. Formatting is not correctness.                                                                |
| `eslint`       | `eslint .` exits 0                             | Async handling, Svelte a11y rules, slice boundaries, browser-safe imports and Convex query limits hold.  | Auth, tenancy, secret handling, rate limits, provider correctness. A typed rule is not a runtime guarantee.             |
| `svelte-check` | `svelte-check` exits 0 after `svelte-kit sync` | Template types and component diagnostics agree with the generated route types.                           | That the page renders, or that a rendered page is usable.                                                               |
| `convex-types` | `tsc --noEmit -p src/convex` exits 0           | The backend type-checks against the generated API, so client and server still agree on argument shapes.  | That the functions are deployed, or that they behave as their signatures claim.                                         |
| `vitest`       | 0 failures **and** 0 skips                     | Unit and integration behaviour, including `convex-test` runs against an in-memory deployment.            | Anything requiring a deployed backend — that is exactly what the skipped tests would have covered.                      |
| `build`        | `vite build` exits 0                           | The production bundle compiles and SvelteKit's server-only import graph resolves.                        | That the built app boots, serves, or hydrates.                                                                          |
| `playwright`   | `playwright test` exits 0                      | The built app boots in a real Chromium, hydrates, and the acceptance flows work at three viewport sizes. | Behaviour under real auth, real Convex data, real AI providers or real MCP servers: the config boots with all disabled. |
| `environment`  | —                                              | Reports the Convex deployment state and the browser binary before any step runs.                         | Nothing on its own; it is there so the rest of the output is interpretable.                                             |

Steps run in a fixed order — formatting, lint, types, unit, build, browser — because the cheap
checks catch the common mistakes first. The gate **never stops early**. A gate that halts at the
first failure reports one problem per run and hides every problem behind it.

## How skips are surfaced

`--reporter=verbose` is load-bearing, not cosmetic. It is the only vitest reporter that prints
the skip reason next to the skipped test; the `default`, `json` and `junit` reporters all drop
it (the `json` report emits `"status": "skipped"` with an empty `meta` and no message at all,
which is precisely how a skip becomes indistinguishable from a pass).

Each skipped test is printed with the reason the spec attached to it, grouped by reason:

```
skipped tests (3)
  3x  deployment reachable but auth boundary NOT proven: http://127.0.0.1:3210 is up but
      has no functions pushed: devices:list is not deployed. Run `npx convex dev` to push
      schema + functions.
        - src/convex/deployment.spec.ts > convex deployment: auth boundary > queries refuse an anonymous caller
        - src/convex/deployment.spec.ts > convex deployment: auth boundary > mutations refuse an anonymous caller
        - src/convex/deployment.spec.ts > convex deployment: auth boundary > a caller cannot forge an identity through the client
```

A skip whose reason cannot be recovered is printed as
`NO REASON REPORTED — treat as a silent skip and investigate`, never as a blank. The reason text
comes from the spec itself (`skipReason()` in `src/convex/deployment_probe.ts`), so the gate and
the tests cannot drift apart about why a test did not run.

When Convex is missing, the gate also prints what is missing and the fix:

```
  UNPROVEN  vitest         12.0s
            3 test(s) skipped, Convex is absent: Tests  197 passed | 3 skipped (200)
            fix: npx convex dev
```

The two Convex states are distinguishable in the output without reading the count, because the
count is the same in both:

| State     | Environment line                                                                   | Skip reason starts with                                                     |
| --------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ready`   | `convex    READY     devices:list is deployed; anonymous call answered: ...`       | _(no skip permitted: a skip here is reported as UNPROVEN and investigated)_ |
| `empty`   | `convex    EMPTY     http://127.0.0.1:3212 is up but has no functions pushed: ...` | `deployment reachable but auth boundary NOT proven: ...`                    |
| `absent`  | `convex    ABSENT    nothing answered at http://127.0.0.1:9999 (fetch failed)`     | `no Convex deployment: nothing answered at ...`                             |
| `unknown` | `convex    UNKNOWN   could not run src/convex/deployment_probe.ts`                 | whatever the suite reported; treated as not-ready                           |

## The port is per project, so the gate resolves it instead of guessing

Convex allocates the first free port pair from 3210 upwards, **per project**. On a machine with
a second Convex project, `3210` is that project's backend: `ps` showed pid 63870 serving
`/home/rahman/agent-work/kampungkomen/kampungkomen-shots`. A hardcoded port is therefore not
just stale, it can measure somebody else's deployment — and a foreign `devices:list` answers
`Please sign in.` exactly like ours, so the security tests would have gone green while proving
nothing about this repo.

This checkout's port lives in `.convex/local/default/config.json`. Both consumers read it
through `scripts/convex-local.mjs`:

- `vite.config.ts` sets `CONVEX_URL` before the suite runs;
- `bin/gate` sets the same variable for its environment probe.

An explicit `CONVEX_URL` in the environment still wins (that is how the table above is
exercised), and `src/convex/deployment_probe.ts` no longer contains a default port at all: with
none recorded, it reports `absent` — "no port was guessed". Pushing also needs Node 22 or 24;
see `docs/convex-local-setup.md` for both traps and the exact reproduction.

## Worked example: the trap this gate was built for

Reproduce it yourself. Both commands run the identical suite on an identical commit.

**State A — nothing answering.** Point `CONVEX_URL` at a dead port:

```bash
CONVEX_URL=http://127.0.0.1:9999 npx vitest run --reporter=verbose
```

```
 ↓ src/convex/deployment.spec.ts > ... > queries refuse an anonymous caller
     [no Convex deployment: nothing answered at http://127.0.0.1:9999 (fetch failed). Auth boundary NOT exercised — start one with `npx convex dev`.]
      Tests  197 passed | 3 skipped (200)
```

**State B — a deployment answering, with no functions pushed.** This is the state a developer
leaves behind when `npx convex dev` runs but the schema was never pushed:

```bash
npx vitest run --reporter=verbose
```

```
 ↓ src/convex/deployment.spec.ts > ... > queries refuse an anonymous caller
     [deployment reachable but auth boundary NOT proven: http://127.0.0.1:3210 is up but has no functions pushed: devices:list is not deployed. Run `npx convex dev` to push schema + functions.]
      Tests  197 passed | 3 skipped (200)
```

Identical counts, different reality. Without the verbose reason line, these two runs are the
same green output. That is the whole failure mode: **the summary line cannot tell you whether the
auth boundary was exercised, and it prints `197 passed | 3 skipped` either way.**

Now the same two states through the gate — the difference is unmissable and both exit `2`:

```
$ bin/gate                                  # State B
  convex    EMPTY     http://127.0.0.1:3210 is up but has no functions pushed: devices:list is not deployed
  UNPROVEN  vitest         12.0s
            3 test(s) skipped, Convex is empty: Tests  197 passed | 3 skipped (200)
            fix: npx convex dev
  6 passed, 1 unproven, 0 failed                     -> exit 2

$ CONVEX_URL=http://127.0.0.1:9999 bin/gate  # State A
  convex    ABSENT    nothing answered at http://127.0.0.1:9999 (fetch failed)
  UNPROVEN  vitest         17.2s
            3 test(s) skipped, Convex is absent: Tests  197 passed | 3 skipped (200)
            fix: npx convex dev
  6 passed, 1 unproven, 0 failed                     -> exit 2
```

Note that both runs are `unproven`, not `failed` and not `passed`. That is the intended verdict:
nothing is broken, but the auth boundary is unproven either way, and the gate refuses to call
that green.

## Known flake the gate does not hide

`tests/acceptance.e2e.ts` → `AC17 an append while reading keeps the position and marks new
content` is load-sensitive. Measured on a 16-core host:

- `npx playwright test` (default workers): failed in 2 of 4 full runs, on `mobile` and
  `narrow-mobile`, always at the final scroll assertion (`scrollHeight - scrollTop -
clientHeight < 2`) or at "New messages marker clears after reaching the bottom". Different
  tests and different project counts failed run to run — 2 failed/52 passed once, 1 failed/53
  passed another time, 54 passed a third.
- `npx playwright test --workers=1`: 54/54 passed, twice.
- Isolated (`--grep AC17`): 3/3 passed, repeatedly.

So it is a genuine parallel-load flake in the test's assumption that a programmatic `scrollTop`
assignment survives a concurrent render, not a broken feature. The gate reports it as `FAIL`
when it happens and does not retry: **`retries` is deliberately left at `0`** in
`playwright.config.ts`. Retrying until green is the same dishonesty as skipping, just slower.

`ponytail:` the honest fix is to make the assertion wait on the scroll settle rather than read
`scrollTop` immediately after assigning it. That is a change to a test's semantics, so it is
left out of a gate-only change. Add it when AC17 starts failing locally often enough to be worth
the review.

## Adding CI

There is deliberately no `.github/workflows/gate.yml`. A workflow that runs this gate correctly
needs a Convex deployment, and getting a meaningful `vitest` step in Actions means supplying
`CONVEX_URL` plus credentials to reach one as secrets. A workflow without them would run the
gate in the `absent` state and publish an `UNPROVEN` result — or, worse, someone would "fix" it
by pinning a port and turn the auth tests into the permanent silent skip this gate exists to
prevent. A gate that has to lie to be green in CI is worse than no CI: it manufactures the exact
false confidence being removed here.

If CI is wanted later, the honest shape is: provision a real deployment per run (or use
`convex dev --once` against a throwaway deployment id), pass it as `CONVEX_URL`, and let the
gate exit `2` when it is not there. The gate already fails closed, so the workflow needs no
special-casing — only a real backend.

## Limits worth stating plainly

- The gate is a local precondition, not a proof of production behaviour. It boots the app with
  `AUTH_ENABLED=false`, `AI_ENABLED=false`, `MCP_CLIENT_ENABLED=false` and an empty
  `PUBLIC_CONVEX_URL`. Every auth, AI and MCP path is therefore _disabled_, not _tested_.
- It does not run the real Convex deployment's own test suite, migrations or index usage.
- It does not check bundle size, performance, or accessibility beyond what ESLint and
  `svelte-check` enforce statically.
- `--reporter=verbose` output is parsed with `sed`/`awk`. If vitest changes its skip line format,
  the parser fails to find reasons and prints `NO REASON REPORTED` — loudly, rather than
  silently passing. The skip count comes from the same parse, so a format change surfaces as a
  visible problem instead of a quiet zero.

# Progress tracker

Living status for this repository. Correct only when a command below was run on the
commit named at the top. If a line here disagrees with the code, the code wins — fix the line.

Baseline: `d839f75`, `main`, 2026-10-31.

## Terminal bridge

`bridge/terminal-bridge.mjs` is the bridge `docs/terminal.md` used to describe as missing. One
file, no build step, no native dependency: it serves `GET /v1/health` and a
`WebSocket /v1/terminal` that authenticates through the `bearer.<token>` subprotocol and pipes
one shell per socket.

It runs on the user's machine, never on the app server — that is the whole point of the BYOK
device model. Ten tests in `src/lib/runtime/terminal-bridge.spec.ts` spawn it on a random port
and check a good token, a bad token, a shell that keeps state between frames, a handshake with
no subprotocol, a foreign origin, a binary frame, the token's absence from the shell's
environment, a forged `Host` against the same-host rule, and a non-numeric connection cap.
No mocks.

One trap worth recording: a WebSocket subprotocol name allows only RFC 6455 `tchar`, so a plain
base64 token contains `+`, `/` and `=` and every handshake dies with "invalid or duplicated
subprotocol". The bridge refuses such a token at startup and `TOKEN_PATTERN` in
`src/lib/runtime/terminal.ts` was tightened to match, because it previously accepted
characters that were guaranteed to fail.

## Default model: `cx/gpt-6.1-sol`

The `nine-router` catalog shipped in the companion Codex setup puts `cx/gpt-6.1-sol` on
priority 0, so it is what a new session picks. Measured 2026-11-01 against
`https://router.antinrml.com/v1`:

| probe                          | `cx/gpt-6.1-sol`     | `ctx/conextlab/…deepseek-v4.1-flash:cloud`   |
| ------------------------------ | -------------------- | -------------------------------------------- |
| chat                           | pass                 | pass                                         |
| shell execution                | pass                 | pass                                         |
| `apply_patch`                  | pass, on disk        | pass                                         |
| MCP tool call                  | pass                 | pass                                         |
| sub-agents                     | **pass**             | **fail** — `unsupported call: collaboration` |
| screenshot (2.3 MB, 1093×6000) | **pass, 17,274 tok** | **fail** — see below                         |
| trivial exec, tokens           | ~14,700              | ~15,558                                      |

Two capabilities decide this, and both fail silently on a non-OpenAI upstream:

**Sub-agents.** The gateway's Responses→Chat translator flattens the `collaboration`
namespace into one opaque function, so `spawn_agent`, `wait_agent` and the other five
members never reach the model. It calls `collaboration` and the router answers
`unsupported call: collaboration`. `cx/*` is OpenAI-native and survives the translation.
It is also the only catalog entry where sub-agents pass.

**Images.** Sending a screenshot through a non-OpenAI upstream does two silent things.
The upstream is **swapped** — an identical request comes back as `kimi-k2.7-code:cloud`
with `output_tokens: 0` and an empty `output` — and the image base64 is **tokenised as
text**, at ~3.11 characters per token. That is what `exceeded max context length by
1633305 tokens` actually meant; the 1,000,000 window was never the cause. The same image
through `cx/*` costs 17,274 tokens and the model really reads it.

Use `ctx/*` for text-only work, where it is fine and slightly cheaper. Anything with a
screenshot needs `cx/*`. Setting `DEFAULT_MODEL` when regenerating the catalog pins
whichever slug you choose.

## Where we are

| Area                       | State                       | Evidence                                                                                                                              |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Shell + workspace routes   | shipped                     | `slices/workspace-shell`, `/` mounts the workspace                                                                                    |
| Chat surface + composer    | shipped                     | `slices/workspace-shell/shared/chat-ui`, `src/lib/views/Chat.svelte`                                                                  |
| Terminal panel             | shipped                     | `src/lib/runtime/terminal.ts`, `src/lib/views/Terminal.svelte`                                                                        |
| Device pairing             | shipped                     | `src/lib/views/Devices.svelte`, `src/lib/auth_state.ts`                                                                               |
| BYOK providers (`cloud`)   | shipped, 11 providers       | `src/convex/providers.ts`                                                                                                             |
| BYOK providers (SvelteKit) | shipped, 4 providers        | `src/lib/server/ai/config.ts`                                                                                                         |
| `nine-router` provider     | shipped on both paths       | both files above; see the note below                                                                                                  |
| BYOK chat (SvelteKit path) | shipped                     | `src/lib/server/ai/{chat,config}.ts`                                                                                                  |
| Outbound MCP client        | shipped                     | operator path `src/lib/server/mcp/client.ts` (allowlist + manual confirm); per-user path `src/lib/cloud/mcp.ts` → `src/convex/mcp.ts` |
| Inbound MCP server         | shipped, read-only          | `/api/mcp/server`, one `starter_status` tool                                                                                          |
| MANEF AI hub bridge        | shipped, loopback allowlist | `src/routes/api/manef/[...path]`, three paths only                                                                                    |
| Feature access + toggles   | shipped                     | `src/lib/feature_access.ts`, `src/lib/config/surface.ts`                                                                              |
| ChatGPT parity evidence    | shipped                     | `docs/chatgpt-desktop-parity-windows.md`                                                                                              |

### `nine-router` on both paths, deliberately duplicated

The slug exists twice, and that is not an oversight:

| path            | file                          | providers |
| --------------- | ----------------------------- | --------- |
| `cloud` engine  | `src/convex/providers.ts`     | 11        |
| SvelteKit route | `src/lib/server/ai/config.ts` | 4         |

`src/convex/` cannot import from `src/lib/` — the Convex runtime bundles its own module
graph, so a shared constant is not an option without a build step. Both files pin the same
host (`https://router.antinrml.com/v1`) and both are host-pinned, so a mismatch would be
visible as a key sent to the wrong origin. Change one, change the other, and run
`vitest run src/convex src/lib/server/ai`.

## Gates, measured on this commit

Run 2026-11-02 on `test/convex` (`bin/gate`, exit 0):

```

prettier --check    clean
eslint .            clean
svelte-check        0 errors, 0 warnings
tsc -p src/convex   clean
vitest run          57 files / 596 passed / 3 skipped
vite build          ok
playwright          114 passed   (--workers=2; the default count is host-dependent, see below)
convex              READY (schema + functions pushed to this checkout's local backend)
```

The earlier numbers (`36 files / 197 passed / 3 skipped`) were measured before the Convex push
and before the route contract suites landed; the 3 skips are the anonymous-refusal assertions,
which now execute. See "The auth boundary is PROVEN" below.

`playwright` is host-sensitive. At an unbounded worker count Playwright's own webServer lifetime
can end before the last files run, producing `net::ERR_CONNECTION_REFUSED` against a server that
was already torn down — 77 failures with nothing wrong in the app. `--workers=2` is green here
(114 passed); `--workers=1` is green too and slower. Treat the browser number as "with a bounded
worker count".

This block is the only place gate numbers belong. Other documents link here instead of
copying them; a count repeated in three files is how `138 passed (27 files)` survived two
route rebuilds.

## Local activity log

`src/lib/server/log.ts` (one module, no dependency) writes NDJSON activity records for local
debugging. It is **off by default**: `LOG_LEVEL` must be set to `debug`, `info`, `warn` or
`error`, so a production deployment that sets nothing writes no file and no bytes.
`LOG_FILE` picks the path; the default `./.local-logs/activity.jsonl` is git-ignored and
created lazily on the first record.

Captured, one call per surface: `ai.config` (provider and model counts, MCP flag/server
count), `ai.chat.start` (provider, model, message count, total characters),
`ai.chat.end` (`ok`/`error`), `mcp.tools` (action, alias, tool name, outcome) and
`mcp.server` (JSON-RPC method, status, outcome).

Deliberately never captured: request or response bodies, message text, `authorization` or
`cookie` headers, API keys and tokens, and URLs with a query string. `logEvent` accepts flat
primitives only — an object or array is dropped rather than serialized — `redact()` strips
`sk-`, `Bearer ` and `x-api-key` shapes plus URL query strings, records are capped at 4 KiB,
and a write failure is swallowed. It is a developer aid, not an audit trail or a second
source of truth: nothing in the app reads the file.

## The auth boundary is PROVEN (closes the section below)

Measured 2026-11-02 on `test/convex`, `bin/gate` **exit 2 → exit 0**.

The three auth assertions had never executed. The cause was three things stacked, none of them
a broken boundary:

1. **`127.0.0.1:3210` was another project's backend.** `ps` shows pid 63870 running with
   `--local-storage /home/rahman/agent-work/kampungkomen/kampungkomen-shots/.convex/local/...`.
   The CLI allocates ports per project from 3210 up, so a hardcoded number landed on a stranger.
2. **Pushing needs Node 22 or 24.** Under the default `v26.7.0` the push died with
   `DeploymentNotConfiguredForNodeActions: ... Node.js v22 or 24 is not installed`, because
   `src/convex/chat.ts` is a `'use node'` module. `export PATH=~/.nvm/versions/node/v24.22.2/bin:$PATH`
   fixes it.
3. **`expect.requireAssertions: true`** (in `vite.config.ts`) fails any test that registers zero
   assertions. Two of the three tests only called `assertRefused()`, which enforces its verdict by
   throwing — so once they finally ran they failed with `expected any number of assertion, but got
none`. A runner complaint, never a security finding.

What the backend answered once the functions were pushed on this checkout's own port:

```
$ curl -s http://127.0.0.1:3212/instance_name
anonymous-agent

$ curl -s -X POST http://127.0.0.1:3212/api/query -H 'Content-Type: application/json' \
    -d '{"path":"devices:list","args":{},"format":"json"}'
{"status":"error","errorMessage":"[Request ID: ...] Server Error
Uncaught ConvexError: Please sign in.
    at requireUser (../../src/convex/_shared/auth.ts:20:8)
    at async handler (../src/convex/devices.ts:36:15)
","errorData":"Please sign in."}
```

`Please sign in.` is the pass condition: `requireUser` ran and no row was read. Before the push
the same request said `Could not find public function for 'devices:list'.`

```
$ npx vitest run src/convex/deployment.spec.ts --reporter=verbose
 ✓ the deployment state is classified, not assumed
 ✓ queries refuse an anonymous caller
 ✓ mutations refuse an anonymous caller
 ✓ a caller cannot forge an identity through the client
      Tests  4 passed (4)          # 0 skipped

$ npx vitest run
      Tests  446 passed (446)      # was 441 passed | 3 skipped

$ bash bin/gate
  convex    READY     devices:list is deployed; anonymous call answered: ... Please sign in.
  PASS      prettier / eslint / svelte-check / convex-types / vitest / build / playwright
  7 passed, 0 unproven, 0 failed
  PASS — every step ran, nothing was skipped
```

The durable fix, so the port cannot go stale again:

- `scripts/convex-local.mjs` reads `ports.cloud` + `deploymentName` from
  `.convex/local/default/config.json` (Node built-ins stay out of `src/convex/`, which Convex
  bundles and which would demand a `'use node'` module).
- `vite.config.ts` sets `process.env.CONVEX_URL` from it; `bin/gate` does the same for its
  environment probe. An explicit `CONVEX_URL` still wins, which is how the state table in
  `docs/gate.md` is exercised.
- `deploymentUrl()` has **no hardcoded default** any more. A checkout with no recorded
  deployment reports `absent` — "no port was guessed" — instead of probing 3210.
- The two tests now assert `classifyAuthFailure(rejection) === 'refused'` in addition to calling
  `assertRefused`. The assertion is added, not weakened: the boundary is still required to
  answer a refusal, and a successful anonymous call still fails.

Setup is reproducible in `docs/convex-local-setup.md`. Still unproven: anything about a **cloud**
deployment, and that a genuine Google identity is _accepted_ — `AUTH_CLIENT_ID` is unset locally,
so `auth.config.ts` registers zero providers and only the refusal side is exercised.

## [superseded 2026-11-02] The auth boundary is unproven, not proven

> Kept because the reasoning about `Server Error` vs a refusal still holds, and because the
> numbers below are what a hardcoded port really measures. Outcome: proven above.

`docs/auth.md` used to say the anonymous-refusal assertions were covered. On this machine they
are not, and the difference matters because the failure and the proof look alike.

The deployment on `127.0.0.1:3210` answers, so it is not absent — but it has no functions:

```
$ curl -s http://127.0.0.1:3210/version
unknown

$ curl -s -X POST http://127.0.0.1:3210/api/query -H 'Content-Type: application/json' \
    -d '{"path":"devices:list","args":{},"format":"json"}'
{"status":"error","errorMessage":"[Request ID: ...] Server Error
Could not find public function for 'devices:list'."}
```

`Server Error` is not a refusal. Pointing `CONVEX_URL` at 3210 therefore produced two failures
(`queries refuse an anonymous caller`, `mutations refuse an anonymous caller`) whose assertion
expected `/[Ss]ign in|not_authenticated|Unauthorized|Not authenticated/`. The cause was a
missing backend, not a broken auth boundary — and a gate that reads only "failed" cannot tell
those apart either.

What changed, all of it in `src/convex/deployment_probe.ts` + `deployment.spec.ts`:

- The probe classifies the deployment as `absent`, `empty` or `ready`. A skip is only allowed
  for the first two, and the skip reason names the state, the URL and the missing thing.
- `assertRefused` throws on `Could not find public function` and on any unrecognised
  rejection. A plain `Server Error` can no longer pass as "the boundary held".
- `src/convex/deployment_probe.spec.ts` pins all three states against fake responses, so the
  guard runs in CI with no backend. It also fails if the spec regains a dead port or an
  unconditional skip.

**Current verdict for the auth boundary: unproven.** Run `npx convex dev` to push schema and
functions; the same `npx vitest run` then reports 0 skips in that file and the three auth assertions
run for real.

A sibling gate (`bin/codex-clone-quicktest` in the other repo) pinned
`CONVEX_URL="${CONVEX_URL:-http://127.0.0.1:9999}"`. Port 9999 is dead, so that gate forced the
skip forever while a live deployment was ignored — a green run that had silently dropped four
tests. `bin/` in this worktree holds only `codex-cli.mjs`, so there is nothing to fix here; if
that gate is ever used against this repo it must resolve the port from
`.convex/local/default/config.json`, not pin one.

## Correction — the AC test suites do not exist (historical, superseded)

> **This section is history.** It is kept because it records how a stale claim survived three
> files. It is **not** the AC verdict. The single authority for which criterion has a test
> today is [ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md).

`docs/PRD.md` §7 and `docs/implementation-plan.md` §10 both stated that
`tests/workspace.e2e.ts` and `tests/acceptance.e2e.ts` cover AC01–AC18. They did not exist
in this tree, and nothing in `src/` or `slices/` referenced an AC id:

```
find . -name '*e2e.ts' -not -path './node_modules/*'
  ./tests/dev-smoke.e2e.ts          # 4 tests, hydration + navigation only
grep -rn 'AC[0-9][0-9]' src slices   # no matches
```

They were deleted deliberately by `6ed1f3e` ("rebuild on the Laya NPU workspace template"),
which removed the `/workspace`, `/capabilities`, `/settings` route family and their
acceptance suites. The PRD and the implementation plan were not updated in that commit.

So: **zero of AC01–AC18 have a browser test right now.** The unit suite covers schema,
guards, transport, auth and config — not the acceptance scenarios. Both documents are stale
and are corrected here rather than quietly satisfied.

What `tests/dev-smoke.e2e.ts` actually proves, over three viewports: a clean clone boots
without credentials and hydrates, a local send appends a timeline entry with a stub reply,
a settings destination opens the settings window, and rail navigation reaches a lazily
loaded screen.

## Not started

Ordered by the reasoning in `docs/chatgpt-desktop-parity-windows.md` §7, cheapest first.

| #   | Item                                        | Blocker                                                                  | Status       |
| --- | ------------------------------------------- | ------------------------------------------------------------------------ | ------------ |
| 1   | Projects                                    | none; `move-project`/`remove-project` already carry `disabledReason`     | done         |
| 2   | Git surface: status, recent commits         | allowlist + fixed argv; writes policy-gated, deny by default             | done (gated) |
| 3   | Plugin-extension entrypoints (MCP App host) | host + protocol + manifest + screen; the `mcp_app` verb is not consulted | partial      |
| 4   | Memories                                    | Convex when signed in, local otherwise, explicit import button           | done         |
| 5   | Bridge-backed tool execution                | client + route wired; the bridge has not grown the HTTP verbs            | partial      |
| 6   | Scheduled tasks                             | records + a dry-run decision route; still no runner                      | partial      |

Done rows name the file that carries them: Projects `src/lib/projects.ts`, Memories
`src/lib/memories.ts` + `src/convex/memories.ts`, Git `src/lib/server/git.ts` +
`src/routes/api/git/+server.ts`, policy `src/lib/server/policy.ts`.

The git surface used to be read-only. As of 2026-11-02 it also stages, commits and manages
worktrees — behind `GIT_POLICY_JSON`, which denies every verb when unset or malformed. Diff and
status stay open because they cannot write. Push and PR review remain absent: no forge
credential is in reach, so claiming them would repeat the AC mistake this document exists to
correct. Full phase-by-phase status: `docs/parity-checklist-2026-11-02.md` §6 and §7.

Two validation findings worth keeping: `chat.ts` used to index the policy by tool name rather
than policy verb, and three auth assertions had no `expect` at all — they only ever passed while
the Convex deployment was empty. `bin/gate` now carries the probed deployment URL into vitest so
the script and the spec cannot disagree about which backend they mean; before that, the gate
reported UNPROVEN against another project's backend on 3210 while this checkout's own deployment
answered correctly on 3214.

Out of scope unless a product decision changes it: parallel chat orchestration, Computer
Use, mobile remote relay, MCP 2.0 events.

## Restoring AC coverage

If AC01–AC18 are still the acceptance bar, the cheapest recovery is to read the deleted
suites out of history rather than rewrite them:

```
git log --all --oneline --diff-filter=D -- tests/workspace.e2e.ts tests/acceptance.e2e.ts
git show ad4a909:tests/acceptance.e2e.ts | head -40
```

They target the pre-`6ed1f3e` route family (`/workspace`, `/capabilities`, `/settings`), so
they will not run as-is: the shell now owns navigation and `/` mounts the workspace. Treat
them as the scenario list, not as runnable tests, and re-point each at the current
selectors before claiming the AC. Do not restore the files and call the gate green.

> **Done 2026-11-02.** `tests/acceptance.e2e.ts` is back with 14 criteria driving the current
> shell (composer, hash navigation, settings window, output tabs, timeline). AC05, AC09,
> AC13 and AC16 are recorded as **no longer applicable** instead of tested: the deleted route
> family owned the `offline` retry path, the dirty-tab contract, the capability catalog and
> the composer's authorization input. AC03, AC06 and AC12 assert only the part of their
> scenario this build performs. Details, selectors and the cost of a full pass:
> [ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md).

## How to update this file

Run the commands, paste the numbers, change the state word. Do not mark "shipped" from a
typecheck — the PRD says it plainly: a green typecheck is not browser proof.

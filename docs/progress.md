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
device model. Six tests in `src/lib/runtime/terminal-bridge.spec.ts` spawn it on a random port
and check a good token, a bad token, a shell that keeps state between frames, a handshake with
no subprotocol, a foreign origin, and a binary frame. No mocks.

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

| Area                       | State                       | Evidence                                                       |
| -------------------------- | --------------------------- | -------------------------------------------------------------- |
| Shell + workspace routes   | shipped                     | `slices/workspace-shell`, `/` mounts the workspace             |
| Chat surface + composer    | shipped                     | `slices/chat`, local runtime adapter                           |
| Terminal panel             | shipped                     | `src/lib/runtime/terminal.ts`, `src/lib/views/Terminal.svelte` |
| Device pairing             | shipped                     | `src/lib/views/Devices.svelte`, `src/lib/auth_state.ts`        |
| BYOK providers (`cloud`)   | shipped, 11 providers       | `src/convex/providers.ts`                                      |
| BYOK providers (SvelteKit) | shipped, 4 providers        | `src/lib/server/ai/config.ts`                                  |
| `nine-router` provider     | shipped on both paths       | both files above; see the note below                           |
| BYOK chat (SvelteKit path) | shipped                     | `src/lib/server/ai/{chat,config}.ts`                           |
| Outbound MCP client        | shipped                     | `src/lib/cloud/mcp.ts`, allowlist + manual confirm             |
| Inbound MCP server         | shipped, read-only          | `/api/mcp/server`, one `starter_status` tool                   |
| MANEF AI hub bridge        | shipped, loopback allowlist | `src/routes/api/manef/[...path]`, three paths only             |
| Feature access + toggles   | shipped                     | `src/lib/feature_access.ts`, `src/lib/config/surface.ts`       |
| ChatGPT parity evidence    | shipped                     | `docs/chatgpt-desktop-parity-windows.md`                       |

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

```
vitest run          29 files / 149 tests passed
prettier --check    clean
eslint .            clean
svelte-check        0 errors, 0 warnings
tsc -p src/convex   clean
```

Playwright is **not** green and cannot be claimed: see the correction below.

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

## Correction — the AC test suites do not exist

`docs/PRD.md` §7 and `docs/implementation-plan.md` §10 both state that
`tests/workspace.e2e.ts` and `tests/acceptance.e2e.ts` cover AC01–AC18. They do not exist
in this tree, and nothing in `src/` or `slices/` references an AC id:

```
find . -name '*e2e.ts' -not -path './node_modules/*'
  ./tests/dev-smoke.e2e.ts          # 4 tests, hydration + navigation only
grep -rn 'AC[0-9][0-9]' src slices   # no matches
```

They were deleted deliberately by `6ed1f3e` ("rebuild on the Laya NPU workspace template"),
which removed the `/workspace`, `/capabilities`, `/settings` route family and their
acceptance suites. The PRD and the implementation plan were not updated in that commit.

So: **zero of AC01–AC18 have a browser test right now.** The 138 unit tests cover schema,
guards, transport, auth and config — not the acceptance scenarios. Both documents are stale
and are corrected here rather than quietly satisfied.

What `tests/dev-smoke.e2e.ts` actually proves, over three viewports: a clean clone boots
without credentials and hydrates, a local send appends a timeline entry with a stub reply,
a settings destination opens the settings window, and rail navigation reaches a lazily
loaded screen.

## Not started

Ordered by the reasoning in `docs/chatgpt-desktop-parity-windows.md` §7, cheapest first.

| #   | Item                                        | Blocker                                                              | Status      |
| --- | ------------------------------------------- | -------------------------------------------------------------------- | ----------- |
| 1   | Projects                                    | none; `move-project`/`remove-project` already carry `disabledReason` | not started |
| 2   | Git surface: status, diff, stage, commit    | needs a server route + repo allowlist + process boundary             | not started |
| 3   | Plugin-extension entrypoints (MCP App host) | needs `@openai/mcp-extensions`; measured as the largest single gap   | not started |
| 4   | Memories                                    | needs a table and a retention decision                               | not started |

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

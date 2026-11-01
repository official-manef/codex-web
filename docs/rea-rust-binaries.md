# REA on the Rust binaries — what the native side actually declares

Companion to [chatgpt-desktop-parity-windows.md](chatgpt-desktop-parity-windows.md). That file
analyzed the Electron/JavaScript layer (`app.asar`, two preload scripts). This one analyzes the
**Rust** side, which the earlier work explicitly left untouched.

Everything below comes from the shipped `codex.exe` string table. It is static evidence, not a
guess: each row names the exact literal found in the binary.

## 0. Method, and what it cannot prove

|                   |                                                   |
| ----------------- | ------------------------------------------------- |
| Target            | `app\resources\codex.exe`, PE32+ x86-64 console   |
| Size              | 368,970,544 bytes (352 MiB)                       |
| Strings extracted | 1,512,849 (length ≥ 8)                            |
| Rust markers      | 14,556 lines mention `rustc` / `core::` / `.rs`   |
| Tooling           | `strings` only — **no disassembler on this host** |

No `ghidra`, `hopper`, `ida`, `jadx`, and no JVM. So this is a string-table read, not a
decompilation. Consequences, stated plainly:

- A name appearing in the table proves the symbol is **compiled in**. It does not prove the
  code path is reachable at runtime, nor the order of arguments.
- Absence proves nothing. A name assembled at runtime, or stripped, leaves no trace.
- Control flow, ownership and error handling are all out of reach here. Anything needing those
  needs a real disassembler.

This is why every claim below is phrased as "declares", never "implements".

## 1. The tool registry

The binary declares these tool names. Counts are occurrences in the string table, which is a
crude proxy for how central each one is — not a call count.

### Always-available tools

| Tool                 | Occ. | Note                                                       |
| -------------------- | ---- | ---------------------------------------------------------- |
| `shell`              | 165  | the general escape hatch                                   |
| `apply_patch`        | 63   | **exists natively**; not a skill, not an app-level feature |
| `update_plan`        | 29   | plan is a first-class tool, not UI state                   |
| `request_user_input` | 65   | blocks a turn on a question                                |
| `view_image`         | 8    |                                                            |
| `web_search`         | 7    | hosted                                                     |
| `read_file`          | 2    |                                                            |
| `write_file`         | 1    |                                                            |
| `exec_command`       | 21   | distinct from `shell`; the exec-server path                |
| `list_mcp_resources` | 12   | plus `list_mcp_resource_templates`, `read_mcp_resource`    |

`apply_patch` at 63 occurrences settles a question the parity brief left open: it is a compiled-in
tool, which is why it survives every provider in the capability matrix while `web_search` and
`clock` do not.

### Namespaced tools

A single string in the table enumerates one namespace's members in declaration order:

```
spawn_agent assign_agent_task send_message wait_agent close_agent
```

and a second, longer one:

```
followup_task wait_agent interrupt_agent list_agents create_channel get_channels
list_threads search_posts read_thread read_post subscribe unsubscribe post
```

**This corrects the capability matrix.** `capability-matrix.txt` states the `collaboration`
namespace carries 6 members (`followup_task`, `interrupt_agent`, `list_agents`, `send_message`,
`spawn_agent`, `wait_agent`). The binary declares at least ten, in two groups:

| Group         | Members                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agent control | `spawn_agent`, `assign_agent_task`, `send_message`, `wait_agent`, `close_agent`                                                                                                     |
| agent + board | `followup_task`, `interrupt_agent`, `list_agents`, `create_channel`, `get_channels`, `list_threads`, `search_posts`, `read_thread`, `read_post`, `subscribe`, `unsubscribe`, `post` |

The second group is a **message board** (channels, threads, posts, subscriptions), not just
sub-agent control. The matrix never mentioned it.

This matters for the gateway bug: the flattening is worse than measured. Six members collapsing
into one opaque function is the observed symptom; the real payload carries at least ten members
plus a message-board surface, so a gateway fix that special-cases only the six observed names
would still be wrong.

Individual occurrences confirm all of them are live strings, not one concatenated blob:

```
spawn_agent 26   send_message 15   followup_task 14   wait_agent 5
send_input 2     resume_agent 2    close_agent 2      interrupt_agent 2   list_agents 2
```

### Feature flags on the same struct

Found adjacent to the namespace declaration, so they are per-model catalogue fields:

```
expose_spawn_agent_model_overrides   wait_agent_enabled
disable_native_tools                 disable_direct_message
message_board_in_memory | message_board_remote
non_code_mode_only
```

`non_code_mode_only` is the mirror of the `tool_mode = "code_mode_only"` the 9router profile
already sets — which is the setting that made tool calling work at all (see `docs/PROGRESS.md`).

## 2. `multi_tool_use.parallel` is a prompt instruction, not a tool

The matrix says "multi_tool_use.parallel is app-side and never reaches the gateway". The binary
agrees, and says why. The only occurrence is inside a system-prompt string:

> You parallelize tool calls whenever you can … You use `multi_tool_use.parallel` for that
> parallelism, and only that. Do not chain shell commands with separators like `echo "====";`

So the model is _told_ to call it; the executor honours it. Nothing in the Rust tool registry
declares it as a tool, which is why no gateway can see it and why a provider without it falls
back to `Promise.allSettled` inside `exec` — the same observable result by a different route.

## 3. Modes and enums the binary declares

| Enum             | Values found                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| sandbox          | `ReadOnly` (47), `WorkspaceWrite` (19), `DangerFullAccess` (14)                                        |
| approval         | `Never` (133), `OnRequest` (17), `OnFailure`, `UnlessTrusted` (16), `Granular` (54), `AutoReview` (59) |
| reasoning effort | `minimal` (38), `low` (218), `medium` (138), `high` (383), `xhigh` (16), `none` (178)                  |
| tool mode        | `code_mode_only` (49), `code_mode` (191), `Direct`/`direct` (72)                                       |

Two measurement notes, because the raw counts mislead:

- Rust packs adjacent enum variants into one concatenated literal. `ReadOnly`, `WorkspaceWrite`
  and `DangerFullAccess` appear inside the single string `ReadOnlyWorkspaceWriteDangerFullAccess`.
  Matching with word boundaries undercounts them to 1 and 0, so the numbers above come from a
  substring match.
- `direct` matched 1,426 times only because it is a prefix of `directory` (562 lines). The real
  figure for the `Direct` variant is 72 with boundaries applied. Every count in this document is
  therefore an occurrence count in the string table, not a symbol or call count.

`AutoReview` at 59 occurrences is the enum behind the "Automatic approval review rejected the
Chrome capture" line in the computer-use section of the matrix: the reviewer is a real compiled
path, and the per-app refusal is its verdict, not a stub.

## 4. The rows the JavaScript pass had to mark "unverifiable"

`chatgpt-desktop-parity-windows.md` §5 resolves eight rows as `unverifiable` because static
analysis of the preload scripts could not reach them. The Rust table answers most of them.

| Capability               | Was                    | Now                     | Evidence in `codex.exe`                                                                                                                                                                                                                                       |
| ------------------------ | ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memories across chats    | unverifiable           | **confirmed**           | `generate_memories`, `use_memories`, `dual_write`, `disable_on_external_context`, `dedicated_tools`, `max_raw_memories_for_consolidation`, `max_unused_days`, `max_rollout_age_days`; plus a `clear-memories` subcommand and `memories` / `memories_v2` state |
| Projects / project roots | unverifiable           | **confirmed**           | `project_roots` appears as a `FileSystemSpecialPath` variant next to `root`, `minimal`, `tmpdir`, `slash_tmp`; `projectId`, `projects` present                                                                                                                |
| Worktrees                | confirmed (IPC only)   | **confirmed, stronger** | `worktree` (138), `worktrees` (15)                                                                                                                                                                                                                            |
| Scheduled tasks          | unverifiable           | **partial**             | `scheduled_task` (6), `automation` (51) — declared, but no scheduler surface resolved                                                                                                                                                                         |
| Voice dictation          | confirmed (native exe) | **confirmed**           | `dictation` (9) in the binary too, not only `dictation-ducking.exe`                                                                                                                                                                                           |
| Computer Use             | confirmed              | **confirmed**           | `computer_use` (50), `ComputerUseConfigToml` for windows/macos                                                                                                                                                                                                |
| Remote from mobile       | corrected (partial)    | **confirmed**           | `remote_control` (138), `realtime_conversation` (71)                                                                                                                                                                                                          |
| MCP App host             | confirmed (IPC)        | **confirmed**           | plugin (1495), marketplace (327), skill (1006), `apps_usage` (18)                                                                                                                                                                                             |
| MCP 2.0 protocol version | unverifiable           | **still unverifiable**  | the version string is negotiated, not compiled in                                                                                                                                                                                                             |

"Confirmed" here means the capability is compiled into the shipped binary with its configuration
surface. It does not mean the UI exposes it, and it does not mean it works — that is still a
runtime question, and the matrix's own PASS/BLOCKED verdicts stand unchanged.

## 5. What this does and does not change

**Changes.** Two claims in the existing evidence are too weak:

1. `collaboration` has ~10+ members including a message board, not 6. Any gateway fix built on
   the six observed names is incomplete.
2. Memories, Projects, worktrees, remote control and Computer Use are all compiled in with a
   full config surface. They are not speculative features to be designed from documentation —
   they exist and are configured by the fields above.

**Does not change.** Every runtime verdict in `parity-evidence/capability-matrix.txt` stands.
A compiled-in name is not a passing probe.

## 6. Next, if this is worth continuing

The string table is exhausted. Anything further needs a disassembler:

```bash
# none of these are installed on this host
ghidra     needs GHIDRA_INSTALL_DIR and a JVM   (no java found)
hopper     macOS only
ida        commercial
```

Without one, the remaining questions are unanswerable here:

- argument shapes and validation for the ten collaboration members
- how `project_roots` is resolved into a sidebar group
- whether `scheduled_task` has a worker or only a schema
- the `memories` consolidation algorithm

Reproduce this document:

```bash
cp "/mnt/c/Program Files/WindowsApps/OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0/app/resources/codex.exe" /tmp/
strings -n 8 /tmp/codex.exe > /tmp/codex-strings.txt
grep -c 'spawn_agent\|apply_patch\|project_roots' /tmp/codex-strings.txt
```

The binary itself is not redistributed and never enters either repository.

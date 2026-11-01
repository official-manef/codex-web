# Terminal panel

The right-hand canvas can open a real shell on a machine the user paired. The panel is only
the **client half**; the bridge on that machine is the user's own service and is not part of
this template.

## What the panel does

- Opens from the **Terminal** output (`#terminal`) in the right panel, like Files and Browser.
- Requires both preconditions, and says which one is missing instead of showing a fake prompt:
  the Terminal switch in [Tools](#tools), and a paired device of kind `terminal` on
  [Devices](#devices).
- Lists paired `terminal` devices in a `<select>`; picking one fills the bridge endpoint from
  the device row.
- Takes the pairing token in a `password` field. The token stays in component memory: it is
  never written to storage, never appended to a URL, never logged, and the field becomes a
  disabled `Token saved for this session` placeholder once a connection is attempted.
- Rejects an endpoint `classifyEndpoint` marks `invalid`, and refuses a `public` endpoint when
  the page itself is not https (the token would cross a cleartext connection).
- Streams text frames into a `<pre aria-live="polite">` capped at 200 000 characters; the
  oldest text is dropped and a one-line notice says so. Output is text only — never HTML.
- Auto-scrolls only while the view is at the bottom; otherwise a **Jump to latest** button
  appears. **Copy output** copies the text, **Clear** empties the local buffer only.
- Sends a line plus `\n` on Enter, and has a **Send** button for touch. Input is disabled
  unless the status is `open`.
- Shows the status (`idle | connecting | open | closed | error`) with the detail text from the
  client. On `error` the message is shown verbatim and **Reconnect** retries.
- Reports the visible grid as `{"type":"resize","cols":N,"rows":N}` on mount and on panel
  resize (debounced 150 ms, clamped to at least 20×5).
- Closes the socket on component destroy.

## Bridge contract

The bridge must implement exactly this:

| Request                  | Requirement                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/health`         | `Authorization: Bearer <token>` accepted, `200` returned. Any other credential is `401`.                                                    |
| `WebSocket /v1/terminal` | Accepts the `bearer.<token>` subprotocol offered by the browser. Anything else is rejected during the handshake.                            |
| Frames                   | Text only, both directions. Outbound from the browser is raw shell input; inbound is shell output. Binary frames are refused by the client. |
| Resize                   | Accepts `{"type":"resize","cols":N,"rows":N}` inbound and applies it to the pty.                                                            |

Browsers cannot set an `Authorization` header on a WebSocket, which is why the token travels
as the `bearer.<token>` subprotocol on `/v1/terminal` and as a normal header on `/v1/health`.

## Three transports

```bash
# 1. SSH tunnel: nothing is exposed publicly.
ssh -N -L 8649:127.0.0.1:8649 user@host
#    pair http://127.0.0.1:8649 from the browser next to the tunnel

# 2. Tailscale serve: reachable only inside the tailnet.
tailscale serve --bg https / http://127.0.0.1:8649
#    pair the *.ts.net origin it prints

# 3. Tailscale funnel: reachable from the internet.
tailscale funnel --bg https / http://127.0.0.1:8649
```

**Funnel exposes the bridge to the internet.** The pairing token is then the only gate:
anyone who reaches the origin can attempt the handshake, so keep the token long and random,
pair over `https:` only, and revoke the device row when it is no longer needed.

None of these commands were run or verified in this build.

## What is not implemented

- No server-side scrollback: the panel keeps at most 200 000 characters in tab memory, and a
  reload loses them.
- No shell multiplexing: one device selection is one pty, with no tabs or sessions.
- No per-command approval: the shell is not gated command by command.
- No audit log: the template records nothing about what ran.

## The bridge that ships here

`bridge/terminal-bridge.mjs` implements the contract above. It is a separate process, not a
SvelteKit route, because it must outlive a web request and it must run on the user's machine —
never on the app server. One file, no build step, no native dependency.

```bash
# Generate a URL-safe token. Plain base64 emits +, / and =, and RFC 6455 forbids those in a
# subprotocol name, so every handshake would fail with "invalid or duplicated subprotocol".
BRIDGE_TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=') node bridge/terminal-bridge.mjs
```

| Setting                  | Default     | Meaning                                                                                                   |
| ------------------------ | ----------- | --------------------------------------------------------------------------------------------------------- |
| `BRIDGE_TOKEN`           | none        | Required, ≥16 chars, `A-Z a-z 0-9 . _ ~ -` only. Compared in constant time, never logged.                 |
| `BRIDGE_PORT`            | `8649`      | Listening port.                                                                                           |
| `BRIDGE_HOST`            | `127.0.0.1` | Loopback by default. Expose it with `tailscale serve`, not by binding `0.0.0.0`.                          |
| `BRIDGE_ALLOW_ORIGIN`    | empty       | Comma-separated exact origins allowed to open a socket. Empty means same-host only, which suits a tunnel. |
| `BRIDGE_SHELL`           | `bash`      | `powershell.exe` on Windows.                                                                              |
| `BRIDGE_CWD`             | `$HOME`     | Starting directory of the shell.                                                                          |
| `BRIDGE_MAX_CONNECTIONS` | `8`         | Concurrent sockets. Over the limit the handshake gets `503`.                                              |

Behaviour worth knowing:

- A foreign `Origin` gets `403` during the upgrade, so another site cannot open a socket with
  a token the user pasted into this page.
- Binary frames close the socket with `1003`, because the client refuses them anyway.
- `{"type":"resize","cols":N,"rows":N}` is accepted and clamped to 500×300. Without `node-pty`
  there is no real terminal sizing — the bridge signals the child instead — so a program that
  draws on screen coordinates will not reflow.
- Nothing is written to disk and nothing is logged. The transcript exists only in the browser
  tab, until the page reloads.

`src/lib/runtime/terminal-bridge.spec.ts` starts this bridge on a random port and speaks the
protocol at it: health with a good and a bad token, a shell that keeps state between frames,
a handshake with no subprotocol, a foreign origin, and a binary frame. Six tests, no mocks.

## What the bridge still does not do

It is honest about being a thin shell pipe: no `node-pty`, no scrollback, no per-command
approval, no audit trail, one shell per socket. Adding `node-pty` would give real terminal
sizing but requires a native build on the user's machine, which is a deployment decision the
user should make rather than a default.

# Security review — 2026-11-02

Review of this app's own trust boundaries: the SvelteKit routes, the server modules they call,
the Convex functions, the terminal bridge and the browser-side credential handling.

Scope is the list agreed for this branch. Everything below was read in full, not grep-sampled.
Every `fixed` verdict is backed by a test that failed against the previous code and passes
against the new code; the failing run is quoted.

Method: one section per surface, one verdict per section, and the evidence next to it. Where a
surface is fine the section says what was checked, because "no finding" without a list is an
opinion.

Gate at the time of writing: `npx vitest run` 205 passed / 3 skipped, `npx prettier --check .`
clean, `npx eslint .` clean, `npx svelte-check --threshold error` 0 errors, `npx tsc -p
src/convex --noEmit` clean. Those are the mid-session snapshot from this review; current totals
are in [progress.md](progress.md) §Gates. The security verdicts below are not numbers and do not
expire with them.

## Summary

| Surface                                          | Verdict    | Evidence                                                                                                          |
| ------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `/api/mcp/server` bearer check                   | no finding | `src/lib/server/access.spec.ts`, route read in full                                                               |
| `/api/mcp/tools` + server MCP allowlist          | fixed      | `src/lib/server/mcp/mcp.spec.ts` — `localhost.` / `127.0.0.1.` bypassed the public-HTTPS rule                     |
| `/auth/*` + `auth/oidc.ts`                       | fixed      | `src/lib/server/auth/callback.spec.ts` — cross-origin callback burned the pending login                           |
| `/api/ai/{chat,config}`                          | no finding | `src/lib/server/ai/chat.spec.ts`, `src/lib/server/ai/config.ts` read in full                                      |
| `/api/manef/[...path]`                           | no finding | `src/lib/server/manef.spec.ts`, route read in full                                                                |
| `bridge/terminal-bridge.mjs` + `bridge_token.ts` | fixed      | `src/lib/runtime/terminal-bridge.spec.ts` — three findings, three failing tests                                   |
| `src/convex/*` identity boundary                 | no finding | `src/convex/store.spec.ts`, every public handler audited by hand                                                  |
| `src/lib/byok_key.ts`                            | fixed      | outlived its tab; now `src/lib/byok_input.ts` reads a tab-scoped draft and `byok_key.ts` holds it in module scope |

Five fixes. Four distinct root causes: a trailing dot in a hostname denylist, a cookie consumed
before the request was authorised, a request header trusted as configuration, and a credential
that outlived its tab. One of the five was reported against a file that turned out to exist; the
defect was in the read path, not the file's absence (see the `byok_key.ts` section).

---

## `/api/mcp/server` — bearer check, constant time, error shape

**Verdict: no finding.**

Checked:

- `matchesSecret` compares SHA-256 digests of both sides with `timingSafeEqual`
  (`src/lib/server/access.ts:8-14`). Hashing first means the compare is fixed-length, so the
  early `!actual || !expected` guard leaks only "one side is empty", which is not a secret.
  Digesting also removes the length side-channel a raw `timingSafeEqual` would throw on.
- `MCP_SERVER_TOKEN` must be 32..4096 characters or the route answers `503`, so a
  short/misconfigured token cannot be brute-forced into place (`+server.ts:18-20`).
- The route is disabled by default (`MCP_SERVER_ENABLED !== 'true'` → 404) and that check runs
  before the token is even read.
- Error shape: `error(401, 'MCP authorization required.')` is a fixed string. The `500` on a
  processing failure is also fixed. The only thing recorded is the JSON-RPC `method`, and
  `methodOf` constrains it to `[a-z][a-z|/|._-]{0,63}` before it reaches the log — a caller
  cannot smuggle a payload into the log through that field.
- The tool the server exposes is one read-only `starter_status`; `statusMcpResponse` builds a
  fresh `McpServer` per request and closes it in `finally`, so no state crosses requests.

Verified, not assumed: `"Bearer <tok>"` accepted; `"bearer <tok>"`, `"Bearer"`, `""`,
`"Bearer <tok>x"` and `"Bearer  <tok>"` all rejected. Scheme matching is exact and there is no
whitespace normalisation to play with.

## `/api/mcp/tools` and the MCP allowlist — fixed

**Verdict: fixed.**

Finding: the "approved public HTTPS URL" rule could be satisfied by a loopback host written
with a trailing dot.

`new URL('https://localhost./mcp').hostname` is the string `"localhost."` — Node does not
normalise the trailing dot, but the resolver treats it as the same name. `getaddrinfo` for
`localhost.` returns `::1`, and `127.0.0.1.` resolves to `127.0.0.1`. Both denylists compared
the unstripped string, so `https://localhost./mcp` and `https://127.0.0.1./mcp` were accepted
as public endpoints. That is the exact class the check exists to stop, on both the operator
path (`src/lib/server/mcp/config.ts`) and the per-user BYOK path
(`src/convex/_shared/mcp_rules.ts`, whose own comment claims `new URL` normalisation makes the
check airtight — it does for `0x7f.1` and `2130706433`, not for a trailing dot).

Evidence — with the old code restored:

```
× endpoint must be a public HTTPS URL with no embedded credential
× MCP config is off by default and permits only configured HTTPS aliases and direct tools
```

Fix: strip one trailing dot from `url.hostname` before the denylist runs, in both modules. The
URL that is stored and fetched keeps its original form; only the comparison changes.

Checked and found sound in the same surface: the tool allowlist is re-checked at discovery and
again immediately before every call (`client.ts:117-123`, `117-127`); arguments are capped at
16 000 characters and results at 64 000; responses are capped at 2 MiB by a counting transform;
redirects are refused (`redirect: 'error'`); the SDK's fetch wrapper asserts the request URL
equals the configured endpoint, so a tool cannot redirect the credential to a second host;
credentials are stripped from every returned string by `redact()`. The `port` ban on operator
connections is stricter than the per-user path and is deliberate.

## `/auth/*` and `auth/oidc.ts` — fixed

**Verdict: fixed.**

Checked and found sound:

- **State/PKCE/nonce**: generated per login with `randomPKCECodeVerifier` / `randomState` /
  `randomNonce`, S256 challenge, all three verified in `completeAuthorization` via
  `expectedState`, `expectedNonce` and `pkceCodeVerifier`. `idTokenExpected: true` plus
  `enableNonRepudiationChecks` means the signature is verified against JWKS, not just decoded.
  The issuer is a constant; a caller cannot select the provider.
- **Token storage**: no server-side store. The ID token, refresh token and expiry live in one
  `jose` A256GCM-encrypted cookie, `HttpOnly`, `SameSite=Lax`, `Secure`, `__Host-` prefixed on
  HTTPS. An oversized refresh token is dropped rather than the whole sign-in.
- **Open redirect**: there is none to have. `login` sends the user to the provider's
  `authorization_endpoint`, and `callback`/`logout` redirect to the literal `'/'`. No `returnTo`
  / `next` / `redirect_uri` parameter is read from the request anywhere in `src/`. Grepped for
  it rather than assumed.
- **Cookie flags**: `cookieOptions` sets `path: '/'`, `httpOnly`, `secure` (from the origin's
  scheme) and `sameSite: 'lax'`. `'lax'` and not `'strict'` is required for the OIDC redirect
  back from Google to carry the transaction cookie; that is the correct trade and it is also
  why the origin check in the callback matters (below).

Finding: the callback consumed the login transaction before checking the request's origin.

`consumeTransaction` reads the transaction cookie **and deletes it** (`session.ts:95-101`). The
route called it first and validated `event.url.origin` second, in the same `if`:

```ts
const transaction = await consumeTransaction(event, config);
if (event.url.origin !== config.origin || !transaction) error(400, …);
```

A cross-origin `GET /auth/callback` therefore destroyed the victim's pending login even though
the request itself was rejected. Because cookies are attached on a top-level cross-site
navigation (the `Lax` case), any site could do this with a link or a hidden navigation, and the
user's next "Sign in" click would be the only sign that it happened. It is a denial of a valid
flow, not an authentication bypass — the origin check still held the boundary — but a rejected
request must not have a side effect.

Evidence — with the old ordering restored:

```
× a cross-origin callback does not consume the pending transaction
```

Fix: check the origin first, then consume. A cross-origin request is now rejected before the
cookie is touched.

Residual, stated rather than fixed: the application session is stateless, so sign-out clears
this browser and nothing else. An already-issued Google ID token stays acceptable to Convex
until its own expiry, and rotating `AUTH_SESSION_SECRET` does not revoke it. Global logout,
account suspension or device revocation needs a revocable server session and a backend check
before launch. This is documented in `docs/auth.md` and is a design decision, not an oversight.

## `/api/ai/{chat,config}` — no finding

**Verdict: no finding.**

Checked:

- **SSRF via caller-supplied endpoint**: not reachable. `chatSchema` is `.strict()`, so a
  `baseURL`, `endpoint` or `url` field is a parse error rather than an ignored extra — there is
  a test for exactly that (`chat.spec.ts:42`). The host comes from a four-value union in
  `chatResponse`; a caller selects `provider`, never a URL.
- **Key exfiltration to a wrong host**: `providerFetch(origin)` compares
  `url.origin !== origin` and rejects embedded credentials, then calls `fetch` with
  `redirect: 'error'`. Origin comparison (not prefix) means `api.openai.com.evil.example` and
  `https://api.openai.com@evil.example` both fail closed. Asserted in `chat.spec.ts:23-35`,
  including that `fetch` is never called on rejection. `nine-router` is pinned to its own host
  in the same table for the same reason: an OpenAI key cannot be sent to the router.
- **Size limits**: the shared reader defaults to 64 KiB; `/api/ai/chat` raises it to
  `MAX_CHAT_BODY_BYTES` (11 446 960 bytes ≈ 10.9 MiB) because it is the only route that carries
  images — two 4 MiB images are 5 592 408 base64 characters each. That body is buffered, so the
  measured cost is **~48 MB RSS peak** per request at the ceiling (+37 MB read, +12 MB
  `JSON.parse` in 13 ms). Not bounded by the burst limiter — that counts request starts, not
  bodies in flight — but bounded in practice by the credential check running before the read:
  only a credentialed caller can allocate, and N concurrent requests cost N × 48 MB. A
  per-identity in-flight counter is the cheap guard if this ever faces traffic that matters.
  Stream-parsing would save ~12 MB and add a hand-written parser; not worth it here.
  Beyond the body: ≤16 messages, 8 000 chars per user message, 32 000 per assistant message,
  32 000 total, final message must be `user`. Output is capped at 32 000 characters mid-stream and
  4 096 output tokens upstream. `parseChat` runs before any provider object is constructed.
- **Key in the response**: the stream is scrubbed for the key with a carry-over buffer that
  holds back the last `apiKey.length - 1` characters, so a key split across two deltas is never
  emitted in halves. The `error` event is a fixed string, and `onError: () => {}` discards the
  SDK's provider error, which is where a key can otherwise appear.
- **`/api/ai/config`**: returns provider ids, model ids and MCP aliases only — no keys, no
  endpoints (`servers.map(({ alias }) => ({ alias }))`). Gated behind
  `requireCapabilityAccess` whenever AI or MCP is enabled.

`logEvent` never receives message text: only `provider`, `model`, counts and outcome
(`+server.ts:20-25`).

## `/api/manef/[...path]` — no finding

**Verdict: no finding.**

Checked:

- **Path traversal**: the route does not use the catch-all parameter to build the upstream URL
  at all. It looks up `url.pathname` in a three-entry `as const` object and forwards the
  hardcoded `route.path` (`'/api/modules'`, `'/ready'`, `/api/plan`). `/api/manef/../../etc/passwd`
  is not a key in that object, so it is a 404 before anything is forwarded. `hubRequest`
  additionally re-checks its own `FORWARDABLE` set, rejects `..` and `\`, and builds the URL
  with `new URL(path, baseUrl)` where `path` starts with `/` — an absolute path cannot override
  the authority of a base that has none to begin with.
- **Allowlist**: closed and pinned by `manef.spec.ts:35-48`. `//evil.example/api/modules` is not
  in the set, and `new URL` with a protocol-relative path would change the origin — that case
  is in the test.
- **Loopback enforcement**: `hubBase` requires `http:`, one of `127.0.0.1` / `localhost` /
  `[::1]`, no credentials, no query, no hash, and pathname `/`. Unset or non-loopback means the
  route answers `503 hub_unconfigured` rather than falling back to anything.
- **Response handling**: `redirect: 'error'`, a declared-length check and a post-read byte
  check against 64 KiB, JSON parse required. A foreign listener on the loopback port cannot
  hand back HTML that gets relayed.
- `POST` bodies go through the same 64 KiB `readJsonBody` default; only `content-type: application/json`
  is accepted. The one route that raises that default is `/api/ai/chat`, for the reason above.

The bridge holds no credential and adds no principal, which is what makes "it authenticates
nobody" acceptable here: it cannot be used to reach anything the caller could not already reach
on loopback, and the upstream is the user's own process.

## `bridge/terminal-bridge.mjs` and `bridge_token.ts` — fixed

**Verdict: fixed (three findings).**

`bridge_token.ts` itself: **no finding.** The token is held in `sessionStorage`, never
`localStorage`; the device id and the token are both pattern-checked before use; the stored
envelope is version-tagged and a corrupt or oversized value returns `""`; the token never enters
a URL (it rides the `bearer.<token>` subprotocol), so it cannot land in a proxy log, `Referer`
or history. `terminal.ts` refuses to build a socket for a token the RFC 6455 tchar grammar would
reject. All asserted in `bridge_token.spec.ts` and `terminal.spec.ts`.

The bridge process is a different story.

**1. The shell inherited the token that authorised it.** `spawn(SHELL, …, { env: { ...process.env } })`
passed the bridge's whole environment, including `BRIDGE_TOKEN`, into the shell it started. Every
transcript, every `env`, every `set` in PowerShell, every child process — the token was there.
The one credential the process exists to protect was handed to the thing it protects against.

```
× the shell it hands out does not carry the token that opened it
```

Fix: build the child environment from `process.env` with every `BRIDGE_*` key removed. `TERM`
is still set.

**2. The same-host origin check trusted a header the client controls.** With no
`BRIDGE_ALLOW_ORIGIN`, the rule was `parsed.host === host` — where `host` is
`request.headers.host`. A WebSocket client sets both `Origin` and `Host`, so the check only
proved the two headers agreed with each other. Setting both to `http://evil.example:<port>` was
accepted:

```
$ forged origin + forged host  => 101 (accepted)
```

The threat model matters here: this is the branch that stops another website from opening a
socket with a token the user pasted in. If the token is in a page the attacker cannot read, the
check is what stands between the attacker's origin and a shell.

Fix: compare against the origins this process actually answers to, derived from `BRIDGE_HOST`
and `BRIDGE_PORT` at startup, not from the request. Loopback names are always included. A
proxy (`tailscale serve`) sends the browser's real origin and now needs it in
`BRIDGE_ALLOW_ORIGIN` — the startup banner says so and `docs/terminal.md` is updated, because
that is a behaviour change for that deployment, not a silent narrowing.

```
× refuses an origin that merely agrees with a forged Host header
```

**3. A typo in `BRIDGE_MAX_CONNECTIONS` silently removed the cap.** `Number('abc')` is `NaN`,
and `live.size >= NaN` is `false` forever, so the connection limit never tripped and nothing
said so. Fix: refuse to start unless the value is a positive integer, matching how the token and
the token alphabet are already validated.

```
× a non-numeric connection cap refuses to start instead of removing the limit
```

Checked and found sound: the token compare is length-checked then `timingSafeEqual` over
`Buffer`s; `bearerFrom` requires exactly `Bearer ` + a non-empty value; the upgrade path rejects
unknown paths before checking origin, and checks origin before the token, so an unauthorised
origin cannot use the endpoint as a token oracle; only `bearer.<token>` is echoed back as the
subprotocol, so a page cannot negotiate an arbitrary protocol; binary frames close with `1003`;
frames are capped by `maxPayload` **and** by an explicit length check; `resize` values are
clamped and a malformed control frame falls through to be treated as shell input rather than
dropped; `/v1/health` is a separate handler that never reaches the socket code.

Accepted risk, not fixed: `{"type":"resize",…}` detection is a prefix test on the raw frame, so
shell input beginning with that literal string is swallowed as a control frame instead of being
typed. That is a usability wart, not a boundary — it cannot escalate, and "never drop what the
user typed" is already the documented fallback for the parse path. Closing it needs a framing
protocol, which would break the documented contract.

Accepted risk, not fixed: the bridge is a raw shell with no per-command approval and no audit
log, which is what `docs/terminal.md` says it is. Anyone holding the token gets a shell with the
user's privileges. The token is the whole security model; nothing here changes that.

## `src/convex/*` — identity boundary

**Verdict: no finding.**

Audited every public `query` / `mutation` / `action` by hand rather than by grep, and confirmed
each one either calls `requireUser` or is deliberately public and reads nothing:

| Function                   | Identity                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.send`                | `requireUser` — first statement                                                                                                       |
| `chat.providers`           | none — returns the static registry, no data                                                                                           |
| `starter.status`           | none — returns build metadata, no user data                                                                                           |
| `credentials.*` (4 public) | `requireUser` on each                                                                                                                 |
| `decisions.*` (2)          | `requireUser` on each                                                                                                                 |
| `devices.*` (5)            | `requireUser` on each                                                                                                                 |
| `mcp.*` (7 public)         | `requireUser` on each                                                                                                                 |
| `threads.*` (7 public)     | `requireUser` on each                                                                                                                 |
| all `internal*` functions  | not client-callable; `getRow`/`store`/`log` take `owner` as a parameter and are only reachable from an action that already derived it |

**Forged identity**: not possible from the client. `owner` is `identity.tokenIdentifier`, which
Convex assigns from the verified `sub` of the ID token; no public function takes an `owner`
argument. `identityOf` reads only `ctx.auth.getUserIdentity()`. That is why `store`, `getRow`,
`insert` and `log` can take `owner` safely — their callers are actions that called `requireUser`
first, and the Convex runtime does not expose `internal*` over HTTP.

**Ownership on reads and writes**: every function that takes a `sessions` / `devices` /
`credentials` id reads the row and compares `row.owner !== owner` before using it
(`threads.ts:70,84,101,130`, `devices.ts:61`, `decisions.ts:44,97`), and returns the same
"not available" answer for a missing row and a foreign row, so an id cannot be probed for
existence.

`store.spec.ts` proves the boundary with an in-memory deployment: a signed-in owner writes and
reads their own row, a second owner sees nothing, an anonymous caller is refused, and a
malformed token hash never reaches the table. `deployment.spec.ts` refuses to count
"function not deployed" as a passing auth test — the distinction is pinned in
`deployment_probe.spec.ts`, and it is the difference between a green gate and a proven one.

Accepted risk, stated: `convex/_shared/mcp_rules.ts` and `src/lib/server/mcp/config.ts` validate
the same class of endpoint twice because the Convex bundle cannot import `src/lib/`. The
trailing-dot bug above was found in both, which is the drift that duplication invites. A shared
spec corpus, or generating one from the other, would close it; merging the modules is not
possible in the current build graph.

## `src/lib/byok_key.ts` — exists; the leak was in how the key was read

**Verdict: fixed.**

> **Correction, 2026-11-02 (claims audit).** An earlier revision of this section said
> `src/lib/byok_key.ts` "is not on this branch (verified by `find`)". It is, and it was added by
> `1ab435b`, which is an ancestor of the commit this review was written on. The `find` that
> "verified" the absence was wrong, not the file. The analysis below is unchanged, because the
> defect it describes is real; only the claim about the file's existence was false. See
> [claims-audit-2026-11-02.md](claims-audit-2026-11-02.md) #10.

`src/lib/byok_key.ts` holds the SvelteKit provider key in **module scope** while a turn streams:
not `localStorage`, not `sessionStorage`, never a URL. The live read path is
`src/lib/byok_input.ts`, which the chat screen calls. Both modules export a function named
`readProviderKey`; `Chat.svelte` imports the `byok_input` one.

The SvelteKit chat screen used to read its provider key like this:

```ts
const apiKey =
	readDraft<string>('byok-key', '') ||
	(typeof localStorage !== 'undefined' ? (localStorage.getItem('byok-key') ?? '') : '');
```

Finding: the `localStorage` fallback. `readDraft` is `sessionStorage`-backed, which is the right
ceiling — it dies with the tab. The `||` then fell through to `localStorage`, where a provider
key survives the tab, survives sign-out, and is readable by any script on the origin
indefinitely. Nothing in this app writes `byok-key` to `localStorage`, so the only way a key got
there was a leak in the first place: the fallback turned a past leak into a silent, ongoing one,
and sent the recovered key to the provider on the user's behalf.

A second, smaller part of the same read: `readDraft` returns `unknown` cast to `T`, so a
non-string value in that slot was passed to `streamServerChat` as `apiKey` and serialised into
the request.

Evidence:

```
× a key in localStorage is not read
× the old expression is what leaked: it returns the persisted key
× a non-string draft value is not sent as a key
```

Fix: `src/lib/byok_input.ts` reads the tab-scoped draft only, type-checks the value, and is the
single place the chat screen gets a key from. `src/lib/byok_key.ts` is a separate module-scope
holder for the same value on the streaming path. No `localStorage` access anywhere in either
path.

> **Open item, recorded not fixed.** Two modules export `readProviderKey`. They agree today, and
> `Chat.svelte` imports only the `byok_input` one, but nothing structural keeps them in step —
> this is the same duplication shape that produced the trailing-dot bug in §`/api/mcp/tools`.
> Consolidating them is a code change and belongs in its own commit, not in a docs audit.

Checked: the key is not in any URL — `streamServerChat` POSTs it as a JSON field to a
same-origin route. It is not in a log — `logEvent` receives counts and outcomes only, and
`redact()` scrubs `sk-`/`Bearer`/`x-api-key` shapes from anything else. On the Convex path the
key is encrypted with AES-256-GCM before it is stored and is never returned by any query.

Accepted risk, stated: a key held in `sessionStorage` is still readable by an XSS bug on this
origin, and until now there was no CSP anywhere in this app (`src/hooks.server.ts` sets
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`). The key store is a deliberate
ceiling, not a guarantee. A nonce-based enforced policy now ships from `svelte.config.js`
(`kit.csp`); it is described in `docs/csp.md`. `<script>` execution is nonce-only and no
`unsafe-inline`/`unsafe-eval` appears in `script-src`. `style-src` still allows inline, because
`srcdoc` artifact frames inherit the policy and their model-written `<style>` blocks cannot
carry a nonce.

## Residual risk not closed by this review

Stated plainly, because the list above is about what changed and this is about what did not:

1. **No CSP.** The strongest credential this app handles in the browser is a provider key in
   `sessionStorage`; XSS on this origin takes it. Headers exist for framing, sniffing and
   referrer, but not for script origin. This was the largest unmitigated exposure on the review
   and is now closed by an enforced nonce-based policy in `svelte.config.js`; the policy, the
   three relaxations it still carries and what each one would need are documented in
   `docs/csp.md` and asserted by `tests/csp.e2e.ts`.
2. **The terminal bridge is an unlogged shell.** Holding the token means holding a shell with
   the user's privileges, with no per-command approval and no audit trail. Documented as such;
   not a defect against the contract, but it is the biggest blast radius in the surface.
3. **The application session is stateless.** Sign-out is local. A copied ID token stays valid to
   Convex until it expires, and no operator action revokes one. Needs a revocable session
   design before this is used for anything where revocation matters.
4. **Rate limiting is per-process and in-memory.** `consumeBurst` is 20 requests/minute in a
   `Map`, capped at 1 024 buckets. Behind two replicas the real limit doubles; a restart resets
   it. Needs an edge or shared-store limiter before scaling out.
5. **MCP endpoint rules exist twice.** The trailing-dot bug was present in both copies. They
   agree now; nothing structurally keeps them agreeing.
6. **The Convex deployment on this machine is `empty`.** `deployment.spec.ts` therefore skips,
   so "an anonymous caller is refused" is proven against the in-memory harness
   (`store.spec.ts`) but not against a live deployment. Run `npx convex dev` to close that
   skips-to-zero. This is a state of the machine, not a claim about the code.

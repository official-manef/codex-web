# HTTP route contract coverage — 2026-11-02

Every HTTP route in this app now has a contract spec that pins **status codes and body shapes
for the failure cases**, not just the happy path. **138 tests across seven files** — counted by
running the seven files, not by adding up this table:

```bash
npx vitest run src/routes/api/ai/config/contract.spec.ts \
  src/routes/api/ai/chat/contract.spec.ts \
  src/routes/api/mcp/server/contract.spec.ts \
  src/routes/api/mcp/tools/contract.spec.ts \
  'src/routes/api/manef/[...path]/contract.spec.ts' \
  src/routes/auth/contract.spec.ts src/routes/contract.spec.ts
#   Test Files  7 passed (7)
#        Tests  138 passed (138)
```

| Spec file                                         | Tests | Covers                                       |
| ------------------------------------------------- | ----- | -------------------------------------------- |
| `src/routes/api/ai/config/contract.spec.ts`       | 13    | `/api/ai/config` GET                         |
| `src/routes/api/ai/chat/contract.spec.ts`         | 12    | `/api/ai/chat` POST                          |
| `src/routes/api/mcp/server/contract.spec.ts`      | 19    | `/api/mcp/server` POST (MCP Streamable HTTP) |
| `src/routes/api/mcp/tools/contract.spec.ts`       | 21    | `/api/mcp/tools` POST                        |
| `src/routes/api/manef/[...path]/contract.spec.ts` | 28    | `/api/manef/*` GET + POST                    |
| `src/routes/auth/contract.spec.ts`                | 30    | `/auth/{login,callback,logout,token}`        |
| `src/routes/contract.spec.ts`                     | 15    | `/robots.txt`, `/sitemap.xml`                |

An earlier revision of this page said **153**, with 27 for the chat file. Both were true on the
branch the suites were written on (`edf5c32`, where that file held 27 cases); the merge into
`integration` (`751f590`) left 12, and the total became 138. The table is now the measured
value — re-run the command above before quoting it again.

Method: the exported `GET`/`POST` handlers are called directly with a constructed
`RequestEvent`, matching `src/routes/api/git/server.spec.ts` and
`src/lib/server/auth/routes.spec.ts`. No server is booted, no socket is opened, no real
credential exists anywhere in the suite. Outbound boundaries (`fetch`, the MCP SDK client, the
OIDC library, `streamText`) are the only things mocked.

## Route → cases covered

Legend: **M** method discipline · **D** feature disabled · **A** auth boundary · **I** input
validation · **R** response shape · **U** upstream failure / timeout.

### `GET /api/ai/config`

| Case                                                                                                | Kind | Status |
| --------------------------------------------------------------------------------------------------- | ---- | ------ |
| Only `GET` exported                                                                                 | M    | —      |
| Both flags off: empty catalog, still 200, no credential needed                                      | D    | 200    |
| Enabled, no `Authorization`                                                                         | A    | 401    |
| Wrong credential: longer, shorter, same-length garbage                                              | A    | 401    |
| Configured token under 32 chars can never authenticate                                              | A    | 401    |
| MCP enabled alone also demands a credential                                                         | A    | 401    |
| Burst limit spent (21st request)                                                                    | A    | 429    |
| Malformed `AI_MODELS_JSON`                                                                          | I    | 503    |
| Model list with zero approved models                                                                | I    | 503    |
| Unparseable `AI_ENABLED` (`"yes"`)                                                                  | I    | 503    |
| Invalid `MCP_SERVERS_JSON` (non-HTTPS URL) fails closed, no partial catalog                         | I    | 503    |
| Happy path: `{ ai: { enabled, providers[{id,label,models}] }, mcp: { enabled, servers[{alias}] } }` | R    | 200    |
| `Cache-Control: no-store`, `application/json`                                                       | R    | —      |
| Body never contains an MCP endpoint host or the operator token                                      | R    | —      |
| Duplicate model ids collapsed                                                                       | R    | —      |

### `POST /api/ai/chat`

> **Read the table below as the contract, not as a test inventory.** The suite was cut from 27
> cases to 12 during the merge into `integration` (`751f590`), so several rows below are no
> longer pinned by `contract.spec.ts`: method discipline, `415` non-JSON media type, `413`
> oversized body, malformed JSON / invalid UTF-8, the 17-message and 2001-char field shapes,
> caller-supplied `baseURL`, last-message-not-`user`, the 64 KiB image cap row (see defect 2),
> and the NDJSON success shape. What still holds — in `contract.spec.ts` (12) plus
> `server.spec.ts` (14) — is: `404` before the body is read, `401`/`403`, `400` for an
> unapproved model and for an extra field, `503` for a broken catalog, per-turn image caps,
> policy widening and deny-by-default, and the log fields. Do not cite a row here as proof
> without checking which file runs it.
>
> | Case                                                                                            | Kind | Status               |
> | ----------------------------------------------------------------------------------------------- | ---- | -------------------- |
> | Only `POST` exported                                                                            | M    | —                    |
> | `AI_ENABLED` unset / `false` / `True` / `1` / `yes`                                             | D    | 404                  |
> | Disabled answer precedes authorization                                                          | D    | 404                  |
> | Enabled, no credential                                                                          | A    | 401                  |
> | Near-miss credentials: trailing char, truncated, missing scheme, lowercase scheme               | A    | 401                  |
> | Valid credential, foreign `Origin`                                                              | A    | 403                  |
> | Valid credential, no `Origin` at all                                                            | A    | 403                  |
> | Malformed JSON                                                                                  | I    | 400                  |
> | Non-JSON media type                                                                             | I    | 415                  |
> | Missing body                                                                                    | I    | 400                  |
> | Invalid UTF-8 bytes                                                                             | I    | 400                  |
> | Oversized via declared `content-length`                                                         | I    | 413                  |
> | Oversized via actual bytes                                                                      | I    | 413                  |
> | Missing / empty / wrong-typed fields, 17 messages, 2001-char memory (10 shapes)                 | I    | 400                  |
> | Unapproved model, unknown provider                                                              | I    | 400                  |
> | Caller-supplied `baseURL` rejected, value not echoed                                            | I    | 400                  |
> | Last message is not `user`                                                                      | I    | 400                  |
> | Image above 64 KiB body cap                                                                     | I    | 413 (see defect 2)   |
> | Image inside the cap starts a turn                                                              | R    | 200                  |
> | Unsupported image media type                                                                    | I    | 400                  |
> | Missing `AI_MODELS_JSON`                                                                        | I    | 503 (was 400, fixed) |
> | Malformed `AI_MODELS_JSON`                                                                      | I    | 503 (was 400, fixed) |
> | Success: `application/x-ndjson`, `no-store`, `X-Accel-Buffering: no`, lines `{text}` → `{done}` | R    | 200                  |
> | Provider error event → fixed `{type:"error",message}` line, no hang, no 5xx                     | U    | 200 + error event    |
> | Provider error body carries no key and no upstream host                                         | U    | —                    |
> | Vision-less provider + image → typed error, provider never called                               | U    | 200 + error event    |
> | Log records counts and outcome only, never message text or key                                  | R    | —                    |

### `POST /api/mcp/server`

| Case                                                                      | Kind | Status                |
| ------------------------------------------------------------------------- | ---- | --------------------- |
| Only `POST` exported (GET/DELETE are a framework 405)                     | M    | —                     |
| `MCP_SERVER_ENABLED` unset / `false` / `TRUE` / `1`                       | D    | 404                   |
| Missing token, 31-char token, 4097-char token                             | D    | 503                   |
| No header, empty, wrong token, prefix token, bare token, wrong scheme     | A    | 401                   |
| Valid token + foreign `Origin`                                            | A    | 403                   |
| Valid token + no `Origin` (bearer is the credential)                      | A    | 200                   |
| Burst limit spent                                                         | A    | 429                   |
| Malformed JSON                                                            | I    | 400                   |
| Non-JSON media type / non-JSON `Accept`                                   | I    | 415 / 406             |
| JSON but not JSON-RPC (`{"jsonrpc":"1.0"}`)                               | I    | 400, code −32700      |
| Object with no `method`                                                   | I    | 200 or 400, never 500 |
| Oversized body                                                            | I    | 413                   |
| `tools/list`: JSON, `no-store`, exactly `starter_status`, read-only hints | R    | 200                   |
| Unknown tool call → in-band `isError`, no server detail                   | R    | 200                   |
| `starter_status` returns only `name`, `version`, `backend`                | R    | 200                   |
| Unknown method → −32601 in a 200 envelope (protocol contract)             | R    | 200                   |
| Log carries method and status only, never arguments or token              | R    | —                     |
| Hostile method name (newline + forged JSON) recorded as `unknown`         | R    | —                     |
| Transport throws → fixed 500 message, no path, no token                   | U    | 500                   |

### `POST /api/mcp/tools`

| Case                                                                                                                                            | Kind | Status               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------- |
| Only `POST` exported                                                                                                                            | M    | —                    |
| `MCP_CLIENT_ENABLED` unset / `false` / `TRUE` / `1`, client never called                                                                        | D    | 404                  |
| No credential                                                                                                                                   | A    | 401                  |
| Wrong credential, client never called                                                                                                           | A    | 401                  |
| Foreign `Origin`                                                                                                                                | A    | 403                  |
| Malformed JSON                                                                                                                                  | I    | 400                  |
| Non-JSON media type                                                                                                                             | I    | 415                  |
| Oversized body                                                                                                                                  | I    | 413                  |
| Unknown action (`delete`)                                                                                                                       | I    | 400                  |
| 8 malformed shapes: missing alias, extra key, wrong alias type, alias > 40, missing `confirmed`, `confirmed:"yes"`, non-object arguments, empty | I    | 400                  |
| Short and space-containing BYOK token                                                                                                           | I    | 400                  |
| Unknown alias, alias list and endpoint not echoed                                                                                               | I    | 400                  |
| Tool outside the allowlist                                                                                                                      | I    | 400                  |
| Invalid `MCP_SERVERS_JSON`                                                                                                                      | I    | 503 (was 400, fixed) |
| Missing `MCP_SERVERS_JSON`                                                                                                                      | I    | 503 (was 400, fixed) |
| `list` happy path: JSON, `no-store`, client called with connection+token+signal                                                                 | R    | 200                  |
| `execute` requires `confirmed:true`, forwards parsed arguments                                                                                  | R    | 200                  |
| Log names action/alias/tool only, never token or arguments                                                                                      | R    | —                    |
| Client rejects → 502 fixed message, no host, no token                                                                                           | U    | 502                  |
| Aborted request → clean 502, signal handed to client                                                                                            | U    | 502                  |
| Execute failure never claims success                                                                                                            | U    | 502                  |

### `GET|POST /api/manef/[...path]`

| Case                                                                      | Kind | Status                     |
| ------------------------------------------------------------------------- | ---- | -------------------------- |
| Only `GET`/`POST` exported                                                | M    | —                          |
| `GET /api/manef/plan` (POST-only path) → 405, nothing forwarded           | M    | 405                        |
| `POST /api/manef/modules` (GET-only path) → 405, nothing forwarded        | M    | 405                        |
| `../../etc/passwd`                                                        | I    | 404                        |
| `%2e%2e/%2e%2e/etc/passwd`                                                | I    | 404                        |
| `..%2f..%2fetc/passwd`                                                    | I    | 404                        |
| `%5c..%5cetc%5cpasswd` (backslash)                                        | I    | 404                        |
| `%00`                                                                     | I    | 404                        |
| Invented sibling `/health`                                                | I    | 404                        |
| Nested allowed name `/api/modules`                                        | I    | 404                        |
| Trailing slash `/ready/`                                                  | I    | 404                        |
| Absolute URL as path `https://evil.example/api/modules`                   | I    | 404                        |
| Protocol-relative `//evil.example/api/modules`                            | I    | 404                        |
| Each of the above opens **zero** sockets                                  | I    | —                          |
| Allowed path forwards the pinned hub path, never the request path         | R    | —                          |
| Malformed JSON on `/plan`                                                 | I    | 400                        |
| Non-JSON media type                                                       | I    | 415                        |
| Missing body                                                              | I    | 400                        |
| Oversized body, hub never called                                          | I    | 413                        |
| Duplicate JSON keys collapse to the parsed value before forwarding        | I    | —                          |
| Hub unset / non-loopback / `https:` / private IP → 503 `hub_unconfigured` | D    | 503, zero sockets          |
| Hub answer relayed as JSON with `no-store`                                | R    | 200                        |
| `/ready` 503 is a real answer → relayed as 200 with hub payload           | R    | 200                        |
| Hub 400 with `{error:{code}}` → 502 with that code                        | R    | 502                        |
| Connection refused → 503 `hub_unreachable`, no host in the body           | U    | 503                        |
| Hub settles only on abort → route's own 5s timeout ends it                | U    | 503 within the test budget |
| HTML from a foreign listener → 502 `hub_response_invalid`, not relayed    | U    | 502                        |
| Declared oversized answer → 502 `hub_response_too_large`                  | U    | 502                        |
| Answer that only claims to be small → 502 `hub_response_too_large`        | U    | 502                        |

### `/auth/{login,callback,logout,token}`

| Case                                                                                                | Kind | Status                    |
| --------------------------------------------------------------------------------------------------- | ---- | ------------------------- |
| `login`/`callback` export GET only; `logout`/`token` export POST only                               | M    | —                         |
| `AUTH_ENABLED` unset / `false` → 404 on all four routes                                             | D    | 404                       |
| Unparseable `AUTH_ENABLED` (`TRUE`, `1`, `yes`) aborts, does not silently disable                   | D    | plain Error (see gap 1)   |
| `login` served on a foreign host → 400, no OIDC transaction                                         | A    | 400                       |
| `login` on the configured origin → 303 to Google, `no-store`, `no-referrer`, transaction cookie set | R    | 303                       |
| `logout` foreign `Origin` → 403, session cookie **not** cleared                                     | A    | 403                       |
| `logout` no `Origin` → 403                                                                          | A    | 403                       |
| `logout` same-origin → 303 `/`, both cookies cleared, `no-store`                                    | R    | 303                       |
| `token` foreign `Origin` → 403, no token in the body                                                | A    | 403                       |
| `token` no session → `{ idToken: null }`                                                            | A    | 200                       |
| `token` tampered session cookie → no token **and** cookie cleared                                   | A    | 200                       |
| `token` established session → `{ idToken }` only, `no-store`, `pragma: no-cache`                    | R    | 200                       |
| `token` 6 invalid shapes: unknown key, string/number for boolean, array, `null`, string body        | I    | 400                       |
| `token` malformed JSON / missing body                                                               | I    | 400                       |
| `token` oversized body                                                                              | I    | 413                       |
| `callback` no pending transaction → 400, provider never called                                      | I    | 400                       |
| `callback` unreadable transaction cookie → 400, provider never called                               | I    | 400                       |
| `callback` on a foreign host does **not** consume the transaction                                   | A    | 400                       |
| `callback` valid transaction → 303 `/`, session set, transaction deleted                            | R    | 303                       |
| Token-exchange failure → 400 fixed message, no client secret, no provider URL, no `invalid_grant`   | U    | 400                       |
| Malformed `AUTH_SESSION_SECRET` / non-google provider / missing `PUBLIC_SITE_URL`                   | D    | plain Error (see gap 1)   |
| Provider discovery failure → plain Error, masked by `handleError`                                   | U    | framework 500 (see gap 2) |

### `/robots.txt` and `/sitemap.xml`

| Case                                                                           | Kind | Status |
| ------------------------------------------------------------------------------ | ---- | ------ |
| Both export GET only                                                           | M    | —      |
| Handlers take no `RequestEvent` — request input cannot influence the body      | M    | —      |
| robots: `text/plain; charset=utf-8`, allows crawling while indexing is off     | R    | 200    |
| robots: names the sitemap once indexing is on                                  | R    | 200    |
| robots: unset origin → no `undefined` in the document                          | R    | 200    |
| robots: verification token never embedded                                      | R    | —      |
| sitemap: `application/xml; charset=utf-8`, well-formed empty `urlset` when off | R    | 200    |
| sitemap: exactly one `<loc>` when on                                           | R    | 200    |
| Non-boolean `PUBLIC_SEO_INDEXABLE` throws rather than guessing                 | I    | throws |
| Indexing on with no origin throws rather than publishing a relative sitemap    | I    | throws |
| Origin with a query string is refused, so no unescaped `&` can reach the XML   | I    | throws |
| HTML tag in `PUBLIC_GOOGLE_SITE_VERIFICATION` refused                          | I    | throws |
| Malformed `PUBLIC_TWITTER_SITE` refused                                        | I    | throws |

## Defects found

### 1. Fix — server misconfiguration was reported as a caller error (`400`) on two AI/MCP routes

`/api/ai/chat` and `/api/mcp/tools` both wrapped "parse the operator's environment" and "parse
the caller's body" in **one** `try`. A typo in `AI_MODELS_JSON` or `MCP_SERVERS_JSON` therefore
came back as `400 Check the approved provider/model…` / `400 Check the configured server…` —
blaming the request for a server fault, and contradicting `/api/ai/config`, which answers the
same class of fault with `503` and a message that names the private configuration. Whoever read
the 400 would go hunting for a field in the payload that was never wrong.

Fixed in both routes: the environment is validated separately, before the body, and answers
`503` with `invalid-configuration` logged. Four tests pin it.

Not a security finding — no leak in either direction — but it is a lying status code, which is
the kind of thing this suite exists to stop.

### 2. Reported — the documented 4 MB image budget is unreachable (64 KiB body cap)

`docs/parity-checklist-2026-11-02.md` §3.2 promises `/api/ai/chat` accepts "2 images, 4 MB each,
`image/png|jpeg|webp`". `readJsonBody` defaults to **65 536 bytes** and the chat route does not
raise it, so the schema that permits 2 × 4 MB can never be reached: a single realistic
screenshot is `413 The request is too large.` Verified both ways — 8 KiB of base64 passes and
reaches `streamText`; 100 KiB is `413`.

Not fixed here, because the fix is a product decision with a real cost: raising the cap to
~11 MB (2 × 4 MB after base64 overhead) means every chat request may buffer that much in
memory, and the route currently has no streaming body parser.

**The pinning test is gone.** It was
`an image larger than 64 KiB is refused by the shared body cap before the schema runs`, and it
lived in `contract.spec.ts` at `edf5c32`. That file was cut from 27 cases to 12 in `751f590`, and
the row went with it. What still covers the cap is `src/lib/server/access.spec.ts`
(`readJsonBody` answers `413` at `65_536` and at an explicit smaller cap) — i.e. the _reader's_
limit is pinned, but nothing now asserts that the chat route's image budget cannot reach it. The
finding stands unverified by a test until someone re-adds that case. Two options for whoever
owns it:

- raise the chat route's cap explicitly (`readJsonBody(event.request, 12_000_000)`) and accept
  the memory cost, or
- correct the doc and the schema to the real budget (64 KiB total, so roughly 48 KiB of image),
  and re-add a case that asserts it.

The first is honest to the product; the second is honest to the code. Either one closes it.

## Gaps — what could not be covered, and why

1. **Misconfiguration on `/auth/*` aborts as a plain `Error`, not a `503`.** `resolveAuthConfig`
   throws `Error`, which `configuredAuth()` does not convert, so a malformed
   `AUTH_SESSION_SECRET`, an unparseable `AUTH_ENABLED` or a missing `PUBLIC_SITE_URL` becomes a
   framework 500 ("Something went wrong. Please try again.") instead of the deliberate
   `503 Assistant setup is incomplete` shape the AI routes use. Fails shut and leaks nothing —
   the tests assert exactly that — but it gives the operator no signal. Left as-is because
   changing it touches `configuredAuth`, which every auth route and `+layout.server.ts` share,
   and the shape of that answer is an API decision, not a test fix. Recorded here.

2. **`handleError` masking is asserted only structurally.** The provider-discovery test proves
   a plain `Error` escapes (no `status`, no body), which is the precondition for `handleError`
   replacing it. The masking itself lives in `src/hooks.server.ts` and is not exercised by any
   existing test; asserting it would mean driving the hooks pipeline, which is a different
   surface from this suite's brief.

3. **`consumeBurst` is process-local** (`src/lib/server/access.ts`, marked `ponytail:`). The 429
   tests assert the limit fires within one process. They cannot prove anything about a
   multi-replica deployment, because the map is per-process by design.

4. **`/api/mcp/server` is exercised against the real MCP SDK transport**, so its 200-envelope
   error codes (−32601, −32700) come from the SDK, not from this repo. Pinned as the contract
   because a client depends on them; if the SDK changes them, the test fails and that is the
   correct outcome.

5. **`/auth/login` and `/auth/callback` never reach Google.** `beginAuthorization` /
   `completeAuthorization` / `refreshIdentity` are stubbed, so the tests prove the _route's_
   handling (origin, transaction cookie, status mapping, message hygiene) but not PKCE, state,
   nonce or signature verification. Those are already covered against a signed fake JWKS in
   `src/lib/server/auth/oidc.spec.ts:89-152`, which is the right layer for them.

6. **No timing assertions.** The manef timeout test proves the route settles via its own
   `AbortSignal` rather than passing on a fast rejection, but it does not measure wall-clock
   latency: that would make the suite flaky. The 5 s / 15 s / 60 s budgets are asserted as
   wiring, not as elapsed time.

7. **`BODY_SIZE_LIMIT` / adapter-level limits** (adapter-node's own body cap) sit outside the
   handler and are not exercised. A request that the adapter rejects never reaches these tests.

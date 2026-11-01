# Environment reference

A clean clone runs without credentials. Copy `.env.example` to `.env.local` only when
configuring a capability. Frontend hosting, Convex deployments and infrastructure tools
have separate environments. No secret belongs in a `PUBLIC_` variable or loader result.

## Public settings

| Setting                           | Default | Actual consumer                                                                                                                                                                  |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_CONVEX_URL`               | Empty   | Root layout connects the browser to the selected Convex deployment.                                                                                                              |
| `PUBLIC_SITE_URL`                 | Empty   | Canonical/social URLs, auth redirect and API origin checks. HTTPS origin, no path; HTTP loopback allowed locally. Required for auth/AI/MCP client.                               |
| `PUBLIC_SEO_INDEXABLE`            | `false` | Metadata and crawler endpoints; true requires an origin. Demo app routes remain noindex.                                                                                         |
| `PUBLIC_SURFACE`                  | Empty   | `src/lib/config/surface.ts` via `$lib/feature_settings.svelte.ts`: pins the surface to `local` or `cloud` instead of inferring it from the page URL. Any other value is ignored. |
| `PUBLIC_GOOGLE_SITE_VERIFICATION` | Empty   | Google verification meta content only.                                                                                                                                           |
| `PUBLIC_BING_SITE_VERIFICATION`   | Empty   | Bing verification meta content only.                                                                                                                                             |
| `PUBLIC_TWITTER_SITE`             | Empty   | Optional `@handle` in Twitter/X metadata.                                                                                                                                        |

The surface decides which tools start enabled. On `cloud`, tools that need the runtime on
the user's own machine (`src/lib/feature_access.ts`, requirement `local-runtime`) start
unchecked and stay available behind Settings → Tools. Leave `PUBLIC_SURFACE` empty unless a
deployment is served from a host the inference cannot classify, such as a reverse proxy on
an internal name. It is presentation only: it never grants or removes authority, and no
server handler reads it.

`src/lib/config/metadata.ts` validates public settings. Preview environments stay noindex.
Google/Bing tokens are verification content, not API credentials. See
[Google verification](https://support.google.com/webmasters/answer/9008080) and
[robots metadata](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).

## Auth: implemented, off by default

`src/lib/server/auth/config.ts` validates these settings on the SvelteKit server.
Follow [auth.md](auth.md) for the matching Convex issuer/audience setup and test boundaries.

| Setting               | Default  | Actual consumer                                                                               |
| --------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `AUTH_ENABLED`        | `false`  | Enables Google login routes and safe session data.                                            |
| `AUTH_PROVIDER`       | `google` | Only Google OIDC is implemented; unknown providers fail.                                      |
| `AUTH_CLIENT_ID`      | Empty    | Google web client ID; must match the Convex application's audience.                           |
| `AUTH_CLIENT_SECRET`  | Empty    | Private confidential-client credential for code exchange.                                     |
| `AUTH_SESSION_SECRET` | Empty    | 32 random bytes encoded as base64url; encrypts bounded HTTP-only session/transaction cookies. |

Google issuer is fixed by the implemented provider. Legacy recipe placeholders
`AUTH_ISSUER_URL` and `AUTH_AUDIENCE` are removed; arbitrary issuers are not supported
by changing an environment string. Migrate subjects and sessions when changing providers.

Also absent from `.env.example` on purpose, because they are host/adapter settings rather than app
settings: `DEPLOY_TARGET` (build target), `ORIGIN`, `HOST`, `PORT` (Node adapter runtime),
`LOG_LEVEL`/`LOG_FILE` (optional activity log), and `GOOGLE_APPLICATION_CREDENTIALS` (commented out
as recipe-only). Every one is documented in its own section below.

## AI and MCP: implemented, off by default

The SvelteKit server validates selection in `src/lib/server/ai/config.ts` and
`src/lib/server/mcp/config.ts`. [AI/MCP setup](ai-mcp.md) documents limits and Composio.

| Setting                   | Default | Actual consumer                                                                                                                |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `AI_ENABLED`              | `false` | Enables bounded BYOK chat streaming.                                                                                           |
| `AI_MODELS_JSON`          | Empty   | Approved model IDs grouped by `openai`, `anthropic`, `google`, `nine-router`; no automatically selected model.                 |
| `CAPABILITY_ACCESS_TOKEN` | Empty   | Optional private operator bearer credential, at least 32 characters. Google sessions are the normal per-user alternative.      |
| `MCP_CLIENT_ENABLED`      | `false` | Enables discovery and manually confirmed calls to configured remote servers.                                                   |
| `MCP_SERVERS_JSON`        | Empty   | Private aliases, fixed public HTTPS URLs, `bearer`/`x-api-key`, exact tool allowlists. Never put credentials in endpoint URLs. |
| `MCP_SERVER_ENABLED`      | `false` | Enables the read-only `/api/mcp/server` endpoint.                                                                              |
| `MCP_SERVER_TOKEN`        | Empty   | Separate private bearer credential for the MCP server, at least 32 characters.                                                 |
| `LOG_LEVEL`               | Unset   | `src/lib/server/log.ts`; `debug`/`info`/`warn`/`error` enable the local activity log, unset or any other value writes nothing. |
| `LOG_FILE`                | Unset   | `src/lib/server/log.ts`; NDJSON destination. Unset writes `./.local-logs/activity.jsonl` (git-ignored).                        |
| `GIT_SURFACE_ENABLED`     | `false` | Enables the read-only `/api/git` route: one repository's status and recent commits.                                            |
| `GIT_SURFACE_ROOTS`       | Empty   | `:`-separated absolute paths the git route may read. Cap 8, `..` refused, no other subcommand is reachable.                    |
| `GIT_POLICY_JSON`         | Empty   | Per-verb decision for `git_diff`/`git_stage`/`git_commit`/`git_worktree`. Empty or malformed denies every write.               |
| `AI_TOOLS_ENABLED`        | `false` | Lets a BYOK turn use the tool loop at all. The request must also ask, and the policy must allow the verb.                      |
| `AI_POLICY_JSON`          | Empty   | Per-verb decision for `read_file`/`write_file`/`apply_patch`/`exec`/`mcp_app`. Empty or malformed denies every verb.           |

Provider keys and remote MCP credentials come from the current request and stay in memory;
they are not stored in Convex, browser storage or server fallback environment variables.
The application relays them to the selected provider, so use a trusted HTTPS deployment.
Do not enable request-body logging for these routes. Instance-local burst counters protect
small deployments; use an edge/distributed limiter before scaling replicas.

### Local activity log

`src/lib/server/log.ts` writes NDJSON records only when an operator sets `LOG_LEVEL` to
`debug`, `info`, `warn` or `error`. Unset is the default and produces no output and no file,
in every environment including production. `LOG_FILE` overrides the destination; the default
`./.local-logs/activity.jsonl` is git-ignored and its directory is created lazily.

| Surface           | Event           | Captured                                                        |
| ----------------- | --------------- | --------------------------------------------------------------- |
| `/api/ai/config`  | `ai.config`     | provider count, approved model count, MCP flag and server count |
| `/api/ai/chat`    | `ai.chat.start` | provider, model, message count, total message characters        |
|                   | `ai.chat.end`   | provider, model, `ok`/`error`                                   |
| `/api/mcp/tools`  | `mcp.tools`     | action, alias, tool name (execute only), `ok`/`error`           |
| `/api/mcp/server` | `mcp.server`    | JSON-RPC method name, HTTP status, `ok`/`error`                 |
| `/api/git`        | `git`           | root name, file count, commit count, `ok`/`error`               |

Never recorded: request or response bodies, message text, `authorization` and `cookie`
headers, API keys or tokens, and full URLs carrying a query string. Fields are flat
primitives only — an object or array passed to `logEvent` is dropped instead of serialized —
values matching a key shape (`sk-`, `Bearer `, `x-api-key`) are redacted, each record is
capped at 4 KiB, and a failed write is swallowed so logging cannot fail a request. This is a
developer aid, not an audit trail: it is per-process, unprotected and never read by the app.

## MANEF AI hub bridge: optional

`src/lib/server/manef.ts` forwards exactly three paths to a loopback MANEF AI hub and
nothing else. The hub (`manef-ai/apps/hub`) only answers `Host: 127.0.0.1|localhost|[::1]`
and same-origin requests, so a browser on this console's origin cannot reach it directly;
the SvelteKit server makes the call instead. The incoming `Origin` is never forwarded.

| Setting         | Default | Actual consumer                                                                       |
| --------------- | ------- | ------------------------------------------------------------------------------------- |
| `MANEF_HUB_URL` | Empty   | Loopback base URL, `http` only. Unset = the MANEF AI screen says "no hub configured". |

Only `/api/modules`, `/api/plan` and `/ready` are reachable through `/api/manef/*`. The
bridge adds no principal, scope or credential, cannot be widened by a request URL, and
never executes anything: every capability the registry declares is `read` or `none`, and a
plan is a preview. `/ready` answers `503 unconfigured` until a real authorized adapter
exists, and the bridge treats that status as a real answer rather than a failure. Run the
hub with `pnpm run dev` in `manef-ai`; it binds loopback on port 3210.

## Payment and email: transport adapters

`src/lib/server/integrations/config.ts` consumes only the requested capability.
These are callable server transports, not public checkout/email workflows.

| Setting                             | Default   | Actual consumer                                            |
| ----------------------------------- | --------- | ---------------------------------------------------------- |
| `PAYMENTS_ENABLED`                  | `false`   | DOKU transport/signature utility activation.               |
| `PAYMENT_PROVIDER`                  | `doku`    | Only the implemented DOKU adapter is accepted.             |
| `DOKU_ENVIRONMENT`                  | `sandbox` | Fixed sandbox/production provider endpoints.               |
| `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY` | Empty     | Required merchant identity and private signing credential. |
| `EMAIL_ENABLED`                     | `false`   | Resend send transport activation.                          |
| `EMAIL_PROVIDER`                    | `resend`  | Only the implemented Resend adapter is accepted.           |
| `RESEND_API_KEY`, `EMAIL_FROM`      | Empty     | Private send key and verified sender.                      |

Pass the executing runtime's environment explicitly. Convex Node actions cannot import
SvelteKit environment modules. Product order transitions, webhook deduplication, outbox
and real merchant/mail acceptance follow [integrations.md](integrations.md).

## Hosting and optional cloud services

| Setting                                                               | Default             | Actual consumer                                                                                                  |
| --------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_TARGET`                                                       | `vercel` when unset | `svelte.config.js`: `vercel` or `node`; unsupported targets fail at build time. Docker selects Node.             |
| `ORIGIN`                                                              | Unset               | Node adapter runtime trusted application origin; align with `PUBLIC_SITE_URL`.                                   |
| `PORT`, `HOST`                                                        | Adapter defaults    | Node server listen settings; Docker listens on `0.0.0.0:3000`.                                                   |
| `GCP_ENABLED`, `CLOUDFLARE_ENABLED`                                   | `false`             | Resolver guards for unimplemented application service adapters; these flags do not deploy infrastructure.        |
| `GCP_PROJECT_ID`, `GCP_LOCATION`, `GCP_STORAGE_BUCKET`                | Empty               | Recipe-only identifiers for a future selected GCP service.                                                       |
| `GOOGLE_APPLICATION_CREDENTIALS`                                      | Omitted             | Optional local ADC file path used by Google tooling when installed. Cloud Run uses an attached service identity. |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` | Empty               | Recipe-only scoped infrastructure API access; ordinary DNS/proxy use needs no runtime token.                     |

The Node artifact/container is suitable for VPS or Cloud Run; account deployment is
product-specific. Cloudflare DNS/proxy can front it. Workers hosting and R2/Turnstile
bindings require the separate integration described in [deployment.md](deployment.md).
A string placeholder does not provision a resource or bridge runtime boundaries.

## Convex deployment

| Setting             | Runtime                        | Consumer                                                                                                                                                                                                                       |
| ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MODELS_ENC_KEY`    | Convex deployment only         | AES-256-GCM master key for stored provider keys and per-user MCP credentials. `openssl rand -base64 32`. Losing it makes every stored credential unreadable; rotating it is a migration, not a restart. Never in `.env.local`. |
| `CONVEX_DEPLOYMENT` | CLI-managed local `.env.local` | Selects the linked development deployment.                                                                                                                                                                                     |
| `CONVEX_DEPLOY_KEY` | Hosting/CI secret store        | Deployment script/CLI. Scope preview and production keys separately.                                                                                                                                                           |

`MODELS_ENC_KEY` is the one setting in this file that is deliberately absent from `.env.example`'s
active block: it belongs on the Convex deployment (`npx convex env set MODELS_ENC_KEY …`), never in
a frontend env file. The same holds for `LOG_LEVEL` and `LOG_FILE`, which are optional and ship
unset.

Backend settings belong on the corresponding Convex deployment, not only the frontend
host. Never copy another project's deployment identifiers, secrets or private files into
a generated repository. Update the example, this table and the actual validator together.

# Optional integrations

Convex is the default backend. Google auth and owner-scoped private data (memories, projects) plus
BYOK AI/MCP are implemented, optional features: follow [auth.md](auth.md) and
[ai-mcp.md](ai-mcp.md). Node/Vercel hosting
is covered in [deployment.md](deployment.md). DOKU Checkout and Resend remain callable
server transport adapters, tested with mocked HTTP. Product checkout/email workflows
need their own durable state, authorization and actual merchant/mail acceptance.

## Configuration and boundaries

`src/lib/server/integrations/config.ts` resolves payment/email transports and guards optional cloud service recipes. Pass an environment record explicitly. It reads only the requested capability, validates enabled providers, and never accesses the environment at import time. Disabled services need no credentials; calling one throws instead of pretending to succeed. Unknown providers fail closed. A preferred provider is not automatically activated by the presence of a key.

| Capability     | Activation              | Preferred provider / required settings                                                                        |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| Payments       | `PAYMENTS_ENABLED=true` | `PAYMENT_PROVIDER=doku`, `DOKU_ENVIRONMENT=sandbox`, `DOKU_CLIENT_ID`, `DOKU_SECRET_KEY`                      |
| Email          | `EMAIL_ENABLED=true`    | `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`                                                       |
| Authentication | `AUTH_ENABLED=true`     | Google OIDC; use [auth.md](auth.md) for actual settings and Convex audience.                                  |
| GCP            | Off                     | The resolver rejects `GCP_ENABLED=true` until a concrete Google Cloud integration is implemented              |
| Cloudflare     | Off                     | The resolver rejects `CLOUDFLARE_ENABLED=true` until a concrete Cloudflare service integration is implemented |

These flags alone do not activate features. Validation happens when the corresponding resolver or adapter is called. The [environment reference](environment.md) lists every setting, its consumer and whether it is implemented or a recipe. Filling recipe values does not install a provider or make SDK calls.

`DOKU_ENVIRONMENT` accepts only `sandbox` or `production`; default is sandbox. Boolean settings accept `true` or `false`. Keep every key above private: never use a `PUBLIC_` prefix, expose the resolved config in page data, or log credentials/provider response bodies.

In SvelteKit server code, pass `env` from `$env/dynamic/private` to the relevant function. SvelteKit protects the `$lib/server` directory against browser imports. Do not re-export these modules from public feature barrels. To run a transport in a Convex **Node action** (`"use node"`), first move/extract its runtime-neutral implementation into a backend-owned module. The lint boundary forbids Convex imports from `src/lib/server`; pass the deployment environment after extraction and install secrets on that deployment. Convex HTTP actions run in the default runtime: receive the raw body there and call an internal Node action for the Node-crypto signature utility. Never expose that internal bridge as a public signing or sending action.

Call `createCheckout(env, input)` from `payments.ts` or `sendEmail(env, input)` from `email.ts`. These are the service boundaries; there is no generic plugin engine. Both use fixed provider endpoints, reject redirects, abort requests after ten seconds, validate responses, and perform no automatic retries. A timeout can have an unknown external outcome: reconcile before retrying with the same logical attempt/delivery identity.

## DOKU: basic hosted checkout

`createCheckout` accepts a persisted `requestId`, a 1–30 character alphanumeric `invoice`, a positive integer `amount` of at most 12 digits, `currency: 'IDR'`, and a server-selected absolute HTTPS `callbackUrl`. It deliberately exposes BCA virtual account and QRIS only. These channels must be enabled in the merchant account. Supporting other methods means implementing their required customer, shipping or item fields and verifying that method in sandbox first. It returns a hosted checkout URL, provider reference and attempt ID; this is **not proof of payment**.

The adapter implements the Checkout **non-SNAP** HMAC-SHA256 scheme. It hashes the exact serialized body and signs the documented ordered components. SNAP, payouts, recurring billing and refunds use separate APIs and are not implemented. Never reuse this signer for those products. [DOKU backend integration](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration), [signature specification/sample](https://developers.doku.com/get-started-with-doku-api/signature-component/non-snap/sample-code)

`verifyPaymentNotification(env, { headers, rawBody, path })` verifies signature and merchant identity only. Read the body once, preserve its exact UTF-8 text, and pass the actual configured webhook path, not a target claimed by an incoming header. Parse JSON only after verification and tolerate extra provider fields. The utility rejects bodies over 1 MiB; also apply a request-size limit before buffering in the HTTP route. A valid signature does not identify an order owner, prove an amount is correct, or prevent replay.

Before exposing checkout or a webhook:

1. Authenticate the buyer and authorize access to the order. Read product prices server-side; never accept a browser-provided total or arbitrary callback URL.
2. Persist the order, currency, amount, merchant/provider, invoice and checkout attempt ID **before** the external call. Reuse the attempt ID on retry. Preserve an uncertain outcome for reconciliation instead of creating a fresh charge.
3. Verify the webhook signature, then durably record/dedupe the event and apply an allowed order transition in one internal Convex mutation. Match the stored invoice, amount, currency and provider; never fulfill an unknown or mismatched order.
4. Fulfill only a verified matching success. DOKU Checkout allows retrying another payment method: `FAILED` notifications must not terminally fail the order or undo paid status. Browser redirects never mark orders paid.
5. Return 2xx after durable acceptance; schedule email/fulfillment after acceptance. Duplicate delivery must return success without repeating effects. DOKU documents delayed and manual retries: do not add an arbitrary five-minute timestamp cutoff without verifying retry timestamp behavior. [Notification handling](https://developers.doku.com/get-started-with-doku-api/notification/best-practice), [retry schedule](https://developers.doku.com/get-started-with-doku-api/notification/retry-notification)

Application acceptance tests must cover duplicate/concurrent events, amount/currency mismatch, wrong merchant, unknown orders, success followed by failure, delayed retries, timeout/reconciliation, and repeated buyer clicks. Run the complete sandbox lifecycle with your merchant configuration before selecting production.

## Resend: transactional email

`sendEmail` accepts `to` (1–50 recipients), `subject`, nonempty plain `text`, optional `html`, and a required `idempotencyKey`. The private `EMAIL_FROM` setting owns sender identity. Keep email templates and escaping in the consuming feature; never interpolate unescaped user HTML. Verify the sending domain and use a restricted sending key. The returned message ID means the provider accepted the request, not that delivery succeeded. [Send email](https://resend.com/docs/api-reference/emails/send-email)

Before exposing any email-triggering feature, implement authorization, recipient derivation, rate limits, a durable outbox/delivery record and retry ownership. Use a stable key such as `receipt/<order-id>` with an immutable payload; Resend remembers keys for 24 hours, so provider idempotency alone does not prevent duplicates forever. Same-key/different-payload conflicts require correcting the workflow; do not blindly generate another key. Bounce, complaint and delivery webhooks need their own signature checks and state handling when the product requires them. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)

## Authentication

The optional Google OIDC implementation now lives in [auth.md](auth.md), including
session/CSRF protections, Convex audience configuration and owner-scoped CRUD. Additional
providers need a real integration and subject migration, not just a changed config value.
AI and MCP use a Google session or a private operator token; provider keys remain BYOK.

## GCP recipe

Keep Convex as the system of record. Add a named Google Cloud service only when the PRD needs it, such as Cloud Storage for an explicit storage requirement or Cloud Run for a workload outside Convex. Select the corresponding SvelteKit adapter/runtime if hosting the frontend there; do not assume the current Vercel adapter deploys to Cloud Run.

Use Application Default Credentials for local development, a user-managed service account attached to Cloud Run with minimal IAM privileges in production, and workload identity federation for supported external workloads/CI. Do not commit service-account JSON keys or set `GOOGLE_APPLICATION_CREDENTIALS` on Cloud Run when using service identity. A Convex-hosted action is not automatically a GCP identity; select and verify its authentication bridge explicitly before enabling calls. [Cloud Run service identity](https://docs.cloud.google.com/run/docs/securing/service-identity), [external workload authentication](https://docs.cloud.google.com/run/docs/reference/authenticate-to-cloud-run-api)

`GCP_PROJECT_ID`, `GCP_LOCATION` and `GCP_STORAGE_BUCKET` are unused until that service exists; a bucket name does not create storage or permissions. The commented `GOOGLE_APPLICATION_CREDENTIALS` example is an optional local path to an ADC credential configuration file, never JSON contents. Usually local `gcloud auth application-default login` supplies ADC without that override. [ADC search order](https://cloud.google.com/docs/authentication/application-default-credentials)

## Cloudflare recipe

Choose the actual purpose first: DNS/proxy management, a Worker-hosted frontend, or a product service. Simply placing a domain behind Cloudflare requires no Cloudflare API token in this app. `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN` are unused infrastructure planning settings until an integration calls the appropriate API. Use a scoped API token limited to the selected account/zone and required permissions; do not use a global API key. Keep infrastructure credentials in deployment tooling when the application has no operational need for them. [Cloudflare API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)

For Workers hosting, replace the current Vercel adapter with the supported Cloudflare adapter, configure Wrangler and its compatibility settings, and test the generated Worker before deploying. Workers product bindings are runtime objects, not ordinary `.env` strings; access them through the adapter's platform context. A Convex action or Vercel server cannot access a Workers binding by setting its name in `.env`: it needs the service's authenticated HTTP API or a separately implemented bridge. Verify Node API compatibility before moving the existing Node-crypto adapter into Workers. [SvelteKit on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/sveltekit/)

R2, Turnstile, DNS mutations and Worker deployment are not installed. Add each service's required bindings/secrets and runtime validation only when the PRD selects it. Implement and verify the capability before replacing the resolver's deliberate unsupported state. These app flags do not constrain external vendor CLIs, which have their own environment/configuration rules.

## Changing a provider without losing state

Add the second real adapter behind the existing `createCheckout` or `sendEmail` boundary, extend the config union/resolver, and add contract tests for the new transport. Introduce a registry only when two real adapters need selection. Do not spread provider names and credential checks through components or routes.

Persist the provider used on each order/delivery. Changing the default must not reassign old transactions: continue accepting old-provider callbacks and reconciling outstanding attempts until they are settled. Email keys, webhook IDs and provider references are provider-scoped. Auth changes additionally require a user/subject linking and session migration plan; cloud changes need a resource/data migration plan. A config string cannot perform those migrations.

The template's runnable adapter checks use mocked fetch only: `bun run test:unit src/lib/server/integrations/integrations.spec.ts`. Application lifecycle tests and provider sandbox evidence remain release requirements for each activated capability.

# Convex best practices

Read `src/convex/schema.ts` and the existing functions before editing. `convex.json`
selects this backend directory. `starter.status` exposes public build metadata; the
`notes` no longer exists (`023aa02`). Owner-scoped private data lives in `memories` and
`projects`; both require verified identity and indexed ownership, the same rule described here.
Optional Google auth is described in [auth.md](auth.md). Workspace UI grants no permissions.

## Types, validation and visibility

Import `query`, `mutation`, `action` and internal equivalents from the generated
`_generated/server`; import `api`/`internal` references from `_generated/api`.
Use object-form functions with both `args` and `returns` validators, including internal
functions. Use generated `Doc`/`Id` types and `v.id(...)` for document IDs. Add semantic
bounds such as maximum text length, permitted transitions and finite monetary values;
a `v.string()` or `v.number()` alone does not express those business constraints.

Expose functions publicly only when a client needs them. Keep scheduled callbacks and
privileged coordination internal. Return a deliberate result shape without unnecessary
private fields. Generate types with `bun run convex:codegen` after selecting a development
deployment; commit generated files and never edit them by hand. See
[function validation](https://docs.convex.dev/functions/validation) and
[generated code](https://docs.convex.dev/generated-api).

## Authentication and authorization

Every private read and write authenticates the caller and checks ownership or tenant
membership on the backend. A client-provided user ID, selected workspace, hidden menu
or SvelteKit route gate cannot grant access. Apply equivalent checks to actions before
calling external services. Public exceptions must be explicit and disclose no private
data, as in `starter.status`.

The included Google OIDC provider uses the current Svelte integration. `setupAuth`
and `useAuth` are the documented client boundary; an adapter may be community-maintained.
Verify issuer/audience configuration, token refresh, sign-out, unauthenticated denial
and cross-user isolation. SSR credentials belong to the current request, never a
shared authenticated server client. See
[Svelte authentication](https://docs.convex.dev/client/svelte/authentication) and
[backend identity](https://docs.convex.dev/auth/functions-auth).

## Data access and schema evolution

Design indexes for actual read paths, with fields in the queried order. Use indexed,
bounded results or pagination for growing collections; an indexed unbounded `collect()`
can still exceed a read budget. A post-read filter is not a substitute for an index.
Use small bounded arrays for local values and separate related documents for growing
collections. Do not add unused indexes for hypothetical queries.

Keep mutations transactional and await asynchronous work. Do not implement application
locks around ordinary Convex transactions. Reduce contention or bound batches when a
hot record becomes a bottleneck. A query does not rerun just because wall-clock time
passes; model expiry transitions or pass a deliberately refreshed time argument when
the product needs time-driven UI. See
[Convex best practices](https://docs.convex.dev/understanding/best-practices/) and
[query behavior](https://docs.convex.dev/functions/query-functions).

For existing data, evolve a field by widening the schema, deploying compatible code,
backfilling in bounded batches, then tightening validation. Record recovery steps and
verify a representative populated dataset. Do not clear tables or replace production
data merely to get a schema deployment past validation. See
[schema validation](https://docs.convex.dev/database/schemas).

## External services, webhooks and files

Use actions for external network calls and internal mutations for durable state changes.
An external API call and a database write are not one atomic transaction. Model pending,
succeeded and failed states; use stable operation/event IDs and reconciliation so a
timeout or retry cannot create a second charge or email. Add durable scheduling only
when the real flow requires it. A provider switch must preserve domain records and
handle in-flight work. Follow [optional integrations](integrations.md).

Verify webhook authenticity with the selected provider's current specification before
trusting the payload. Validate event fields, reject replay where supported, deduplicate
events transactionally and tolerate reordered events. A browser return URL is not proof
of payment. Persist only necessary provider data and use safe user-facing errors.
See [actions](https://docs.convex.dev/functions/actions) and
[HTTP actions](https://docs.convex.dev/functions/http-actions).

Secrets for Convex code belong in that Convex deployment's environment; SvelteKit
environment values do not automatically appear there. Do not use SvelteKit aliases
such as `$lib/server` or SvelteKit environment modules in Convex. Node-compatible
integration code must first be moved/extracted into a backend-owned runtime-neutral
module before a Node action imports it; `src/lib/server` stays inside the SvelteKit boundary.
See [integrations](integrations.md). Shared domain/config modules must stay runtime-neutral.
Separate development, preview and production credentials.

Use Convex storage first for product uploads. Persist storage IDs, resolve URLs when
needed and check ownership on upload/read/delete paths. Validate allowed file types and
size at the trusted boundary; an HTML file picker filter is only UX. Add GCP only for
a documented workload the default backend does not cover. See
[file storage](https://docs.convex.dev/file-storage).

## Verification

`bun run check` includes backend typechecking. After backend changes, push to a selected
development/local deployment and invoke the changed function with a realistic payload.
Do not use a production deployment for exploratory testing. Check logs and actual
results; codegen and a successful push alone do not prove business behavior.

Add focused tests for validation and consequential behavior. Private functions require
unauthenticated and wrong-owner denial cases; money or webhook paths require duplicate,
invalid-signature, retry and out-of-order cases. Use the existing test runner and add
the official Convex testing tools when their execution model is needed. See
[Convex testing](https://docs.convex.dev/testing).

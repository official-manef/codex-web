# BYOK, cloud persistence and the decision model

The template ships three engines and one rule: **the browser never holds a provider key.**

## 1. Engines

| Engine   | Runs where                                    | Needs an account | Needs a network | Needs a key |
| -------- | --------------------------------------------- | ---------------- | --------------- | ----------- |
| `local`  | the browser (`src/lib/http.local.ts`)         | no               | no              | no          |
| `device` | a runtime the user paired (their own NPU box) | yes (to pair)    | local link only | no          |
| `cloud`  | a Convex action with the user's own key       | yes              | yes             | yes         |

All three stay available. Enabling cloud removes nothing: with no `PUBLIC_CONVEX_URL` the
adapter reports `unsupported`, the sign-in routes 404, and the workspace is exactly the local
template. `slices/cloud/state/engine.ts` is the single place that decides availability and
names the reason a control is disabled.

## 2. BYOK contract

**Storage.** `modelCreds` holds one row per `(owner, provider)`. The key is encrypted with
AES-256-GCM (`src/convex/crypto.ts`) using `MODELS_ENC_KEY`, a base64 32-byte master key set on
the Convex deployment:

```bash
openssl rand -base64 32     # put the result in MODELS_ENC_KEY
```

Losing that key makes every stored credential unreadable; the product must then ask users to
reconnect. Rotating it is a migration, not a restart.

**Identity.** `owner` is `identity.tokenIdentifier` from the signed-in session. It is derived
inside every handler (`requireUser`), never sent by the client. A session id is not authority:
every read of a session or message also checks `owner`. A signed-in owner is required to store a
key, so a deployment with `AUTH_ENABLED=false` cannot use the cloud engine at all — it stays on
local/device mode.

**Host gate.** A built-in provider's key is pinned to the baseURL in `src/convex/providers.ts`.
A caller-supplied endpoint is honoured only for a custom slug, and only over HTTPS with no
embedded credentials. Provider A's key can therefore never be redirected to provider B.

**Self-hosted gateways are built-in, not custom.** `nine-router` is registered in
`PROVIDERS` with its own pinned baseURL (`https://router.antinrml.com/v1`, OpenAI protocol)
rather than being connected as a custom slug. That matters: a custom slug accepts a
caller-supplied endpoint, so a 9router key stored that way could be pointed anywhere. As a
built-in it is pinned like OpenAI itself.

The same slug also exists in `src/lib/server/ai/config.ts` for the SvelteKit route, which
serves four providers against eleven on the Convex path. `src/convex/` cannot import from
`src/lib/` — the Convex runtime bundles its own module graph — so the two files duplicate the
host on purpose. Drift shows up as a key sent to the wrong origin, and
`vitest run src/convex src/lib/server/ai` is what catches it.

**Manual-key fallback is a flow, not a field.** The connect form shows, for every built-in
provider: the official key page (`docsUrl`), an instruction to create a key there, the fact
that the key is shown once, the exact field to paste it into, that it is encrypted
server-side, and a Disconnect action that deletes the row. A blank secret input is never the
whole interface.

**OAuth path.** OpenRouter and the other OAuth-capable providers are documented as the preferred
path in `models-rahmanef-com`, but this template does not ship the OAuth client: the operator
would need the provider's client registration and a callback route. Until that is configured
the UI shows the manual-key path as the available one and does **not** present a disabled OAuth
button as if it were ready (rr P0: do not fake OAuth readiness).

## 3. Chat

`src/convex/chat.ts` calls the provider with the decrypted key and returns text. It is one
action, with:

- object-form `args` and `returns` validators;
- bounded input: 32 messages, 32 000 chars each, 4 096 output tokens, 60 s timeout;
- a typed `ConvexError` payload `{ code, message }` — `invalid_request`, `no_credential`,
  `provider_error`, `unsupported` — with the provider response never forwarded verbatim;
- usage logged through an internal mutation, so a failed call is still counted.

`src/lib/cloud/chat.ts` is the browser-side adapter. `src/routes/+layout.svelte` wires it once
when a deployment URL exists. `configureCloudChat(null)` restores the unconfigured state, which
is what the local-only build uses.

## 4. Decision model (Jev / Laya)

The model is non-autoregressive: it takes a state and typed questions and returns a label, an
ordinal score, or `P(yes)`. It never writes prose, so it cannot hallucinate a sentence.

`src/convex/decisions.ts` **records** verdicts; it does not run inference. Two engines produce
them:

1. **NPU (device)** — the browser POSTs to the user's own runtime (`/v1/systemone`). This cannot
   go through Convex: a Convex action cannot reach a user's localhost. The verdict is then
   recorded with `engine: 'npu'`.
2. **Host (OpenAI-compatible)** — a provider endpoint that speaks the same wire protocol.
   Recorded with `engine: 'host'`. This path stays a contract; no public endpoint is configured
   by default.

Hard rules carried from the model's own contract, enforced at the recording boundary:

- English-only input (a non-Latin prompt can score 0.000 with confidence 0.95);
- one question per request;
- at most 8 options;
- at most 512 tokens of state.

The gate value is `probabilities[choice]` or `noul`, never `confidence`, which is normalized
entropy and drops as the option count grows.

A verdict may be attached to a cloud turn as `decisionNote`; `chat.send` prefixes it as
untrusted context, never as an instruction.

## 5. Paired devices and the bridge

A `device` turn needs an execution target the browser cannot provide: a shell, or a real
browser session. That target is the user's own machine, reached over a self-hosted bridge
(`/v1/health`, `/v1/terminal`, `/v1/browser/view`).

- `src/lib/runtime/endpoint.ts` classifies an endpoint `loopback | lan | tailscale | public |
invalid`. Plain `http:` is accepted for loopback, LAN and Tailscale (a MagicDNS name is
  already inside an encrypted tailnet) and refused for public hosts.
- The pairing token is generated in the browser with `crypto.getRandomValues` and shown once.
  Only `SHA-256(token)` reaches `devices.register`; the plaintext stays in that tab's memory.
  A WebSocket sends it in `Sec-WebSocket-Protocol: bearer.<token>`, never in the URL.
- `src/convex/_shared/endpoint.ts` re-validates the stored origin; Convex cannot import the
  browser module.
- Both device tools are off by default and appear only when a device of that kind is paired
  and the user enables the tool in Tools. A remote browser view is not framed: a token in an
  iframe URL would leak, so the UI names that limit instead of showing a broken frame.

A reference bridge ships at `bridge/terminal-bridge.mjs`; it is a separate process the user
runs on their own machine, never a route in this app. No `ssh -L`, `tailscale serve` or
`tailscale funnel` command in the UI has been run here.

## 6. What is intentionally absent

- OAuth client registration for providers (see §2).
- A public Jev host endpoint (see §4).
- Billing, spend caps, quotas: this is BYOK, so the user's own provider bills them.
- Teams/workspaces/multi-tenant sharing, agent mode, RAG, memory, channels, embeds. All of that
  exists in `models-rahmanef-com` and none of it is needed to ship a workspace that runs on the
  user's own key.

## 7. Verification

| Check        | Command                      | Result                                       |
| ------------ | ---------------------------- | -------------------------------------------- |
| Convex types | `tsc --noEmit -p src/convex` | clean                                        |
| App types    | `bun run check`              | 0 errors, 0 warnings                         |
| Unit         | `bun run test:unit`          | 138 passed (27 files)                        |
| Build        | `bun run build`              | ok                                           |
| Browser      | `bunx playwright test`       | **not run** — see [progress.md](progress.md) |

> The unit count above was 95 when this table was written and the browser row claimed 12
> passed. Both went stale: `6ed1f3e` deleted the acceptance suites with the route family
> they targeted, so there is no browser proof of AC01–AC18 today. Numbers here are measured
> on `d839f75`; `docs/progress.md` is the authoritative gate list.

Not verified: a live Convex deployment, a real provider call, a real NPU device, a real
bridge, and every `ssh -L` / `tailscale serve` / `tailscale funnel` command shown in the
Devices screen. Those need credentials and hardware the template deliberately does not
contain.

**Generated types.** `src/convex/_generated/api.d.ts` lists the modules by hand because
`convex codegen` needs a deployment. `api.js` uses `anyApi`, so runtime is unaffected. Run
`bun run convex:dev` once against a real deployment and the file regenerates.

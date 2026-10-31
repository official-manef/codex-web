# Technology contract

`package.json` declares supported dependencies and runtime ranges; `bun.lock` records
the exact installation and `.node-version` selects the tooling runtime. Read those files
for version numbers rather than maintaining another version list here.

| Layer               | Choice / responsibility                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Package manager     | Bun; one committed `bun.lock`                                                              |
| Framework           | Svelte 5 Runes and SvelteKit                                                               |
| Language / build    | Strict TypeScript, Vite                                                                    |
| UI                  | Tailwind CSS 4, source-owned shadcn-svelte, Bits UI and Lucide                             |
| Backend             | Convex with `convex-svelte`; frontend connection optional                                  |
| Deploy              | Vercel by default; optional Node adapter/container for VPS or Cloud Run                    |
| Asset tooling       | Development-only resvg renders SVG placeholders to PNG; files are committed                |
| Verification        | Svelte/TypeScript checks, Prettier, ESLint, Vitest, Playwright and GitHub Actions          |
| Optional auth / AI  | Google OIDC (`openid-client`, `jose`), Vercel AI SDK provider clients and official MCP SDK |
| Optional transports | DOKU Checkout and Resend using server-side fetch and Node crypto where needed              |

## Three engines, one shell

The workspace can execute a turn three ways. All three render the same shell, so switching
one does not change any layout code.

| Engine   | Executes where                           | Needs an account | Needs a provider key | Implemented in                   |
| -------- | ---------------------------------------- | ---------------- | -------------------- | -------------------------------- |
| `local`  | the browser only, no network             | no               | no                   | `src/lib/http.local.ts`          |
| `device` | a paired runtime you own (NPU box, host) | yes, to pair     | no                   | `src/lib/device_tools.svelte.ts` |
| `cloud`  | a Convex action using **your** key       | yes              | yes                  | `src/convex/`, `slices/cloud/`   |

`local` is not a stripped-down fallback. With `PUBLIC_CONVEX_URL` unset the sign-in routes
404, `cloud` reports `unsupported`, and the app is exactly the local template. Nothing
degrades silently: the unsupported engine is reported as unsupported.

The surface (`local` or `cloud`) selects which tools start enabled, not what is permitted.
It is presentation state derived from the page origin unless `PUBLIC_SURFACE` pins it; no
server handler reads it. Authority is enforced separately, per request, on the server.

## Two backend paths, deliberately duplicated

Provider definitions exist twice:

| Path            | File                          | Reaches              |
| --------------- | ----------------------------- | -------------------- |
| `cloud` engine  | `src/convex/providers.ts`     | Convex actions       |
| SvelteKit route | `src/lib/server/ai/config.ts` | `/api/ai/*` handlers |

`src/convex/` cannot import from `src/lib/`: the Convex runtime bundles its own module
graph. A shared constant would need a build step that the template does not justify.
Both files pin the same host, so a divergence would show up as a key posted to the wrong
origin. Change one, change the other, then run `vitest run src/convex src/lib/server/ai`.

The `nine-router` slug is the clearest case: a self-hosted OpenAI-compatible gateway at
`https://router.antinrml.com/v1`. It is a built-in provider on both paths, which means its
key is host-pinned exactly like OpenAI's and cannot be redirected.

## Compatibility and updates

Core framework dependencies remain pinned. Review official compatibility before a
major upgrade, including TypeScript, Vite, the Svelte plugin, adapter and Node runtime.
Regenerate the lockfile with the declared Bun version and verify the complete build.
Dependabot proposes minor/patch updates and separate majors; unsupported TypeScript
and Node-type major updates are excluded by the checked-in policy.

Bun is the package manager and script launcher. Some CLIs still execute through Node,
and Vercel functions are not a Bun HTTP server. Installing Bun alone does not satisfy
the documented toolchain. Adding another package manager or lockfile is not required.

## Boundaries

The app starts without credentials. Convex generated types are committed; its base
notes schema is owner-scoped through verified Google identity. Cross-user/tenant sharing
is product work; local workspace examples do not grant permissions.
Payment/email transports are disabled building blocks verified with mocked HTTP,
not complete business flows. Auth and BYOK AI/MCP are implemented opt-ins; additional
cloud services remain recipes with explicit unsupported resolver states. See [integrations](docs/integrations.md).

shadcn-svelte/Bits UI own accessible controls; shared `app-ui` components own layout;
feature slices compose them; routes adapt SvelteKit. Public app config and the asset
catalog drive branding. Private integration config never belongs in browser data.
See [architecture](docs/architecture.md) and [design](DESIGN.md).

Official references: [SvelteKit](https://svelte.dev/docs/kit),
[Convex Svelte](https://docs.convex.dev/client/svelte/overview),
[Bun](https://bun.sh/docs), [shadcn-svelte](https://www.shadcn-svelte.com/docs).

`cookie` is deliberately overridden to 0.7.2 because the current SvelteKit range includes
an older version affected by [GHSA-pxg6-pf52-xh8x](https://github.com/advisories/GHSA-pxg6-pf52-xh8x).
The public parse/serialize APIs used by this app are compatible and auth/browser gates
cover the change. Remove the override once upstream resolves to a patched version.

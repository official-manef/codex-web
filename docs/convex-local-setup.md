# Convex local deployment — reproducible setup

How to get a local Convex backend that this checkout owns, push the schema and functions to
it, and prove the auth boundary. Written 2026-11-02 after three security tests turned out
never to have run.

## The two traps

Both cost real time; neither is obvious from an error message.

### 1. Pushing needs Node 22 or 24, not the default

With a newer Node on `PATH`, `npx convex dev` fails at the push step:

```
✖ Error fetching POST  http://127.0.0.1:3212/api/deploy2/start_push 400 Bad Request:
DeploymentNotConfiguredForNodeActions: Hit an error while pushing:
Deployment is not configured to deploy "use node" actions.
Node.js v22 or 24 is not installed. Install a supported Node.js version with nvm
(https://github.com/nvm-sh/nvm) to deploy Node.js actions.
```

`src/convex/chat.ts` starts with `'use node'`, so the deployment refuses the push outright.
Fix — the CLI inherits `PATH`, so prefixing the nvm bin is enough:

```bash
export PATH=~/.nvm/versions/node/v24.22.2/bin:$PATH   # or v22.23.2
node --version                                         # must print v22.x or v24.x
npx convex dev
```

The backend starts and pushes fine under the newer Node; only the push is gated.

### 2. Ports are per project, so a hardcoded port hits somebody else's backend

The CLI allocates the first free pair from 3210 upwards. On a machine with more than one
Convex project, `3210` is simply whoever got there first. Observed here: `127.0.0.1:3210` was
serving `/home/rahman/agent-work/kampungkomen/kampungkomen-shots`, a different repository.

That is not a cosmetic wrong address. A foreign deployment with a `devices:list` answers
`Please sign in.` for anonymous callers exactly like ours would, so a spec pointed at it would
report **the auth boundary held while measuring a stranger's**. A green gate, wrong subject.

Consequences:

- the port lives in `.convex/local/default/config.json` → `ports.cloud`, per checkout;
- `CONVEX_URL` is resolved from that file by `scripts/convex-local.mjs`, wired in at two
  places: `vite.config.ts` (vitest) and `bin/gate` (its environment probe);
- there is no hardcoded default in `src/convex/deployment_probe.ts`. A checkout with no
  recorded deployment reports `absent` — "no port was guessed" — instead of probing 3210.

Check whose backend you are talking to before believing any result:

```bash
curl -s http://127.0.0.1:3212/instance_name   # prints the deployment name, e.g. anonymous-agent
```

## Reproduce from scratch

```bash
# 1. Node 22 or 24 — see trap 1.
export PATH=~/.nvm/versions/node/v24.22.2/bin:$PATH

# 2. Start the backend and push schema + functions. No Convex account needed: anonymous mode
#    keeps everything local. Leave it running — `--once` exits and takes the backend with it.
npx convex dev

# 3. Confirm which project answered and that the functions are live. An anonymous call to a
#    protected query must come back with a refusal, not "Could not find public function".
curl -s http://127.0.0.1:3212/instance_name
curl -s -X POST http://127.0.0.1:3212/api/query \
  -H 'Content-Type: application/json' \
  -d '{"path":"devices:list","args":{},"format":"json"}'
```

Observed 2026-11-02, after the push:

```
$ curl -s http://127.0.0.1:3212/instance_name
anonymous-agent

$ curl -s -X POST http://127.0.0.1:3212/api/query \
    -H 'Content-Type: application/json' \
    -d '{"path":"devices:list","args":{},"format":"json"}'
{"status":"error","errorMessage":"[Request ID: 9632edadb1b3b29a] Server Error\nUncaught ConvexError: Please sign in.\n    at requireUser (../../src/convex/_shared/auth.ts:20:8)\n    at async handler (../src/convex/devices.ts:36:15)\n","errorData":"Please sign in."}
```

`Please sign in.` is the pass condition: `requireUser` ran, the row was never read. Before the
push the same request answered `Could not find public function for 'devices:list'.`

```bash
# 4. The security tests now execute instead of skipping.
npx vitest run src/convex/deployment.spec.ts --reporter=verbose
npx vitest run          # 446 passed, 0 skipped
bash bin/gate           # exit 0
```

## Why `npx convex dev --once` is the wrong command here

`--once` runs the first three steps and **exits**, stopping the backend it started. The port is
recorded in `.convex/local/default/config.json` and keeps pointing at a dead number, so every
later run reports `absent` and the auth tests skip — the exact failure mode this document
exists to prevent. Use a long-running `npx convex dev`, or `--once` followed immediately by the
spec in the same shell session.

## What is still unproven

- **Nothing about the cloud deployment.** Every result above is the local anonymous backend.
  Whether the same functions and the same auth boundary hold on a real deployment needs
  credentials this repo does not ship, and is not proven by this document.
- **`AUTH_CLIENT_ID` is unset locally**, so `auth.config.ts` registers zero providers. The
  assertions prove an anonymous caller is refused; they do not prove a genuine Google-issued
  identity is accepted, because no such identity exists in a local anonymous deployment.
- **The gate's other steps are unaffected.** `bash bin/gate` also runs prettier, eslint,
  svelte-check, tsc, the build and playwright; this document only covers the Convex step.

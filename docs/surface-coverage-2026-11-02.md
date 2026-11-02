# Surface coverage — 2026-11-02

Every id in `src/lib/registry.ts` walked in a real browser, through the control a user actually
has, against the build the Playwright config serves (`AUTH_ENABLED=false`, `AI_ENABLED=false`,
`MCP_*=false`, no `PUBLIC_CONVEX_URL`). Executable form: `tests/surfaces.e2e.ts`.

Index: [README.md](README.md). Related: [ac-coverage-2026-11-02.md](ac-coverage-2026-11-02.md),
[a11y-2026-11-02.md](a11y-2026-11-02.md), [view-audit-2026-11-01.md](view-audit-2026-11-01.md).

## The four questions

| Column        | Meaning                                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **reachable** | Opened by the real affordance (`rail`, `More tools`, `View ▸ Tools`, `User menu`, the settings window's category list, the tab strip/launcher), and the surface that opens is the one the registry labels. |
| **landmark**  | Renders at least one visible element with an accessible name: heading, `role="region"`, `role="log"`, `role="tabpanel"` with a label.                                                                      |
| **console**   | No page error, no console error of its own, no failed request the screen does not document.                                                                                                                |
| **honest**    | States why it cannot do the thing. A screen with no backend names the missing piece instead of a blank box or a fake "Connected".                                                                          |

## The 29 ids

Counted from the registry, not assumed: 22 `SECTIONS` + 7 `CHAT_OUTPUTS` = **29**. This was 28
until `mcp-apps` was registered by the parity batch; `tests/surfaces.e2e.ts` fails
(`every registry id has a surface case`) if this table and the registry ever disagree again.

| id               | affordance                                | reachable | landmark                            | console                          | honest                                                                | verdict |
| ---------------- | ----------------------------------------- | --------- | ----------------------------------- | -------------------------------- | --------------------------------------------------------------------- | ------- |
| `chat`           | rail · Chat                               | pass      | `h1` "What would you like to do?"   | clean                            | "No provider configured · BROWSER"                                    | pass    |
| `manef`          | rail · MANEF AI                           | pass      | `h1` MANEF AI, `h2`×2               | 503 `/api/manef/*` (documented)  | "No MANEF AI hub is configured. Set `MANEF_HUB_URL`"                  | pass    |
| `apps`           | rail · Automation                         | pass      | `h1` Automation, `h2`               | clean                            | "This browser build has no runtime behind it"                         | fixed   |
| `transcribe`     | rail · Transcribe                         | pass      | `h1` Transcribe                     | clean                            | "No speech model in this build"                                       | fixed   |
| `files`          | rail · Files                              | pass      | `section` File viewer               | clean                            | "Choose files or a folder… not uploaded"                              | fixed   |
| `browser`        | rail · Browser                            | pass      | `section` Browser preview, `h2`     | clean                            | "Open a website … enter an address"                                   | pass    |
| `overview`       | More tools · Start here                   | pass      | `h1`, `h2`×6, `section`             | clean                            | "No compute device is configured"                                     | pass    |
| `voice`          | More tools · Voice to action              | pass      | `h1`, region                        | clean                            | "No file limit is reported … this build loads none"                   | fixed   |
| `playground`     | More tools · Decision simulation          | pass      | `h1` + `h3` per example             | clean                            | "Stub · no runtime", "no model, so a run stops with an error"         | pass    |
| `snake`          | More tools · Snake demo                   | pass      | `h1`, `section` Snake game          | clean                            | "No device is selected, so a run cannot start here"                   | fixed   |
| `embeddings`     | More tools · Embedding search             | pass      | `h1`, `h2`×2                        | clean                            | "Install an embedding model to try this"                              | fixed   |
| `models`         | User menu ▸ Settings ▸ Models & downloads | pass      | `h1`, `h2`                          | clean                            | "no OpenVINO devices", "no download route"                            | pass    |
| `setup`          | … Settings ▸ Setup check                  | pass      | `h1`, `h2` per check                | clean                            | "Not configured" ×2, "not detected", "unavailable"                    | pass    |
| `backends`       | … Settings ▸ Compute & devices            | pass      | `h1`                                | clean                            | "Template stub. No model runs", "No Intel NPU detected"               | pass    |
| `providers`      | … Settings ▸ Providers                    | pass      | `h1`                                | clean                            | "Not configured", "Not measured"                                      | pass    |
| `pricing`        | … Settings ▸ Costs                        | pass      | `h1`, `h2`                          | clean                            | "no endpoint is connected in this build"                              | pass    |
| `keys`           | … Settings ▸ Model keys                   | pass      | `h1`                                | clean                            | "Cloud mode is not configured. Set `PUBLIC_CONVEX_URL`"               | pass    |
| `faq`            | User menu ▸ Help                          | pass      | `h1`, `h2`×7                        | clean                            | "This browser build", "· desktop app" sections                        | pass    |
| `tools`          | … Settings ▸ Tools                        | pass      | `h1`, `h2`×4                        | clean                            | per-row "Needs a runtime on this machine"                             | pass    |
| `devices`        | … Settings ▸ Paired devices               | pass      | `h1`, `h2`×4                        | clean                            | "nothing is paired in this build", "Cloud mode is not configured"     | pass    |
| `memories`       | … Settings ▸ Memories                     | pass      | `h1`, `h2`                          | clean                            | "No memories stored yet … stay on this machine"                       | pass    |
| `git`            | … Settings ▸ Repository                   | pass      | `h1` Git, nav "Repository"          | 404 `/api/git` (documented)      | "Set `GIT_SURFACE_ENABLED=true`"                                      | pass    |
| `automations`    | … Settings ▸ Scheduled tasks              | pass      | `h1`                                | clean                            | "Cloud mode is not configured … nowhere to keep a schedule"           | pass    |
| `chat-tools`     | User menu ▸ Integrations                  | pass      | `h2` Integrations, `h2` Tools       | clean                            | "Choose an MCP connection", "keeps no connections"                    | pass    |
| `chat-settings`  | User menu ▸ Settings (primary)            | pass      | `h2`×2, `h3`×2                      | clean                            | "No provider configured", "No model is installed in this build"       | pass    |
| `chat-session`   | … Settings ▸ Session                      | pass      | `h2`×2, `h3`                        | clean                            | "Chat and utilities" list, per-action disabled reasons                | fixed   |
| `workspace-home` | View ▸ Tools ▸ Open tools                 | pass      | `section` Open a local tool, `h2`×3 | clean                            | "Every tool this build registers … none reaches a server"             | pass    |
| `terminal`       | launcher search → Terminal                | pass      | `h1` Terminal                       | clean                            | "No terminal can open yet: this build has no backend"                 | pass    |
| `mcp-apps`       | User menu ▸ Settings ▸ MCP apps           | pass      | `h1` MCP apps, `h2`×0               | 404 `/api/mcp/apps` (documented) | "The app host is switched off on this server, set `MCP_APPS_ENABLED`" | pass    |

**Verdicts: 22 pass, 7 fixed, 0 open findings.**

## Defects found

### 1. A deep link to a runtime-gated view opened nothing (`#apps`, `#transcribe`, …)

`workspace-shell.svelte` computed `initialLayout()` in `onMount` from `SECTION_IDS`, which is derived
from the feature registry. The host only turns the stored tool selection on after _its_ mount
(`featureSettings.start()`), so on first paint the registry was the `cloud` surface subset: `apps`,
`transcribe`, `models`, `overview`, `voice`, `playground`, `snake`, `embeddings`, `setup`, `backends`,
`files` and `browser` were all absent. `routeWorkspaceLayout` dropped the request, and the shell left
`#apps` sitting in the address bar while rendering the chat. Views link to each other with
`href="#playground"` and `href="#apps"`, so an in-app link into a gated view from a reload did
nothing.

Fix: one `$effect` retries the page's own mount hash once the id exists, then marks itself settled so
it cannot fight the user's later navigation.
Test: `a hash link to an enabled view opens that view on first load`.

### 2. Files was the page's second, unnamed `main` landmark

`FileCanvas.svelte` rendered `<main id="file-view-content">` inside the shell's own `<main
id="workspace">`. Two `main` landmarks, the inner one unnamed, and its content is what a screen
reader wants when a file opens. Fixed to `role="tabpanel"` with a `File content` label while empty;
the shell keeps the only `main`.
Test: `files: reachable, named, quiet and honest`.

### 3. Embedding search printed `4 files · NaN MB each`

The stub's capabilities answered `max_bytes`; both `Embeddings.svelte` and `Chat.svelte` read
`max_file_bytes`. One field, two names, and the undefined one reached the screen.
Test: `embeddings: reachable, named, quiet and honest` (the `NaN|undefined` assertion).

### 4. Transcribe and Voice ran two failed requests to say "no speech model"

`/api/asr` and `/api/pipeline` fell through to the stub's generic `{error}` shape, so both views
showed a `RecoveryNotice` reading "This template has no backend; wire src/lib/http.ts to a real
transport.." — a sentence for the developer, not the user, with a doubled full stop. They also
rendered `Up to … MB and … seconds`, an unfinished sentence. Both endpoints now answer with the shape
the views read (`present: false`), and the panels say "No file limit is reported: a speech model
supplies it, and this build loads none."
Test: `transcribe:` / `voice: reachable, named, quiet and honest`.

### 5. Snake claimed "Ready. Every step calls the real model." with no device

The status line was unconditional. With no engine selected the run button is disabled and the claim
is false before it is clicked. Snake also refused to run at all when the server reported no
`benchmarks.max_steps` — absence of a ceiling was treated as "wait for limits". Both are fixed: the
status names the missing device, and a missing limit means no limit.
Test: `snake: reachable, named, quiet and honest`.

### 6. The stub's error copy named a source file to the end user

Every unimplemented endpoint answered `This template has no backend; wire src/lib/http.ts to a real
transport.`, which Automation, Embedding search and the chat's recovery notice printed verbatim.
Reworded to say what the reader can act on: "This browser build has no runtime behind it, so the
request cannot be answered here. The desktop app is the build that can."
Test: `apps:` / `embeddings: reachable, named, quiet and honest`.

### 7. The chat's Session panel offered `Document corpus`, an id deleted in `6ed1f3e`

`onNavigate("corpus")` reached `WorkspaceShell.go()`, which returns early for an unregistered id, so
the button did nothing and said nothing. The entry is gone; six destinations remain and all six open.
Test: `the session panel only offers destinations that open` — it clicks every entry and requires the
resulting surface to change, so a dead entry cannot come back silently.

## What is not covered

- **Mobile and narrow projects.** The 29-id walk is skipped outside `desktop`
  (`testInfo.project.name`). The controls are the same DOM, but the off-canvas drawer makes each
  open path a different sequence; the existing acceptance suite covers the drawer's own behaviour.
- **Behaviour inside a surface** (sending a message, running a classification, uploading audio). Those
  need a backend the config does not provide; `docs/ac-coverage-2026-11-02.md` tracks them.
- **Hosted surfaces.** `HostedGate`, the portal sign-in and the pairing form never render with
  `AUTH_ENABLED=false`; nothing here asserts them.
- **`chat-tools` beyond its first tab.** The panel's MCP/Skills tabs have their own empty states and
  are not walked tab by tab.

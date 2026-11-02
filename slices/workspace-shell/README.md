# Workspace shell source contract

This Svelte 5 shell can be consumed without Laya's application or backend source.
The working second consumer is `tests/fixtures/second-consumer/`. It uses its own
chat component, feature registry, labels, light theme and in-memory adapters.

An installable local package is now available as `@workspace-template/svelte`
0.2.0. Run `npm run pack:workspace` to create the tarball and see
`packages/workspace-template/README.md` for installation and public exports.
`npm run test:workspace-package` installs the tarball into an independent consumer
with its own lockfile and dependencies, then checks its types and production build.

## Source boundaries

Copy `slices/workspace-shell/` and `shared/` together, preserving their relative
paths. Import the shell through `slices/workspace-shell/index.ts`, and shared
sub-slices through their own `index.ts` barrels. The shell's semantic CSS
variables and element defaults live in `src/app-laya.css`, imported once from
`src/routes/layout.css`; override those variables for a different theme. Laya's
extra view and chat styles remain in `src/app-laya.css`.

Use the frontend dependency versions pinned by this repository's lockfile:
Svelte, bits-ui, Vite/Svelte tooling, Tailwind, tw-animate-css, shadcn-svelte and
the bundled Inter font. The isolated build check reuses installed dependencies;
it does not test installation. The separate package test performs installation
with a new lockfile and npm ci; nothing is published to an npm registry or rr.

## Composition

The consumer supplies `displayName`, `chat`, `runtime`, `persistence`, feature
`sections`, `auxiliaryViews`, `railViews`, and `launcher` preferences. For a
minimal workspace use empty feature/rail/launcher lists and omit optional
components and integrations. `chat` stays mounted while output views change.
The reserved `chat` route represents that persistent region; feature IDs are
otherwise consumer-defined and checked against the enabled registry.

`WorkspaceChatProps` and `WorkspaceChatHandle` in `shared/runtime/` define the
chat bindings and passive callbacks. A chat implementation owns its actual
session/backend protocol. `WorkspaceRuntimeAdapter` exposes read-only discovery;
it does not authorize execution. The host may supply backend-selection rules.
`WorkspacePersistence` stores passive layout/preferences through a host-selected
scope. Never put credentials, approvals or executable jobs in that adapter.

Optional contributions include a hosted connection gate, runtime controls,
settings window, canvas header, launcher and an integration lifecycle callback.
Omitted contributions are not mounted. `chatPanels`, `settingsMenu`,
`fileMenuViews` and `canvasPresentation` describe the consumer's own routes;
Laya's mappings live in `src/lib/workspace_routes.ts`. Labels can be
overridden without editing shell source. Feature metadata describes availability;
the backend must enforce capabilities and approvals independently.

The feature registry supports opt-in features, stable IDs and lazy screens.
Nested shared sub-slices live under `shared/` inside this slice; they expose
public barrels. No rr distribution metadata has been invented: publishing as an
installable rr slice still requires checking that distribution contract.

## Verification

From WSL/Linux with repository dependencies installed:

```sh
python3 scripts/verify-template-consumer.py
```

This builds a temporary source tree containing only the shell, shared modules
and second-consumer example. It has no `src/`, `server/`, `portal/` or Laya
import aliases. The fixture README documents repeatable browser tests covering
its navigation, resize, errors/retry, refresh and observed storage/network scope.

`tests/test_workspace_browser.mjs` checks the installed Laya composition in a
disposable browser profile. Set `FIELD_BROWSER` to Chrome and optionally
`LAYA_UI_URL` and `LAYA_SCREENSHOT_DIR`. It exercises navigation and draft
restoration without sending a chat message, running a workflow or approving an
action. Hardware policy and accuracy tests remain separate from UI tests.

Menubar and resource-header contracts are documented in the package README.
They are optional host contributions; they do not introduce product HTTP or
storage defaults. `tests/test_workspace_chrome_browser.mjs` exercises the
installed Laya menus, editable selection, local file fixture, panel header and
narrow view through real Chrome input in a disposable profile.

## Enforced consumer boundary (0.2.0)

Consumer Chat handles implement focusComposer(); no input ID or private CSS
structure is required by shell chrome. Feature navigationRole determines
Settings/Explore behavior; group text and WorkspaceLabels are presentation.
Chat presentation IDs are generic. Product controllers narrow their own modes
and backends. ChatSurface/Header/Composer own reusable frames and styles.

Run npm run check:template for a complete owned-source audit, and npm run
test:workspace-package for outside-repository installation, artifact/declaration
audit, independent build and Laya build through that installed public package.
Svelte and bits-ui are shared peers; linked builds deduplicate their contexts.
See docs/FRONTEND-RUNTIME-BOUNDARY-AUDIT.md for current evidence and scope.

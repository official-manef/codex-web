<script lang="ts">
  import { onMount, setContext, tick, untrack, type Component, type Snippet } from "svelte";
  import {
    resolveChatPresentation,
    type WorkspaceChatPresentation,
  } from "./shared/runtime/index.js";
  import type { WorkspaceChatUIConfig } from "./shared/chat-ui/index.js";
  import type { WorkspaceChatAppearance } from "./shared/chat-ui/index.js";
  import FeatureHost from "./feature-host.svelte";
  import type { WorkspaceOutputOrigin } from "./shared/runtime/index.js";
  import { resolveWorkspaceLabels, type WorkspaceLabels } from "./labels.js";
  import { Icon } from "$shared/icons/index.js";
  import {
    defaultBackendSelection,
    initialBackend,
    initialCompare,
  } from "./shared/runtime/index.js";
  import type {
    WorkspaceBackendSelection,
    WorkspaceChatComponent,
    WorkspaceChatHandle,
    WorkspaceRuntimeAdapter,
    WorkspacePersistence,
    WorkspaceIntegration,
    WorkspaceGateComponent,
    WorkspaceRuntimeControlsComponent,
    WorkspaceHeaderComponent,
    WorkspaceSettingsComponent,
    WorkspaceLauncherComponent,
  } from "./shared/runtime/index.js";
  import { toggleTheme } from "$lib/theme.svelte";
  import { configuredNavigation } from "./shared/launcher/index.js";
  import { WorkspaceMenuItems, type WorkspaceMenuItem } from "./shared/menu/index.js";
  import type { ApprovalControlConfig } from "./shared/approval-mode/index.js";
  import { DropdownMenu, Popover, Dialog } from "bits-ui";
  import {
    WorkspaceMenubar,
    registerMenuShortcuts,
    captureEditCommands,
    type WorkspaceMenuGroup,
    type WorkspaceEditCommand,
    type WorkspaceMenuBinding,
  } from "./shared/menu/index.js";
  import {
    WORKSPACE_RESOURCE_CONTEXT,
    type WorkspaceResourceContext,
    type WorkspaceResourceHeader,
  } from "./shared/runtime/index.js";
  import {
    visitRoute,
    stepRoute,
    visibleRegions,
    type NavigationTrail,
  } from "./shared/navigation/index.js";
  import type { FeatureDescriptor } from "./shared/feature-registry/index.js";
  import {
    chatPanelForOutput,
    outputForChatPanel,
    restoreOutputTabs,
    navigateOutputTab,
    keepOutputTab,
    newOutputTab,
    type OutputTabState,
    closeOutputTab,
    lastOutputAfterClose,
    type ChatPanelRoute,
    type OutputId,
    type OutputRoute,
  } from "./shared/output-tabs/index.js";
  import {
    initialLayout,
    chooseOutput,
    routeWorkspaceLayout,
    splitMetrics,
    dragWorkspaceSplit,
    keyboardWorkspaceSplit,
    beginPanelResize,
    type WorkspaceLayout,
    DEFAULT_OUTPUT_RATIO,
    DEFAULT_NAV_WIDTH,
    DEFAULT_INSPECTOR_WIDTH,
    NAV_HANDLE_WIDTH,
  } from "$shared/workspace-layout/index.js";
  let {
    displayName,
    labels: labelOverrides = {},
    launcher,
    chatPanels = [],
    settingsMenu = {},
    fileMenuViews = [],
    canvasPresentation = {},
    menuContributions = {},
    sections,
    auxiliaryViews,
    railViews,
    runtime,
    onConnectionSettings,
    persistence,
    installIntegration,
    backendSelection = defaultBackendSelection,
    hostedGate: HostedGate,
    runtimeControls: RuntimeControls,
    siteHeader: SiteHeader,
    settingsWindow: SettingsWindow,
    workspaceLauncher: WorkspaceLauncher,
    chat: Chat,
    approval,
    chatPresentation,
    chatAppearance,
    chatUI,
  }: {
    displayName: string;
    labels?: Partial<WorkspaceLabels>;
    launcher: {
      id?: string;
      quick: readonly string[];
      suggested: readonly string[];
      recentLabel: string;
    };
    chatPanels?: readonly ChatPanelRoute[];
    settingsMenu?: { primary?: string; integrations?: string; help?: string; setup?: string };
    fileMenuViews?: readonly {
      id: string;
      label: string;
      command?: string;
      shortcut?: string;
      binding?: WorkspaceMenuBinding;
    }[];
    menuContributions?: Partial<
      Record<"file" | "edit" | "view" | "help", readonly WorkspaceMenuItem[]>
    >;
    canvasPresentation?: { selfHeaderIds?: readonly string[]; hideComputeIds?: readonly string[] };
    sections: readonly FeatureDescriptor<Component<any>>[];
    auxiliaryViews: readonly FeatureDescriptor<Component<any>>[];
    railViews: readonly OutputRoute[];
    runtime: WorkspaceRuntimeAdapter;
    onConnectionSettings?: () => void;
    persistence: WorkspacePersistence;
    installIntegration?: WorkspaceIntegration;
    backendSelection?: WorkspaceBackendSelection;
    hostedGate?: WorkspaceGateComponent;
    runtimeControls?: WorkspaceRuntimeControlsComponent;
    siteHeader?: WorkspaceHeaderComponent;
    settingsWindow?: WorkspaceSettingsComponent;
    workspaceLauncher?: WorkspaceLauncherComponent;
    chat: WorkspaceChatComponent;
    approval?: ApprovalControlConfig;
    chatPresentation?: WorkspaceChatPresentation;
    chatAppearance?: WorkspaceChatAppearance;
    chatUI?: WorkspaceChatUIConfig;
  } = $props();
  let labels = $derived(resolveWorkspaceLabels(labelOverrides));
  setContext("workspace-output-panel", true);

  let resourceHeaders = $state<Record<string, WorkspaceResourceHeader>>({});
  let resourceNotice = $state("");
  const resourceContext: WorkspaceResourceContext = {
    register(id, header) {
      resourceHeaders = { ...resourceHeaders, [id]: header };
      return () => {
        if (resourceHeaders[id] !== header) return;
        const next = { ...resourceHeaders };
        delete next[id];
        resourceHeaders = next;
      };
    },
  };
  setContext(WORKSPACE_RESOURCE_CONTEXT, resourceContext);
  let resourceRequest = 0;
  async function openResource(id: string, command?: string) {
    await go(id);
    const request = ++resourceRequest;
    if (!command || disposed || layout.output !== id) return;
    // Wait for a lazily loaded view to register; this never sends a file to the runtime.
    for (let attempt = 0; attempt < 80; attempt++) {
      if (disposed || request !== resourceRequest || layout.output !== id) return;
      const action = resourceHeaders[id]?.commands?.[command];
      if (action) {
        try {
          action();
        } catch {
          resourceNotice = labels.resourceCommandUnavailable;
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!disposed && request === resourceRequest && layout.output === id)
      resourceNotice = labels.resourceCommandUnavailable;
  }
  function toggleSidebar() {
    if (viewportWidth > 1100) navigationCollapsed = !navigationCollapsed;
    else {
      if (split.mode === "stacked") focusedPane = "chat";
      menuOpen = !menuOpen;
    }
  }
  async function switchPane() {
    if (!layout.output) return;
    outputExpanded = false;
    focusedPane = focusedPane === "chat" ? "output" : "chat";
    await tick();
    if (focusedPane === "chat") {
      // The chat region can still be `display: none` (stacked mode with the output filling the
      // pane), and focusing a hidden node drops the user on `<body>`. Same fallback as the skip
      // link: reopen chat instead of focusing nothing.
      if (chatRegionVisible) focusChatComposer();
      else void go("chat");
      return;
    }
    const tab = document.getElementById(`output-tab-${layout.output}`);
    (tab ?? document.getElementById("workspace"))?.focus({ preventScroll: true });
  }
  function stepTab(direction: -1 | 1) {
    if (!openTabs.length) return;
    const index = openTabs.indexOf(layout.output ?? "");
    go(openTabs[(index + direction + openTabs.length) % openTabs.length]);
  }
  function stepSidebar(direction: -1 | 1) {
    if (!RAIL.length) return;
    const index = RAIL.findIndex((item) => item.id === (layout.output ?? "chat"));
    go(RAIL[(index + direction + RAIL.length) % RAIL.length].id);
  }
  let editing = $state<ReturnType<typeof captureEditCommands>>();
  function isMenubarTarget(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      !!target.closest(".workspace-menubar, .workspace-menubar-content")
    );
  }
  function captureEditing() {
    const target = document.activeElement;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.matches("input, textarea"))
    )
      editing = captureEditCommands(document);
    else if (!isMenubarTarget(target)) editing = undefined;
  }
  function clearEditingOutside(event: PointerEvent) {
    const target = event.target;
    if (
      isMenubarTarget(target) ||
      (target instanceof HTMLElement &&
        (target.isContentEditable || !!target.closest("input, textarea, [contenteditable='true']")))
    )
      return;
    editing = undefined;
  }
  let editRows = $derived<readonly [WorkspaceEditCommand, string, string][]>([
    ["undo", labels.undo, "Ctrl+Z"],
    ["redo", labels.redo, "Ctrl+Y"],
    ["cut", labels.cut, "Ctrl+X"],
    ["copy", labels.copy, "Ctrl+C"],
    ["paste", labels.paste, "Ctrl+V"],
    ["delete", labels.delete, "Delete"],
    ["selectAll", labels.selectAll, "Ctrl+A"],
  ]);
  let shortcutsOpen = $state(false);
  let fullscreen = $state(false);
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document
        .querySelector<HTMLElement>(".workspace-host")
        ?.requestFullscreen()
        .catch(() => {
          resourceNotice = labels.fullscreenUnavailable;
        });
  }
  let desktopMenus = $derived.by<WorkspaceMenuGroup[]>(() => [
    {
      id: "file",
      label: labels.menuFile,
      width: 240,
      items: [
        ...(menuContributions.file ?? []),
        {
          id: "new-chat",
          label: labels.newChat,
          shortcut: "Ctrl+N",
          binding: { key: "n", ctrl: true, allowInEditable: true },
          onSelect: () => {
            void go("chat");
            void chatView?.newConversation();
          },
        },
        ...fileMenuViews
          .filter((item) => TOOLS.includes(item.id))
          .map((item, index) => ({
            id: `open-${item.id}-${index}`,
            label: item.label,
            shortcut: item.shortcut,
            binding: item.binding,
            separatorBefore: index === 0,
            onSelect: () => {
              void openResource(item.id, item.command);
            },
          })),
        ...(layout.output
          ? [
              {
                id: "close",
                label: labels.close,
                separatorBefore: true,
                shortcut: "Ctrl+W",
                binding: { key: "w", ctrl: true, allowInEditable: true },
                onSelect: () => {
                  if (layout.output) void closeTab(layout.output);
                },
              },
            ]
          : []),
      ],
    },
    {
      id: "edit",
      label: labels.menuEdit,
      width: 224,
      items: [
        ...editRows.map(([id, label, shortcut]) => ({
          id,
          label,
          shortcut,
          separatorBefore: id === "cut" || id === "selectAll",
          disabled: !editing?.isEnabled(id),
          onSelect: () => {
            editing?.execute(id);
          },
        })),
        ...(isSettings(settingsMenu.primary)
          ? [
              {
                id: "settings",
                label: labels.settingsMenu,
                separatorBefore: true,
                shortcut: "Ctrl+,",
                binding: { key: ",", ctrl: true, allowInEditable: true },
                onSelect: () => openSettingsSection(settingsMenu.primary ?? ""),
              },
            ]
          : []),
        ...(menuContributions.edit ?? []),
      ],
    },
    {
      id: "view",
      label: labels.menuView,
      width: 302,
      items: [
        {
          id: "sidebar",
          label: labels.toggleSidebarMenu,
          shortcut: "Ctrl+Shift+S",
          binding: { key: "S", ctrl: true, shift: true, allowInEditable: true },
          onSelect: toggleSidebar,
        },
        ...(CANVAS_TOOLS.length
          ? [
              {
                id: "output",
                label: labels.toggleOutputPanel,
                shortcut: "Ctrl+J",
                binding: { key: "j", ctrl: true, allowInEditable: true },
                onSelect: toggleOutput,
              },
              {
                id: "switch-pane",
                label: labels.switchChatTabs,
                shortcut: "Alt+Ctrl+B",
                binding: { key: "b", ctrl: true, alt: true, allowInEditable: true },
                disabled: !layout.output,
                onSelect: () => {
                  void switchPane();
                },
              },
            ]
          : []),
        ...(exploreMenu.length > 1
          ? [
              {
                id: "tools",
                label: labels.tools,
                separatorBefore: true,
                children: exploreMenu.filter(
                  (item) => item.id !== "chat" && item.id !== "toggle-output",
                ),
              },
            ]
          : []),
        {
          id: "theme",
          label: labels.toggleTheme,
          separatorBefore: true,
          onSelect: toggleTheme,
        },
        {
          id: "find",
          label: labels.findChats,
          separatorBefore: true,
          shortcut: "Ctrl+F",
          binding: { key: "f", ctrl: true },
          onSelect: findChats,
        },
        {
          id: "focus-message",
          label: labels.focusMessage,
          onSelect: async () => {
            outputExpanded = false;
            focusedPane = "chat";
            await tick();
            focusChatComposer();
          },
        },
        {
          id: "back",
          label: labels.back,
          separatorBefore: true,
          shortcut: "Ctrl+[",
          binding: { key: "[", ctrl: true },
          disabled: trail.index <= 0,
          onSelect: () => historyStep(-1),
        },
        {
          id: "forward",
          label: labels.forward,
          shortcut: "Ctrl+]",
          binding: { key: "]", ctrl: true },
          disabled: trail.index >= trail.entries.length - 1,
          onSelect: () => historyStep(1),
        },
        {
          id: "previous-sidebar",
          label: labels.previousSidebarItem,
          separatorBefore: true,
          shortcut: "Alt+Ctrl+[",
          binding: { key: "[", ctrl: true, alt: true },
          onSelect: () => stepSidebar(-1),
        },
        {
          id: "next-sidebar",
          label: labels.nextSidebarItem,
          shortcut: "Alt+Ctrl+]",
          binding: { key: "]", ctrl: true, alt: true },
          onSelect: () => stepSidebar(1),
        },
        ...(openTabs.length
          ? [
              {
                id: "previous-tab",
                label: labels.previousTab,
                separatorBefore: true,
                shortcut: "Ctrl+Shift+[",
                binding: { key: "{", ctrl: true, shift: true },
                onSelect: () => stepTab(-1),
              },
              {
                id: "next-tab",
                label: labels.nextTab,
                shortcut: "Ctrl+Shift+]",
                binding: { key: "}", ctrl: true, shift: true },
                onSelect: () => stepTab(1),
              },
            ]
          : []),
        {
          id: "fullscreen",
          label: fullscreen ? labels.exitFullscreen : labels.toggleFullscreen,
          separatorBefore: true,
          shortcut: "F11",
          binding: { key: "F11", allowInEditable: true },
          onSelect: toggleFullscreen,
        },
        ...(menuContributions.view ?? []),
      ],
    },
    {
      id: "help",
      label: labels.menuHelp,
      width: 240,
      items: [
        {
          id: "shortcuts",
          label: labels.keyboardShortcuts,
          shortcut: "Ctrl+/",
          binding: { key: "/", ctrl: true, allowInEditable: true },
          onSelect: () => {
            rememberMenuTrigger();
            shortcutsOpen = true;
          },
        },
        ...(isSettings(settingsMenu.help)
          ? [
              {
                id: "help",
                label: labels.helpAndLimits,
                separatorBefore: true,
                onSelect: () => openSettingsSection(settingsMenu.help ?? ""),
              },
            ]
          : []),
        ...(isSettings(settingsMenu.setup)
          ? [
              {
                id: "setup",
                label: labels.troubleshooting,
                onSelect: () => openSettingsSection(settingsMenu.setup ?? ""),
              },
            ]
          : []),
        ...(menuContributions.help ?? []),
      ],
    },
  ]);

  let contextualOutputs = $state<{ id: string; viewId: string; origin: WorkspaceOutputOrigin }[]>(
    [],
  );
  let outputSequence = 0;
  let BASE_OUTPUTS = $derived(
    [...sections, ...auxiliaryViews].filter(
      (section) =>
        section.id !== "chat" &&
        (SettingsWindow ||
          (section.placement !== "settings" && section.navigationRole !== "settings")) &&
        (typeof section.loadScreen === "function" ||
          (WorkspaceLauncher && section.id === launcher.id) ||
          (SettingsWindow && chatPanels.some((route) => route.id === section.id))),
    ),
  );
  let OUTPUTS = $derived([
    ...BASE_OUTPUTS,
    ...contextualOutputs.flatMap((item) => {
      const base = BASE_OUTPUTS.find(
        (row) => row.id === item.viewId && typeof row.loadScreen === "function",
      );
      return base
        ? [
            {
              ...base,
              id: item.id,
              label: `${item.origin.label} · ${base.label}`,
              placement: "canvas" as const,
            },
          ]
        : [];
    }),
  ]);
  function outputOrigin(id: string) {
    return contextualOutputs.find((item) => item.id === id)?.origin;
  }
  function openComparisonOutput(viewId: string, origin: WorkspaceOutputOrigin) {
    if (
      !BASE_OUTPUTS.some((row) => row.id === viewId && typeof row.loadScreen === "function") ||
      !origin ||
      typeof origin.id !== "string" ||
      !origin.id ||
      origin.id.length > 512 ||
      typeof origin.label !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(origin.color)
    )
      return;
    const previous = contextualOutputs.find(
      (item) => item.viewId === viewId && item.origin.id === origin.id,
    );
    if (!previous && contextualOutputs.length >= 24) {
      resourceNotice = labels.outputLimitReached;
      return;
    }
    const id = previous?.id ?? `comparison-${++outputSequence}-${viewId}`;
    const item = {
      id,
      viewId,
      origin: {
        ...origin,
        label: origin.label.slice(0, 120),
        ...(origin.result === undefined && previous?.origin.result !== undefined
          ? { result: previous.origin.result }
          : {}),
      },
    };
    contextualOutputs = previous
      ? contextualOutputs.map((row) => (row.id === id ? item : row))
      : [...contextualOutputs, item];
    go(id).then(() => keepTab(id));
  }
  let TOOLS = $derived<OutputId[]>(OUTPUTS.map((section) => section.id as OutputId));
  let SECTION_IDS = $derived<OutputRoute[]>(["chat", ...TOOLS]);
  let RAIL = $derived(
    configuredNavigation([...sections, ...auxiliaryViews], railViews).filter(
      (item) => item.id === "chat" || OUTPUTS.some((output) => output.id === item.id),
    ),
  );
  let exploreMenu = $derived.by<WorkspaceMenuItem[]>(() => [
    { id: "chat", label: labels.chat, icon: "message", onSelect: () => go("chat") },
    ...(CANVAS_TOOLS.length
      ? [{ id: "toggle-output", label: labels.toggleOutputPanel, onSelect: toggleOutput }]
      : []),
    ...(launcher.id && TOOLS.includes(launcher.id) && !isSettings(launcher.id)
      ? [
          {
            id: "launcher",
            label: labels.openTools,
            icon: "grid",
            onSelect: () => launcher.id && go(launcher.id),
          },
        ]
      : []),
    ...(OUTPUTS.some((item) => item.navigationRole === "explore")
      ? [
          {
            id: "explore",
            label: labels.explore,
            icon: "sparkles",
            children: OUTPUTS.filter((item) => item.navigationRole === "explore").map((item) => ({
              id: item.id,
              label: item.label,
              icon: item.icon,
              onSelect: () => go(item.id),
            })),
          },
        ]
      : []),
  ]);
  function hasFeatureScreen(id: string): boolean {
    // The host launcher owns its route even if its descriptor also has a loader.
    if (WorkspaceLauncher && id === launcher.id) return false;
    return OUTPUTS.some((view) => view.id === id && typeof view.loadScreen === "function");
  }
  async function loadFeatureScreen(id: string): Promise<Component<any>> {
    const view = OUTPUTS.find((item) => item.id === id);
    if (!view?.loadScreen) throw new Error("Unknown workspace view");
    return (await view.loadScreen()).default;
  }
  /**
   * The panel a tab controls, or `undefined` when no such node is mounted. Chat panels live in the
   * settings window and a screen without a loader has no panel at all; pointing `aria-controls`
   * at a missing id is worse than omitting it.
   */
  function panelIdFor(id: OutputId): string | undefined {
    const mounted =
      (!!WorkspaceLauncher && id === launcher.id && TOOLS.includes(id)) ||
      (hasFeatureScreen(id) && openTabs.includes(id));
    return mounted ? `output-panel-${id}` : undefined;
  }
  let layout = $state<WorkspaceLayout<OutputRoute>>({
    output: null,
    lastOutput: null,
    outputRatio: DEFAULT_OUTPUT_RATIO,
    navWidth: DEFAULT_NAV_WIDTH,
    inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
  });
  let hydrated = $state(false);
  let workspaceActive = $state(true);
  let menuOpen = $state(false);
  let navigationCollapsed = $state(false);
  let chatView = $state<WorkspaceChatHandle>();
  const chatRegionId = $props.id();
  let chatRegion: HTMLDivElement;
  function focusChatComposer() {
    chatView?.focusComposer?.();
    if (chatRegion && !chatRegion.contains(document.activeElement)) chatRegion.focus();
  }
  let settingsOpen = $state(false);
  let settingsView = $state("");
  let settingsWasOpen = false;
  $effect(() => {
    if (settingsWasOpen && !settingsOpen)
      untrack(() => {
        chatView?.openPanel("", false);
        restoreOverlayFocus();
      });
    settingsWasOpen = settingsOpen;
  });
  let chatPanelContent = $state<Snippet>();
  let trail = $state<NavigationTrail>({ entries: ["chat"], index: 0 });
  let focusedPane = $state<"chat" | "output">("chat");
  /**
   * A dialog opened from a menubar item or the rail user menu outlives the item that opened it,
   * so the trigger has to be remembered while the menu is still on screen; otherwise bits-ui
   * restores focus into a detached item and it lands on `<body>`.
   */
  let overlayReturnFocus: HTMLElement | null = null;
  function rememberMenuTrigger() {
    const trigger = document.querySelector<HTMLElement>(
      "[data-state='open'].workspace-menubar-trigger, [data-state='open'].user-menu-trigger",
    );
    if (trigger) overlayReturnFocus = trigger;
  }
  /** Only claims focus when the closing overlay left it on `<body>`. */
  function restoreOverlayFocus() {
    const target = overlayReturnFocus;
    overlayReturnFocus = null;
    if (!(target instanceof HTMLElement) || !target.isConnected) return;
    // bits-ui moves focus after this point, so read the result on the next frame.
    requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      if (!target.isConnected || !target.getClientRects().length) return;
      if (target.matches(":disabled")) return;
      target.focus({ preventScroll: true });
    });
  }
  /** Same intent, for a dialog that reports the moment focus is about to be returned. */
  function restoreOverlayFocusNow(event: Event) {
    const target = overlayReturnFocus;
    overlayReturnFocus = null;
    if (!(target instanceof HTMLElement) || !target.isConnected) return;
    if (!target.getClientRects().length || target.matches(":disabled")) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  }
  let tabSearch = $state("");
  let tabListOpen = $state(false);
  let openTabs = $state<OutputId[]>([]);
  let keptTabs = $state<OutputId[]>([]);
  let viewportWidth = $state(0);
  let paneWidth = $state(0);
  let visited = $state<OutputId[]>([]);
  /**
   * A view mounts on first visit and stays mounted while its tab is open. `visited` is the
   * seen-set; intersecting it with the tab strip is what unmounts a closed panel, so
   * `aria-labelledby="output-tab-<id>"` can never point at a removed tab.
   */
  const mountedPanels = $derived(visited.filter((id) => openTabs.includes(id)));
  let backends = $state<any[]>([]);
  let backend = $state("");
  let chatBackend = $state("");
  let comparison = $state(false);
  let compareBackends = $state<string[]>([]);
  let compareInitialized = false;
  let releaseResize: (() => void) | undefined;
  let connection = $state<"checking" | "online" | "offline">("checking");
  let connectionError = $state("");
  /**
   * A backend can answer every request from inside the page. The shell used to paint that as
   * "Connected" and the screen claimed a link that does not exist; this is the fact every
   * connection label is derived from.
   */
  let stubConnection = $derived(
    backends.length > 0 && backends.every((row) => (row as { stub?: boolean }).stub === true),
  );
  let meta = $derived(OUTPUTS.find((section) => section.id === layout.output));
  let chatOutput = $derived(chatPanels.some((route) => route.id === layout.output));
  let SETTINGS = $derived(
    SettingsWindow
      ? OUTPUTS.filter((row) => row.placement === "settings" || row.navigationRole === "settings")
      : [],
  );
  function isSettings(id: string | null | undefined): boolean {
    return SETTINGS.some((row) => row.id === id);
  }
  let CANVAS_TOOLS = $derived(TOOLS.filter((id) => !isSettings(id)));
  $effect(() => {
    const available = CANVAS_TOOLS;
    untrack(() => {
      const validTabs = openTabs.filter((id) => available.includes(id));
      if (validTabs.length !== openTabs.length) openTabs = validTabs;
      const validKept = keptTabs.filter((id) => validTabs.includes(id));
      if (validKept.length !== keptTabs.length) keptTabs = validKept;
      if (layout.output && !available.includes(layout.output as OutputId))
        layout = { ...layout, output: null, lastOutput: null };
      else if (layout.lastOutput && !available.includes(layout.lastOutput as OutputId))
        layout = { ...layout, lastOutput: null };
      if (settingsOpen && !isSettings(settingsView)) settingsOpen = false;
    });
  });
  let mountedHash = "";
  let deepLinkSettled = false;
  /**
   * A deep link can name a view the registry had not resolved yet: the host turns the stored tool
   * selection on after mount, so the first `initialLayout` ran against a smaller id set and
   * dropped the request while the URL kept it. Retry once, as soon as that id exists; the effect
   * depends on the id set only, so it cannot loop.
   */
  $effect(() => {
    if (!hydrated || deepLinkSettled) return;
    const sections = SECTION_IDS;
    if (!mountedHash || !sections.includes(mountedHash as OutputRoute)) return;
    untrack(() => {
      deepLinkSettled = true;
      if ((layout.output ?? "chat") !== mountedHash) syncHash();
    });
  });
  function migrateSettingsRoute() {
    const requested = layout.output;
    if (requested && isSettings(requested)) {
      layout = { ...layout, output: null, lastOutput: null };
      window.history.replaceState(window.history.state, "", "#chat");
      tick().then(() => openSettingsSection(requested));
    } else if (layout.lastOutput && isSettings(layout.lastOutput)) {
      layout = { ...layout, lastOutput: null };
    }
  }
  function openSettingsSection(id: string) {
    if (!isSettings(id)) return;
    rememberMenuTrigger();
    settingsView = id;
    if (chatPanels.some((route) => route.id === id))
      chatView?.openPanel(chatPanelForOutput(id, chatPanels), false);
    settingsOpen = true;
  }
  async function findChats() {
    if (viewportWidth > 1100) navigationCollapsed = false;
    else {
      if (split.mode === "stacked") focusedPane = "chat";
      menuOpen = true;
    }
    await tick();
    await chatView?.focusSessionSearch();
  }
  let split = $derived(
    splitMetrics(
      paneWidth,
      layout.outputRatio,
      viewportWidth > 1100 && !navigationCollapsed ? layout.navWidth + NAV_HANDLE_WIDTH : 0,
      !!layout.output,
    ),
  );

  async function connectedWorkspace() {
    layout = initialLayout(window.location.hash, persistence.loadLayout(TOOLS), SECTION_IDS);
    migrateSettingsRoute();
    applyTabs(
      restoreOutputTabs(
        persistence.readDraft("desktop-output-tabs-v2", null),
        (layout.output ?? layout.lastOutput) as OutputId | null,
        CANVAS_TOOLS,
        launcher.id ?? null,
      ),
    );
    navigationCollapsed =
      persistence.readDraft<boolean>("desktop-navigation-collapsed", false) === true;
    backend = "";
    chatBackend = "";
    compareInitialized = false;
    remember();
    await reload();
  }
  let discoveryGeneration = 0;
  let disposed = false;
  async function reload() {
    const generation = ++discoveryGeneration;
    if (!runtime.connection().connected) {
      connection = "offline";
      connectionError = "";
      backends = [];
      return;
    }
    try {
      const discovered = await runtime.listBackends();
      if (disposed || generation !== discoveryGeneration) return;
      if (!runtime.connection().connected) {
        connection = "offline";
        connectionError = "";
        backends = [];
        return;
      }
      backends = discovered;
      if (!compareInitialized) {
        compareBackends = initialCompare(backends, backendSelection.defaultCompareIds);
        compareInitialized = true;
      }
      if (!backend || !chatBackend) {
        const { backend: saved, chatBackend: savedChat } = persistence.readBackends();
        if (!backend) backend = initialBackend(backends, saved);
        if (!chatBackend)
          chatBackend = initialBackend(backends, savedChat, backendSelection.chatEligible);
      }
      connection = "online";
      connectionError = "";
    } catch (e) {
      if (disposed || generation !== discoveryGeneration) return;
      backends = [];
      connection = "offline";
      connectionError = e instanceof Error ? e.message : labels.connectionFailed;
    }
  }
  function applyTabs(state: OutputTabState) {
    openTabs = state.tabs;
    keptTabs = state.kept;
  }
  /**
   * `visited` is the seen-set; `mountedPanels` intersects it with the tab strip, so a closed tab
   * unmounts its panel and no `aria-labelledby="output-tab-<id>"` can outlive its tab.
   */
  function remember(previous: OutputId | null = null) {
    const output = layout.output === "chat" ? null : layout.output;
    if (output && !visited.includes(output)) visited = [...visited, output];
    applyTabs(
      navigateOutputTab(
        { tabs: openTabs, kept: keptTabs },
        output as OutputId | null,
        previous,
        CANVAS_TOOLS,
        launcher.id ?? null,
      ),
    );
  }
  function syncHash() {
    const requested = window.location.hash.slice(1);
    if (requested !== layout.output) {
      resourceRequest++;
      resourceNotice = "";
    }
    if (isSettings(requested)) {
      openSettingsSection(requested);
      window.location.hash = layout.output ?? "chat";
      return;
    }
    const previous = (layout.output ?? layout.lastOutput) as OutputId | null;
    layout = routeWorkspaceLayout(window.location.hash, layout, SECTION_IDS);
    remember(previous);
    chatView?.openPanel(chatPanelForOutput(layout.output, chatPanels), false);
    trail = visitRoute(trail, layout.output ?? "chat", SECTION_IDS);
    focusedPane = layout.output ? "output" : "chat";
  }
  let previousSplitMode = "";
  $effect(() => {
    const mode = split.mode;
    if (mode === "stacked" && previousSplitMode !== mode) {
      untrack(() => {
        const target = document.activeElement;
        if (target?.closest(".desktop-chat")) focusedPane = "chat";
        else if (target?.closest(".desktop-output")) focusedPane = "output";
      });
    }
    previousSplitMode = mode;
  });
  let outputExpanded = $state(false);
  const regions = $derived(visibleRegions(!!layout.output, split.mode === "stacked", focusedPane));
  /** True when the chat region is on screen; `display: none` there makes `.focus()` a no-op. */
  const chatRegionVisible = $derived(regions.chat && !(outputExpanded && !!layout.output));
  const outputRegionVisible = $derived(regions.output || (outputExpanded && !!layout.output));
  async function go(id: OutputRoute, track = true) {
    resourceRequest++;
    resourceNotice = "";
    if (id === "chat") outputExpanded = false;
    if (!SECTION_IDS.includes(id)) return;
    if (isSettings(id)) {
      openSettingsSection(id);
      return;
    }
    settingsOpen = false;
    const previous = (layout.output ?? layout.lastOutput) as OutputId | null;
    layout = chooseOutput(id, layout, SECTION_IDS);
    remember(previous);
    menuOpen = false;
    if (track) trail = visitRoute(trail, id, SECTION_IDS);
    focusedPane = id === "chat" ? "chat" : "output";
    tabListOpen = false;
    chatView?.openPanel(chatPanelForOutput(id, chatPanels), false);
    if (window.location.hash !== `#${id}`) window.location.hash = id;
    if (id === "chat") {
      await tick();
      focusChatComposer();
    } else {
      await tick();
      document
        .getElementById(`output-tab-${id}`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (split.mode === "stacked") document.getElementById(`output-tab-${id}`)?.focus();
    }
  }
  function keepTab(id: OutputId) {
    applyTabs(
      keepOutputTab({ tabs: openTabs, kept: keptTabs }, id, CANVAS_TOOLS, launcher.id ?? null),
    );
  }
  async function addTab() {
    if (!launcher.id || !CANVAS_TOOLS.includes(launcher.id)) return;
    applyTabs(
      newOutputTab(
        { tabs: openTabs, kept: keptTabs },
        (layout.output ?? layout.lastOutput) as OutputId | null,
        CANVAS_TOOLS,
        launcher.id,
      ),
    );
    await go(launcher.id);
    await tick();
    document.getElementById(`output-tab-${launcher.id}`)?.focus({ preventScroll: true });
  }
  function historyStep(direction: -1 | 1) {
    trail = stepRoute(trail, direction);
    go(trail.entries[trail.index] as OutputRoute, false);
  }
  function toggleOutput() {
    const next = layout.output
      ? "chat"
      : (layout.lastOutput ??
        (launcher.id && CANVAS_TOOLS.includes(launcher.id) ? launcher.id : CANVAS_TOOLS[0]) ??
        "chat");
    go(next);
  }
  function openChatPanel(panel: string) {
    const output = outputForChatPanel(panel, chatPanels);
    if (output && isSettings(output)) {
      settingsView = output;
      settingsOpen = true;
    } else settingsOpen = false;
  }
  async function closeTab(id: OutputId) {
    const closedTabHadFocus = document
      .getElementById(`output-tab-${id}`)
      ?.parentElement?.contains(document.activeElement);
    const result = closeOutputTab(
      openTabs,
      layout.output === "chat" ? null : layout.output,
      id,
      CANVAS_TOOLS,
    );
    applyTabs({ tabs: result.tabs, kept: keptTabs.filter((item) => result.tabs.includes(item)) });
    // Also drop the id from the seen-set so a closed view is not remembered forever.
    if (visited.includes(id)) visited = visited.filter((item) => item !== id);
    layout = {
      ...layout,
      lastOutput: lastOutputAfterClose(
        layout.lastOutput as OutputId | null,
        result.tabs,
        result.output,
      ),
    };
    if (layout.output === id) {
      await go(result.output ?? "chat");
      await tick();
      if (result.output) document.getElementById(`output-tab-${result.output}`)?.focus();
    } else if (closedTabHadFocus && result.output) {
      await tick();
      document.getElementById(`output-tab-${result.output}`)?.focus();
    }
  }
  async function tabKey(event: KeyboardEvent, id: OutputId) {
    const index = openTabs.indexOf(id);
    if (event.key === "Delete") {
      event.preventDefault();
      closeTab(id);
      return;
    }
    // Keep/close are pointer-only buttons inside the tablist; these two shortcuts are the
    // keyboard route to the same actions without adding tab stops.
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      keepTab(id);
      return;
    }
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % openTabs.length
        : event.key === "ArrowLeft"
          ? (index + openTabs.length - 1) % openTabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? openTabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = openTabs[next];
    await go(target);
    await tick();
    document.getElementById(`output-tab-${target}`)?.focus();
  }
  function pick(id: string) {
    backend = id;
    if (backendSelection.persistBackend(id)) {
      persistence.saveBackend("backend", id);
    }
  }
  function pickChat(id: string) {
    if (!backendSelection.chatSelectable(id, backends)) return;
    chatBackend = id;
    persistence.saveBackend("chatBackend", id);
  }
  function compare(enabled: boolean, ids = compareBackends) {
    comparison = enabled;
    compareBackends = ids;
  }
  function resize(event: PointerEvent) {
    if (event.button !== 0 || split.mode !== "split") return;
    releaseResize?.();
    const ratio = split.outputRatio,
      width = split.contentWidth;
    releaseResize = beginPanelResize(event, (deltaX) => {
      layout = { ...layout, outputRatio: dragWorkspaceSplit(ratio, deltaX, width) };
    });
  }
  function resizeKey(event: KeyboardEvent) {
    const ratio = keyboardWorkspaceSplit(
      event.key,
      split.outputRatio,
      split.contentWidth,
      event.shiftKey,
    );
    if (ratio === null) return;
    event.preventDefault();
    layout = { ...layout, outputRatio: ratio };
  }
  onMount(() => {
    disposed = false;
    mountedHash = window.location.hash.slice(1);
    layout = initialLayout(window.location.hash, persistence.loadLayout(TOOLS), SECTION_IDS);
    migrateSettingsRoute();
    applyTabs(
      restoreOutputTabs(
        persistence.readDraft("desktop-output-tabs-v2", null),
        (layout.output ?? layout.lastOutput) as OutputId | null,
        CANVAS_TOOLS,
        launcher.id ?? null,
      ),
    );
    navigationCollapsed =
      persistence.readDraft<boolean>("desktop-navigation-collapsed", false) === true;
    trail = visitRoute(trail, layout.output ?? "chat", SECTION_IDS);
    focusedPane = layout.output ? "output" : "chat";
    hydrated = true;
    remember();
    chatView?.openPanel(chatPanelForOutput(layout.output, chatPanels), false);
    reload();
    window.addEventListener("hashchange", syncHash);
    const disposeIntegration = installIntegration?.({
      views: () => [{ id: "chat", label: labels.chat, group: labels.workspace }, ...OUTPUTS],
      workspace: () => ({
        activeView: settingsOpen ? settingsView : (layout.output ?? "chat"),
        openViews: openTabs,
      }),
      navigate: (id) => go(id as OutputRoute),
    });
    const timer = window.setInterval(reload, 30000);
    const removeShortcuts = registerMenuShortcuts(window, () =>
      desktopMenus.flatMap((menu) => [...menu.items]),
    );
    document.addEventListener("selectionchange", captureEditing);
    document.addEventListener("focusin", captureEditing);
    document.addEventListener("pointerdown", clearEditingOutside, true);
    const fullscreenChanged = () => {
      fullscreen = !!document.fullscreenElement;
    };
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () => {
      disposed = true;
      resourceRequest++;
      discoveryGeneration++;
      removeShortcuts();
      document.removeEventListener("selectionchange", captureEditing);
      document.removeEventListener("focusin", captureEditing);
      document.removeEventListener("pointerdown", clearEditingOutside, true);
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      releaseResize?.();
      disposeIntegration?.();
      clearInterval(timer);
      window.removeEventListener("hashchange", syncHash);
    };
  });
  $effect(() => {
    if (hydrated) {
      persistence.saveLayout(layout, SECTION_IDS);
      persistence.saveDraft("desktop-navigation-collapsed", navigationCollapsed);
      persistence.saveDraft("desktop-output-tabs-v2", {
        version: 2,
        tabs: openTabs,
        kept: keptTabs,
      });
    }
  });
  $effect(() => {
    if (viewportWidth > 1100) menuOpen = false;
  });
</script>

<svelte:window bind:innerWidth={viewportWidth} />
{#snippet workspaceContent()}
  <a
    class="skip-link"
    href={`#${chatRegionId}`}
    onclick={(event) => {
      event.preventDefault();
      // The chat region is display:none whenever the output panel fills the view, so focusing it
      // directly would drop the user on <body>. Fall back to the same path the Chat rail takes.
      if (chatRegionVisible) focusChatComposer();
      else void go("chat");
    }}>{labels.skipToChat}</a
  >
  <div class="workspace-host">
    <header class="workspace-titlebar" aria-label={labels.workspaceNavigation}>
      <button
        aria-label={labels.backInWorkspace}
        title={labels.back}
        disabled={trail.index <= 0}
        onclick={() => historyStep(-1)}><Icon name="back" size={17} /></button
      >
      <button
        aria-label={labels.forwardInWorkspace}
        title={labels.forward}
        disabled={trail.index >= trail.entries.length - 1}
        onclick={() => historyStep(1)}><Icon name="forward" size={17} /></button
      >
      <button
        id="sidebar-toggle"
        aria-label={viewportWidth > 1100
          ? navigationCollapsed
            ? labels.showSidebar
            : labels.hideSidebar
          : labels.openNavigation}
        title={labels.toggleSidebar}
        aria-controls="chat-sessions"
        aria-expanded={viewportWidth > 1100 ? !navigationCollapsed : menuOpen}
        onclick={toggleSidebar}><Icon name="sidebar" size={17} /></button
      >
      <WorkspaceMenubar menus={desktopMenus} onBeforeOpen={captureEditing} />
      {#if runtime.connection().hosted && onConnectionSettings}<button
          class="titlebar-connection"
          onclick={onConnectionSettings}>{labels.hostedConnection}</button
        >{:else}
        <span class="titlebar-status" role="status"
          >{connection === "online"
            ? stubConnection
              ? labels.stubTooltip
              : labels.statusOnline
            : connection === "checking"
              ? labels.statusConnecting
              : labels.statusOffline}</span
        >{/if}
    </header>
    <div class="desktop-shell reference-desktop">
      <nav class="desktop-rail" aria-label={labels.appShortcuts}>
        {#each RAIL as item (item.id)}
          <button
            aria-label={item.label}
            title={item.label}
            aria-current={(item.id === "chat" ? !layout.output : layout.output === item.id)
              ? "page"
              : undefined}
            class:rail-active={item.id === "chat" ? !layout.output : layout.output === item.id}
            onclick={() => go(item.id as OutputRoute)}><Icon name={item.icon} size={18} /></button
          >
        {/each}
        {#if OUTPUTS.some((row) => row.navigationRole === "explore")}<div
            class="rail-separator"
          ></div>
          <DropdownMenu.Root
            ><DropdownMenu.Trigger
              class="rail-more"
              aria-label={labels.moreTools}
              title={labels.moreToolsTitle}><Icon name="more" size={18} /></DropdownMenu.Trigger
            >
            <DropdownMenu.Portal
              ><DropdownMenu.Content
                class="workspace-overflow-menu"
                side="right"
                align="start"
                sideOffset={8}
                collisionPadding={10}
                loop
              >
                {#each OUTPUTS.filter((row) => row.navigationRole === "explore") as row}<DropdownMenu.Item
                    class="workspace-overflow-item"
                    onSelect={() => go(row.id)}
                    ><Icon name={row.icon} size={16} />{row.label}</DropdownMenu.Item
                  >{/each}
              </DropdownMenu.Content></DropdownMenu.Portal
            >
          </DropdownMenu.Root>{/if}
        <div class="rail-bottom">
          {#if RuntimeControls}<RuntimeControls placement="rail" />{/if}
          {#if isSettings(settingsMenu.primary) || isSettings(settingsMenu.integrations) || isSettings(settingsMenu.help)}<DropdownMenu.Root
              ><DropdownMenu.Trigger
                class="user-menu-trigger"
                aria-label={labels.userMenu}
                title={labels.userMenu}>{displayName.trim().charAt(0)}</DropdownMenu.Trigger
              >
              <DropdownMenu.Portal
                ><DropdownMenu.Content
                  class="workspace-overflow-menu"
                  side="right"
                  align="end"
                  sideOffset={8}
                >
                  {#if isSettings(settingsMenu.primary)}<DropdownMenu.Item
                      class="workspace-overflow-item"
                      onSelect={() => openSettingsSection(settingsMenu.primary ?? "")}
                      ><Icon name="sliders" size={16} />{labels.settings}</DropdownMenu.Item
                    >{/if}
                  {#if isSettings(settingsMenu.integrations)}<DropdownMenu.Item
                      class="workspace-overflow-item"
                      onSelect={() => openSettingsSection(settingsMenu.integrations ?? "")}
                      ><Icon name="workflow" size={16} />{labels.integrations}</DropdownMenu.Item
                    >{/if}
                  {#if isSettings(settingsMenu.help)}<DropdownMenu.Item
                      class="workspace-overflow-item"
                      onSelect={() => openSettingsSection(settingsMenu.help ?? "")}
                      ><Icon name="help" size={16} />{labels.help}</DropdownMenu.Item
                    >{/if}
                </DropdownMenu.Content></DropdownMenu.Portal
              ></DropdownMenu.Root
            >{/if}
        </div>
      </nav>
      <div class="desktop-area">
        {#if split.mode === "stacked" && layout.output}<div
            class="compact-view-switch"
            role="group"
            aria-label={labels.visibleWorkspaceRegion}
          >
            <button
              aria-pressed={focusedPane === "chat"}
              onclick={() => {
                outputExpanded = false;
                focusedPane = "chat";
              }}>{labels.chat}</button
            ><button
              aria-pressed={focusedPane === "output"}
              onclick={() => (focusedPane = "output")}>{meta?.label ?? labels.output}</button
            >
          </div>{/if}
        {#if connection === "offline"}<div class="desktop-disconnected" role="alert">
            <span>{connectionError || labels.connectionLost}</span><button
              class="btn"
              onclick={reload}>{labels.reconnect}</button
            >
          </div>{/if}
        <div
          class="desktop-workbench"
          class:stacked={split.mode === "stacked"}
          class:chat-only={!layout.output}
          class:output-expanded={outputExpanded && !!layout.output}
          data-focused={focusedPane}
          bind:clientWidth={paneWidth}
          style:--chat-pane-width={`${split.chatWidth}px`}
        >
          <div
            class="desktop-chat"
            id={chatRegionId}
            bind:this={chatRegion}
            tabindex="-1"
            role="region"
            aria-label={labels.chatAndNavigation}
            hidden={!chatRegionVisible}
            inert={!chatRegionVisible}
          >
            <Chat
              {approval}
              presentation={resolveChatPresentation(chatPresentation)}
              appearance={chatAppearance}
              ui={chatUI}
              bind:this={chatView}
              splitLayout
              externalPanels
              bind:panelContent={chatPanelContent}
              onOpenPanel={openChatPanel}
              onToggleOutput={toggleOutput}
              outputOpen={!!layout.output}
              outputTabCount={openTabs.length}
              bind:navigationOpen={menuOpen}
              {navigationCollapsed}
              bind:sidebarWidth={layout.navWidth}
              bind:inspectorWidth={layout.inspectorWidth}
              backend={chatBackend}
              {backends}
              {comparison}
              {compareBackends}
              active={workspaceActive && (split.mode !== "stacked" || focusedPane === "chat")}
              onPick={pickChat}
              onNavigate={go}
              onOpenOutput={openComparisonOutput}
              onCompareSettings={compare}
            >
              {#snippet navigation()}<div class="navigation-brand">
                  <strong>{displayName}</strong><button
                    id="workspace-search"
                    aria-label={labels.searchChats}
                    title={labels.searchChats}
                    onclick={() => chatView?.focusSessionSearch()}
                    ><Icon name="search" size={17} /></button
                  ><span
                    class="connection-dot"
                    class:connected={connection === "online"}
                    class:stub={stubConnection}
                    title={connection === "online"
                      ? stubConnection
                        ? labels.stubTooltip
                        : labels.connectedTooltip
                      : labels.disconnectedTooltip}
                  ></span>
                </div>
              {/snippet}
            </Chat>
          </div>
          {#if split.mode === "split" && !outputExpanded}<div class="pane-divider">
              <input
                type="range"
                aria-label={labels.resizeChatOutput}
                min={1 - split.maxRatio}
                max={1 - split.minRatio}
                step="any"
                value={1 - split.outputRatio}
                aria-valuetext={labels.outputShare.replace(
                  "{percent}",
                  String(Math.round(split.outputRatio * 100)),
                )}
                onpointerdown={resize}
                onkeydown={resizeKey}
                oninput={(event) =>
                  (layout = { ...layout, outputRatio: 1 - event.currentTarget.valueAsNumber })}
                ondblclick={() => (layout = { ...layout, outputRatio: DEFAULT_OUTPUT_RATIO })}
              />
              <span></span>
            </div>{/if}
          <main
            id="workspace"
            class="desktop-output"
            tabindex="-1"
            aria-label={meta?.label ?? labels.outputWorkspace}
            inert={menuOpen}
            hidden={!outputRegionVisible}
          >
            <div class="output-tabbar">
              <div class="output-tabs" role="tablist" aria-label={labels.openOutputTabs}>
                {#each openTabs as id (id)}{@const item = OUTPUTS.find(
                    (output) => output.id === id,
                  )}
                  <div
                    class="output-tab"
                    class:selected={layout.output === id}
                    class:working={!keptTabs.includes(id)}
                    data-output-origin={outputOrigin(id)?.id}
                    style:--output-origin-color={outputOrigin(id)?.color}
                    role="presentation"
                  >
                    <button
                      role="tab"
                      id={`output-tab-${id}`}
                      aria-selected={layout.output === id}
                      aria-controls={panelIdFor(id)}
                      tabindex={layout.output === id ? 0 : -1}
                      title={`${item?.label ?? id} · ${keptTabs.includes(id) ? labels.keptTab : labels.workingTabDescription}`}
                      onclick={() => go(id)}
                      onkeydown={(event) => tabKey(event, id)}
                    >
                      <Icon
                        name={keptTabs.includes(id) ? "pin" : (item?.icon ?? "folder")}
                        size={14}
                      />{#if outputOrigin(id)}<span class="output-origin-dot" aria-hidden="true"
                        ></span>{/if}<span>{item?.label ?? id}</span>
                    </button>
                    <!-- The tab itself is the one tab stop in the tablist; these act on it and
                         must not add two more. Pointer users click them, keyboard users get
                         Delete (close) and Shift+Enter (keep) on the focused tab. -->
                    {#if !keptTabs.includes(id) && id !== launcher.id}<button
                        class="keep-tab"
                        tabindex="-1"
                        aria-label={labels.keepTab.replace("{label}", item?.label ?? id)}
                        title={labels.keepTabDescription}
                        onclick={() => keepTab(id)}><Icon name="pin" size={12} /></button
                      >{/if}
                    <button
                      class="close-tab"
                      tabindex="-1"
                      aria-label={labels.closeTab.replace("{label}", item?.label ?? id)}
                      onclick={() => closeTab(id)}><Icon name="x" size={12} /></button
                    >
                  </div>
                {/each}
                {#if launcher.id && CANVAS_TOOLS.includes(launcher.id)}<button
                    class="tab-add"
                    aria-label={labels.newTab}
                    title={labels.newTabDescription}
                    onclick={addTab}><Icon name="plus" size={15} /></button
                  >{/if}
              </div>
              <div class="output-tab-actions">
                {#if isSettings(settingsMenu.integrations)}
                  <button
                    class="tab-plugins"
                    aria-label={labels.plugins}
                    title={labels.pluginsAndIntegrations}
                    onclick={() => openSettingsSection(settingsMenu.integrations ?? "")}
                    ><Icon name="layers" size={15} /></button
                  >
                {/if}
                <button
                  class="tab-expand"
                  aria-label={outputExpanded ? labels.restoreSplitView : labels.expandOutputPanel}
                  title={outputExpanded ? labels.restoreSplitView : labels.expandOutputPanel}
                  onclick={() => (outputExpanded = !outputExpanded)}
                  ><Icon name={outputExpanded ? "minimize" : "maximize"} size={15} /></button
                >
                <Popover.Root bind:open={tabListOpen}
                  ><Popover.Trigger
                    class="tab-overflow"
                    aria-label={labels.findOpenTab}
                    title={labels.openTabs}><Icon name="chevron" size={15} /></Popover.Trigger
                  ><Popover.Portal
                    ><Popover.Content
                      class="workspace-tab-picker"
                      side="bottom"
                      align="end"
                      sideOffset={8}
                      collisionPadding={10}
                      aria-label={labels.openTabs}
                    >
                      <label class="sr-only" for="find-output-tab">{labels.findOpenTab}</label
                      ><input
                        id="find-output-tab"
                        type="search"
                        class="field"
                        placeholder={labels.findTab}
                        bind:value={tabSearch}
                      />
                      {#each openTabs.filter( (id) => (OUTPUTS.find((row) => row.id === id)?.label ?? id)
                            .toLowerCase()
                            .includes(tabSearch.toLowerCase()) ) as id}<button
                          class="workspace-overflow-item"
                          onclick={() => go(id)}
                          ><Icon
                            name={OUTPUTS.find((row) => row.id === id)?.icon}
                            size={15}
                          />{OUTPUTS.find((row) => row.id === id)?.label}</button
                        >{/each}
                      {#if !openTabs.some( (id) => (OUTPUTS.find((row) => row.id === id)?.label ?? id)
                            .toLowerCase()
                            .includes(tabSearch.toLowerCase()) )}<p>
                          {labels.noMatchingOpenTab}
                        </p>{/if}
                    </Popover.Content></Popover.Portal
                  ></Popover.Root
                >
              </div>
            </div>
            {#if layout.output && resourceHeaders[layout.output]}
              <div class="resource-header">{@render resourceHeaders[layout.output].toolbar()}</div>
            {:else if SiteHeader && !canvasPresentation.selfHeaderIds?.includes(layout.output ?? "")}<SiteHeader
                title={meta?.label ?? labels.workspace}
                icon={meta?.icon ?? "workflow"}
                canClose={!!layout.output}
                showCompute={!outputOrigin(layout.output ?? "")?.resultOnly &&
                  !canvasPresentation.hideComputeIds?.includes(layout.output ?? "") &&
                  !chatOutput &&
                  layout.output !== launcher.id}
                showOptions={!outputOrigin(layout.output ?? "")?.resultOnly &&
                  !chatOutput &&
                  layout.output !== launcher.id}
                {backends}
                {backend}
                {connection}
                {comparison}
                {compareBackends}
                onPick={pick}
                onClose={() => go("chat")}
                onComparison={compare}
                onComparePick={(ids: string[]) => (compareBackends = ids)}
              />{/if}
            <div class="desktop-output-content">
              <div class="output-content-stack">
                {#if WorkspaceLauncher && launcher.id && TOOLS.includes(launcher.id)}<div
                    id={`output-panel-${launcher.id}`}
                    class="output-view"
                    role="tabpanel"
                    aria-labelledby={openTabs.includes(launcher.id as OutputId)
                      ? `output-tab-${launcher.id}`
                      : undefined}
                    aria-label={openTabs.includes(launcher.id as OutputId)
                      ? undefined
                      : (OUTPUTS.find((row) => row.id === launcher.id)?.label ?? labels.workspace)}
                    hidden={layout.output !== launcher.id}
                    inert={layout.output !== launcher.id}
                  >
                    <WorkspaceLauncher
                      outputs={OUTPUTS.filter((row) => !isSettings(row.id))}
                      recent={trail.entries}
                      quickIds={launcher.quick}
                      suggestedIds={launcher.suggested}
                      recentLabel={launcher.recentLabel}
                      launcherId={launcher.id}
                      onOpen={go}
                    />
                  </div>{/if}
                {#each mountedPanels as id (id)}{#if hasFeatureScreen(id)}
                    <div
                      id={`output-panel-${id}`}
                      role="tabpanel"
                      aria-labelledby={`output-tab-${id}`}
                      class="output-view"
                      hidden={layout.output !== id}
                      inert={layout.output !== id}
                    >
                      {#await loadFeatureScreen(id)}<p role="status">
                          {labels.loadingView}
                        </p>{:then ToolView}<FeatureHost
                          screen={ToolView}
                          viewId={id}
                          origin={outputOrigin(id)}
                          screenProps={{
                            backend,
                            backends,
                            connection,
                            connectionError,
                            comparison,
                            compareBackends,
                            active: workspaceActive && regions.output && layout.output === id,
                            onPick: pick,
                            onReload: reload,
                            onNavigate: go,
                            onCompareSettings: compare,
                          }}
                        />{:catch}<p role="alert">
                          {labels.viewLoadFailed}
                        </p>{/await}
                    </div>
                  {/if}{/each}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  </div>
  {#if resourceNotice}<div class="resource-notice" role="status">
      {resourceNotice}<button
        aria-label={labels.dismissPanelNotice}
        onclick={() => (resourceNotice = "")}><Icon name="x" /></button
      >
    </div>{/if}
  <Dialog.Root bind:open={shortcutsOpen}>
    <Dialog.Portal
      ><Dialog.Overlay class="dialog-overlay shortcut-overlay" /><Dialog.Content
        class="dialog-shell shortcut-dialog"
        onCloseAutoFocus={restoreOverlayFocusNow}
      >
        <Dialog.Title>{labels.keyboardShortcuts}</Dialog.Title><Dialog.Description
          >{labels.shortcutsDescription}</Dialog.Description
        >
        <div class="shortcut-list">
          {#each desktopMenus as group}{#each group.items.filter((item) => item.shortcut) as item}<div
              >
                <span>{item.label}</span><kbd>{item.shortcut}</kbd>
              </div>{/each}{/each}
        </div>
        <Dialog.Close class="shortcut-close">{labels.close}</Dialog.Close>
      </Dialog.Content></Dialog.Portal
    >
  </Dialog.Root>
  {#if SettingsWindow}<SettingsWindow
      bind:open={settingsOpen}
      bind:selected={settingsView}
      categories={SETTINGS}
      onSelect={openSettingsSection}
    >
      {#snippet children(id: string)}
        {#if chatPanels.some((route) => route.id === id)}
          {#if chatPanelContent}{@render chatPanelContent()}{:else}<p role="status">
              {labels.loadingSettings}
            </p>{/if}
        {:else}
          {#if hasFeatureScreen(id)}{#await loadFeatureScreen(id)}<p role="status">
                {labels.loadingSettings}
              </p>{:then SettingsView}<SettingsView
                {backend}
                {backends}
                {comparison}
                {compareBackends}
                active={settingsOpen}
                onPick={pick}
                onReload={reload}
                onNavigate={go}
                onCompareSettings={compare}
              />{:catch}<p role="alert">{labels.settingsLoadFailed}</p>{/await}{/if}
        {/if}
      {/snippet}
    </SettingsWindow>{/if}
{/snippet}
{#if HostedGate}
  <HostedGate
    onConnected={connectedWorkspace}
    onWorkspaceActive={(value: boolean) => (workspaceActive = value)}
  >
    {@render workspaceContent()}
  </HostedGate>
{:else}
  {@render workspaceContent()}
{/if}

<style>
  .output-origin-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--output-origin-color);
  }
  .output-tab[data-output-origin] {
    border-bottom: 2px solid var(--output-origin-color);
  }
  :global(.shortcut-overlay) {
    z-index: 120;
  }
  :global(.shortcut-dialog) {
    width: min(520px, calc(100vw - 24px));
    max-height: calc(100dvh - 32px);
    padding: 24px;
    z-index: 121;
  }
  :global(.shortcut-dialog h2) {
    font-size: 18px;
    margin: 0 0 12px;
  }
  :global(.shortcut-dialog p) {
    color: var(--color-ink-2);
    font-size: 13px;
  }
  .shortcut-list > div {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    padding: 7px 0;
    font-size: 12px;
  }
  .shortcut-list kbd {
    white-space: nowrap;
    color: var(--color-ink-2);
    font: inherit;
  }
  :global(.shortcut-close) {
    margin-top: 16px;
    padding: 8px 14px;
    border: 1px solid var(--color-line);
    border-radius: 7px;
  }
  .resource-notice {
    position: fixed;
    bottom: 18px;
    right: 18px;
    max-width: calc(100vw - 36px);
    display: flex;
    gap: 14px;
    padding: 12px;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
    border-radius: 8px;
    z-index: 115;
    font-size: 12px;
  }

  .workspace-titlebar :global(.menubar-trigger) {
    padding: 4px 8px;
    color: var(--color-ink-2);
    border-radius: 5px;
    font-size: 12px;
  }
  .workspace-titlebar :global(.menubar-trigger:hover) {
    color: var(--color-ink);
    background: var(--color-hover);
  }
  .rail-bottom :global(.user-menu-trigger) {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--color-hover);
    color: var(--color-ink);
    font-size: 12px;
  }
  .desktop-shell {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    height: calc(100dvh - 43px);
    padding: 0 3px 4px 0;
    background: var(--color-frame);
    overflow: hidden;
  }
  .desktop-rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 9px 5px 6px;
    background: var(--color-frame);
    /* On a landscape phone the rail is taller than the viewport, and `margin-top: auto` on
       `.rail-bottom` pinned Settings and Server controls below the fold with no way to reach
       them. Scrolling turns an unreachable control into a reachable one; `auto` collapses to 0
       while the content overflows, so nothing moves on a viewport that already fits. */
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: none;
  }
  .desktop-rail::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
  .desktop-rail > button {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    color: var(--color-ink-2);
  }
  .desktop-rail > button:hover {
    background: var(--color-hover);
    color: var(--color-ink);
  }
  .desktop-rail > button.rail-active {
    background: var(--color-nav-active);
    color: var(--color-ink);
  }
  /* Forced colours drop every author background, so `rail-active` became invisible: the
     current app looked like the others. Marks of state have to survive the palette swap. */
  @media (forced-colors: active) {
    .desktop-rail > button[aria-current] {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }
  .output-tabbar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    min-width: 0;
    min-height: 49px;
    padding: 0 7px;
    background: var(--color-page);
    border-bottom: 1px solid var(--color-line);
  }
  .output-tab-actions {
    display: flex;
    align-items: center;
    flex: none;
    gap: 3px;
    padding-left: 6px;
  }
  .output-tab-actions :global(button) {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--color-ink-2);
  }
  .output-tab-actions :global(button:hover) {
    background: var(--color-hover);
    color: var(--color-ink);
  }
  .resource-header {
    flex: none;
    min-width: 0;
    border-bottom: 1px solid var(--color-line);
    background: var(--color-page);
  }
  .desktop-workbench.output-expanded {
    grid-template-columns: minmax(0, 1fr);
  }
  .output-tabs {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    padding: 7px 0;
    min-height: 48px;
    overflow-x: auto;
    background: transparent;
  }
  .output-tab {
    display: flex;
    align-items: center;
    flex: none;
    width: var(--workspace-tab-width, 184px);
    max-width: 240px;
    border-radius: 9px 9px 0 0;
    min-width: 70px;
    height: 32px;
    border: 1px solid transparent;
    color: var(--color-ink-2);
  }
  .output-tab.selected {
    background: var(--color-tab-active);
    border-color: var(--color-tab-active-border);
    color: var(--color-ink);
  }
  /* Forced colours: the selected tab kept the idle colour, so the strip showed no position. */
  @media (forced-colors: active) {
    .output-tab.selected {
      border-color: Highlight;
    }
    .output-tab.selected > [role="tab"] {
      font-weight: 700;
    }
  }
  .output-tab > [role="tab"] {
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 0;
    gap: 7px;
    height: 30px;
    padding: 0 7px 0 10px;
    font-size: 12px;
  }
  .output-tab > [role="tab"] span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .output-tab .close-tab,
  .output-tab .keep-tab {
    flex: none;
    width: 24px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 5px;
    margin-right: 4px;
  }

  .output-tab .keep-tab {
    margin-right: 0;
  }
  .output-tab .close-tab:hover,
  .output-tab .keep-tab:hover {
    background: var(--color-hover);
  }
  .rail-bottom {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    margin-top: auto;
  }
  .desktop-area {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border: 1px solid var(--color-line);
    border-radius: 13px 13px 5px 5px;
    overflow: hidden;
  }
  .desktop-workbench {
    display: grid;
    grid-template-columns: var(--chat-pane-width) 8px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    flex: 1;
  }
  .desktop-workbench.chat-only {
    grid-template-columns: minmax(0, 1fr);
  }
  .desktop-chat {
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .navigation-brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px 12px;
    font-size: 17px;
    min-height: 42px;
  }
  .navigation-brand strong {
    font-weight: 550;
  }
  .connection-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-ink-3);
  }
  .connection-dot.connected {
    background: #74bc95;
  }
  /* A filled dot means a link exists. The in-page stub is not one, so it keeps the hollow
     outline and the tooltip says why. */
  .connection-dot.stub {
    background: transparent;
    box-shadow: inset 0 0 0 1px #74bc95;
  }
  .pane-divider {
    position: relative;
    display: grid;
    place-items: center;
    background: var(--color-page);
    cursor: col-resize;
    touch-action: none;
  }
  .pane-divider::before {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-start: 50%;
    width: 1px;
    background: var(--color-line);
    pointer-events: none;
  }
  .pane-divider span {
    height: 30px;
    width: 2px;
    border-radius: 2px;
    background: transparent;
    pointer-events: none;
  }
  .pane-divider input {
    position: absolute;
    inset: 0;
    appearance: none;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: col-resize;
    margin: 0;
  }
  .pane-divider:hover span,
  .pane-divider:focus-within span {
    z-index: 1;
    background: var(--color-ink-2);
  }
  .pane-divider:focus-within::before {
    width: 2px;
    background: var(--color-ink-2);
  }
  .desktop-output {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    outline: none;
    background: var(--color-page);
  }
  .desktop-output-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .output-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .output-view :global(.view-frame) {
    padding: 20px;
  }
  .output-view :global(.view-frame h1) {
    font-size: 17px;
  }
  .output-view :global(.view-frame > div:first-child) {
    gap: 10px;
  }
  .desktop-disconnected {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 8px 18px;
    border-bottom: 1px solid var(--color-line);
    color: var(--color-ink-2);
    font-size: 12px;
  }
  .desktop-disconnected button {
    margin-left: auto;
  }
  /* Stacked mode shows one region at a time (`visibleRegions`), so there is one track: the
     two-row 330px/280px ladder that used to be here was dead — a later duplicate overrode it,
     and two tracks would leave an empty row anyway. */
  .desktop-workbench.stacked {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    overflow: hidden;
  }
  .stacked .desktop-output {
    border-top: 1px solid var(--color-line);
  }
  @media (max-width: 1100px) {
    .desktop-chat {
      --chat-nav-width: 0px;
    }
  }
  @media (max-width: 600px) {
    .desktop-shell {
      grid-template-columns: 40px minmax(0, 1fr);
    }
    .desktop-rail {
      padding-inline: 2px;
    }
    .desktop-rail > button {
      width: 32px;
      height: 34px;
    }
    .output-view :global(.view-frame) {
      padding: 14px;
    }
  }

  .workspace-host {
    height: 100dvh;
    background: var(--color-frame);
  }
  .workspace-titlebar {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 43px;
    padding: 0 4px;
    font-size: 13px;
    color: var(--color-ink-2);
  }
  .workspace-titlebar > button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 30px;
    border-radius: var(--radius-card);
  }
  .workspace-titlebar button:disabled {
    opacity: 0.35;
  }
  .workspace-titlebar strong {
    font-size: 13px;
    font-weight: 500;
    margin: 0 18px 0 4px;
  }
  .workspace-titlebar > .titlebar-connection {
    width: auto;
    height: auto;
    margin-left: auto;
    font-size: 12px;
    border-radius: var(--radius-card);
    padding: 5px 8px;
  }
  .titlebar-status {
    margin-left: auto;
    font-size: 12px;
  }
  .workspace-titlebar button:hover {
    background: var(--color-hover);
  }
  .rail-separator {
    width: 24px;
    border-top: 1px solid var(--color-rail-separator);
    margin: 3px 0;
  }
  :global(.rail-more) {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    color: var(--color-ink-2);
  }
  :global(.workspace-overflow-menu),
  :global(.workspace-tab-picker) {
    z-index: 100;
    min-width: 220px;
    max-width: calc(100vw - 24px);
    max-height: min(480px, calc(100dvh - 24px));
    overflow: auto;
    background: var(--color-hover);
    border-radius: 12px;
    padding: 7px;
    box-shadow: 0 12px 30px #0004;
    color: var(--color-ink);
    font-family: var(--font-sans);
  }
  :global(.workspace-overflow-item) {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    padding: 7px 9px;
    border-radius: 7px;
    font-size: 13px;
    width: 100%;
    text-align: left;
    cursor: pointer;
    outline: none;
  }
  /* The roving highlight uses --color-hover, which is this panel's own background, so the
     highlight alone leaves a keyboard user with no visible cursor. */
  :global(.workspace-overflow-item:focus-visible),
  :global(.workspace-menu-item:focus-visible),
  :global(.workspace-menubar-item:focus-visible) {
    outline: 2px solid var(--color-ink);
    outline-offset: -2px;
  }
  :global(.workspace-overflow-item:hover),
  :global(.workspace-overflow-item[data-highlighted]) {
    background: var(--color-hover);
  }
  :global(.workspace-tab-picker .field) {
    margin-bottom: 7px;
  }
  .tab-add,
  :global(.tab-overflow) {
    flex: none;
    width: 27px;
    height: 29px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-card);
    color: var(--color-ink-2);
  }
  .output-content-stack {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .compact-view-switch {
    display: flex;
    justify-content: center;
    padding: 7px;
    background: var(--color-page);
    gap: 4px;
    border-bottom: 1px solid var(--color-line);
  }
  .compact-view-switch button {
    font-size: 12px;
    padding: 6px 15px;
    border-radius: 20px;
    color: var(--color-ink-2);
  }
  .compact-view-switch button[aria-pressed="true"] {
    background: var(--color-hover);
    color: var(--color-ink);
  }
  .desktop-workbench.stacked .desktop-chat,
  .desktop-workbench.stacked .desktop-output {
    height: 100%;
    min-height: 0;
  }
  @media (max-width: 600px) {
    .titlebar-connection {
      margin-left: auto;
      font-size: 12px;
      border-radius: var(--radius-card);
      padding: 5px 8px;
    }
    .titlebar-status {
      display: none;
    }
    .workspace-titlebar strong {
      margin-left: auto;
    }
    .desktop-shell {
      grid-template-columns: 44px minmax(0, 1fr);
    }
    .desktop-rail {
      padding-inline: 3px;
    }
    .desktop-rail > button,
    :global(.rail-more) {
      width: 34px;
    }
  }
</style>

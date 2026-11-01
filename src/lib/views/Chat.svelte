<script lang="ts">
  import {
    ComposerPicker,
    ChatGroupHeader,
    resolveChatUI,
    type ChatMenuAction,
    ChatHeader,
    ChatComposer,
    ChatSurface,
    MessageFrame,
    ChatModeSwitch,
    ComparisonTabs,
    ChatListRow,
    chatAppearanceStyle,
    chatCandidateColors,
  } from "../../../slices/workspace-shell/shared/chat-ui/index.js";
  import { onMount, tick, untrack, type Component } from "svelte";
  import { Icon } from "../../../shared/icons/index.js";
  import RecoveryNotice from "#lib/RecoveryNotice.svelte";
  import RichText from "#lib/RichText.svelte";
  import ArtifactFrame from "#lib/ArtifactFrame.svelte";
  import { extractArtifact } from "#lib/artifact.js";
  import ModelCapabilities from "#lib/ModelCapabilities.svelte";
  import { api, get, post, postAudio } from "#lib/http.js";
  import { projectStore } from "#lib/projects.js";
  import { memoryStore } from "#lib/memories.js";
  import { saveProviderKey, clearProviderKey, hasProviderKey } from "#lib/byok_key.js";
  import {
    resolveChatBackend,
    streamServerChat,
    cloudAvailable,
    cloudTurn,
  } from "#lib/chat_dispatch.js";
  import type { AiProvider, ChatMessage } from "$lib/server/ai/contracts";
  import Recorder from "#lib/Recorder.svelte";
  import MicrophoneSelect from "#lib/MicrophoneSelect.svelte";
  import { Pencil, Trash2 } from "@lucide/svelte";
  import { clearDraft, readDraft, saveDraft } from "#lib/drafts.js";
  import { readProviderKey } from "#lib/byok_input.js";
  import AttachmentPreview from "#lib/AttachmentPreview.svelte";
  import AppSelect from "#lib/AppSelect.svelte";
  import { Button } from "#lib/components/ui/button/index.js";
  import { Textarea } from "#lib/components/ui/textarea/index.js";
  import { isLayaChatPanel, type LayaChatPanel } from "#lib/laya_chat_panel.js";
  import type {
    WorkspaceBackend,
    WorkspaceChatProps,
  } from "../../../slices/workspace-shell/shared/runtime/index.js";
  import {
    validPinnedSessions,
    togglePinnedSession,
    isNearLatest,
  } from "#lib/reference_workspace.js";
  import { resolveLayaChatPresentation } from "#lib/laya_chat_presentation.js";
  import { DropdownMenu, Popover, Dialog } from "bits-ui";
  import {
    WorkspaceMenuItems,
    registerMenuShortcuts,
    type WorkspaceMenuItem,
  } from "../../../slices/workspace-shell/shared/menu/index.js";
  import { ApprovalModeSelector } from "../../../slices/workspace-shell/shared/approval-mode/index.js";
  import {
    composerCommandQuery,
    replaceComposerCommand,
    matchingComposerResources,
    nextComposerSelection,
    type ComposerResource,
  } from "#lib/composer_commands.js";
  import {
    clampNavigationWidth,
    clampInspectorWidth,
    navigationWidthBounds,
    inspectorWidthBounds,
    dragNavigationWidth,
    keyboardNavigationWidth,
    dragInspectorWidth,
    keyboardInspectorWidth,
    beginPanelResize,
  } from "../../../shared/workspace-layout/index.js";
  type Props = WorkspaceChatProps;
  let {
    approval,
    presentation,
    appearance,
    ui,
    backend = "local:npu",
    backends = [],
    comparison = false,
    compareBackends = [],
    active = true,
    onPick = () => {},
    onNavigate = () => {},
    onOpenOutput,
    onCompareSettings = () => {},
    navigation,
    navigationItems,
    onToggleOutput = () => {},
    outputOpen = false,
    outputTabCount = 0,
    splitLayout = false,
    navigationOpen = $bindable(false),
    sidebarWidth = $bindable(230),
    inspectorWidth = $bindable(350),
    navigationCollapsed = false,
    externalPanels = false,
    panelContent = $bindable(),
    onOpenPanel = () => {},
  }: Props = $props();
  let catalogue = $state<any>(null);
  let sessions = $state<any[]>([]);
  let session = $state<any>(null);
  let sessionSearch = $state("");
  let searchOpen = $state(false);
  let recentSort = $state("updated");
  let recentFilter = $state("all");
  let pinnedIds = $state<string[]>([]);
  let pinsOpen = $state(true);
  let recentsOpen = $state(true);
  type CompareTarget = { model_id: string; device: string };
  let comparisonColors = $derived(chatCandidateColors(appearance));
  let activeComparison = $state(0);
  let comparisonTargets = $state<CompareTarget[]>([]);
  let comparisonCount = $state(2);
  let presentationConfig = $derived(resolveLayaChatPresentation(presentation));
  let uiConfig = $derived(resolveChatUI(ui));
  let resourcePickerOpen = $state(false);
  let pickerTab = $state("");
  let maxComparisonPanels = $derived(
    Math.min(3, Math.max(2, presentationConfig.maxComparisonPanels ?? 3)),
  );
  let contextSummaryOpen = $state(false);
  let comparisonKind = $state<"models" | "processors">("models");
  let presentationMode = $state<"chat" | "work" | "compare">("chat");
  let isCompare = $derived(presentationMode === "compare");
  function choosePresentationMode(mode: "chat" | "work" | "compare") {
    if (busy || operation || !presentationConfig.modes.includes(mode)) return;
    presentationMode = mode;
    if (mode === "compare") ensureComparisonTargets();
    onCompareSettings(false, []);
    if (session?.id) saveDraft(`chat-mode:${session.id}`, mode);
  }
  let readingHistory = $state(false);
  let unread = $state(false);
  let scrollSave: ReturnType<typeof setTimeout>;
  export function focusComposer() {
    if (composerInput && !composerInput.disabled) composerInput.focus();
  }
  export async function focusSessionSearch() {
    searchOpen = true;
    await tick();
    document.getElementById("session-search")?.focus();
  }
  function pinSession(id: string) {
    pinnedIds = togglePinnedSession(pinnedIds, id);
    saveDraft("pinned-sessions", pinnedIds);
  }
  // Project membership is local state (src/lib/projects.ts), never a permission and never a
  // path. `projectVersion` exists only to re-render the sidebar after a write.
  let projectVersion = $state(0);
  function projectsNow() {
    void projectVersion;
    return projectStore.projects();
  }
  function projectMenuItems(): WorkspaceMenuItem[] {
    const rows = projectsNow();
    if (!rows.length)
      return [
        {
          id: "no-projects",
          label: "No projects yet",
          description: "Create one in the sidebar first.",
          disabled: true,
        },
      ];
    return rows.map((project) => ({
      id: project.id,
      label: project.name,
      icon: "folder",
    }));
  }
  function moveToProject(sessionId: string, projectId: string) {
    if (projectStore.assign(sessionId, projectId)) projectVersion += 1;
  }
  function createProjectPrompt() {
    const name = window.prompt("Project name");
    if (name === null) return;
    const created = projectStore.create(name);
    if (created) projectVersion += 1;
    else if (name.trim()) error = "That project name is empty or too long.";
  }
  $effect(() => {
    if (navigationOpen)
      tick().then(() => document.querySelector<HTMLButtonElement>(".new-chat-button")?.focus());
  });
  let sessionLoading = $state(true);
  let panel = $state<LayaChatPanel>("");
  let toolsVisited = $state(false);
  let settingsVisited = $state(false);
  let sessionVisited = $state(false);
  let toolPanel = $state<"tools" | "mcp" | "skills">("tools");
  // The tools panel is 24 kB of source that most sessions never open, so it stays out of the
  // initial graph. Loaded once on first visit; the `{#key}` remount below still runs on every
  // tab change, which is why this is state and not `{#await}` (that would re-suspend each time).
  let ChatTools = $state<Component<any> | null>(null);
  $effect(() => {
    if (toolsVisited && !ChatTools) {
      import("#lib/ChatTools.svelte").then((module) => (ChatTools = module.default));
    }
  });
  export function openPanel(next: string, notify = true) {
    if (!isLayaChatPanel(next)) return;
    contextSummaryOpen = false;
    panel = next;
    if (next === "models") settingsVisited = true;
    if (next === "utils") sessionVisited = true;
    if (next === "tools" || next === "mcp" || next === "skills") {
      toolsVisited = true;
      toolPanel = next;
    }
    navigationOpen = false;
    if (notify) onOpenPanel(next);
  }
  $effect(() => {
    panelContent = sharedPanel;
    return () => {
      panelContent = undefined;
    };
  });
  export function openSettings() {
    openPanel("models");
  }
  export function newConversation() {
    return newSession();
  }
  let resourceFocus = $state<{
    connectionId: string;
    toolName: string;
    skillId: string;
    tab: "plugins" | "mcp" | "skills";
  }>({ connectionId: "", toolName: "", skillId: "", tab: "mcp" });
  let commandResources = $state<ComposerResource[]>([
    {
      marker: "@",
      id: "plugins",
      label: "Plugins",
      kind: "category",
      panel: "tools",
      description: "Connected plugin integrations",
    },
    {
      marker: "@",
      id: "mcp",
      label: "MCP servers",
      kind: "category",
      panel: "mcp",
      description: "Connect or select an MCP server",
    },
    {
      marker: "/",
      id: "skills",
      label: "Skills",
      kind: "category",
      panel: "skills",
      description: "Installed skill guidance",
    },
  ]);
  let commandLoading = $state(false);
  let commandWasVisible = false;
  let commandRequest = 0;
  let destroyed = false;
  let releaseResize: (() => void) | undefined;
  let commandError = $state("");
  let commandCaret = $state(0);
  let commandSelectionEnd = $state(0);
  let commandIndex = $state(0);
  let dismissedCommand = $state("");
  let chatWidth = $state(0);
  let viewportWidth = $state(0);
  let navBounds = $derived(navigationWidthBounds(chatWidth));
  let visibleSidebarWidth = $derived(
    navBounds
      ? Math.max(navBounds.min, Math.min(navBounds.max, clampNavigationWidth(sidebarWidth)))
      : clampNavigationWidth(sidebarWidth),
  );
  let chatContentWidth = $derived(
    chatWidth -
      (splitLayout && viewportWidth > 1100 && !navigationCollapsed ? visibleSidebarWidth + 8 : 0),
  );
  let panelBounds = $derived(inspectorWidthBounds(chatContentWidth));
  let visibleInspectorWidth = $derived(
    panelBounds
      ? Math.max(panelBounds.min, Math.min(panelBounds.max, clampInspectorWidth(inspectorWidth)))
      : clampInspectorWidth(inspectorWidth),
  );
  let modelId = $state("qwen3-npu");
  let maxTokens = $state(128);
  let toolIds = $state<string[]>([]);
  let draft = $state("");
  let error = $state("");
  let notice = $state("");
  let operation = $state("");
  let jobId = $state("");
  let job = $state<any>(null);
  let pending = $state("");
  let polling = false;
  let serverAiConfig = $state<{
    enabled: boolean;
    providers: { id: AiProvider; label: string; models: string[] }[];
  } | null>(null);
  // BYOK for the SvelteKit route. The key lives in `#lib/byok_key`, never in storage, so
  // these are only the form field, its feedback line, and which provider/model to use.
  let byokKeyDraft = $state("");
  let byokKeyNotice = $state("");
  let byokKeyHeld = $state(false);
  let serverProvider = $state<AiProvider | "">("");
  let serverModel = $state("");
  // Tool use is off unless the server also sets AI_TOOLS_ENABLED. Three things must agree:
  // this switch, the policy entry, and the server flag.
  let serverToolUse = $state(false);
  let activeAbortController: AbortController | null = null;

  function serverAiAvailable(): boolean {
    return Boolean(serverAiConfig?.enabled && serverAiConfig.providers.length > 0);
  }
  let sessionRequest = 0;
  let transcript = $state<HTMLElement>();
  let composerInput = $state<HTMLTextAreaElement | null>(null);
  let renameTitle = $state("");
  let renameInput = $state<HTMLInputElement | null>(null);
  let renaming = $state(false);
  let confirmation = $state<"" | "clear" | "delete">("");
  let messageRemoval = $state<{
    id: string;
    turn_id: string;
    target: "turn" | "reply" | "attachment";
    expected_version: number;
    reply_index?: number;
    attachment_id?: string;
    label: string;
  } | null>(null);
  let toolApproval = $state<any>(null);
  let toolResult = $state<any>(null);
  let attachments = $state<any[]>([]);
  // Branch drafts reuse saved files. Detaching one must not delete the source file.
  const unsavedUploads = new Set<string>();
  let pendingAttachments = $state<any[]>([]);
  let capabilities = $state<any>(null);
  let filePicker: HTMLInputElement;
  let voiceUrl = $state("");
  let voiceWorking = $state(false);
  let attachmentWorking = $state(false);
  let micActive = $state(false);
  let voiceDevice = $state("");
  let voiceLanguage = $state("en");
  let microphone = $state("");
  let voiceRequest = 0;
  let copiedItem = $state("");
  let busy = $derived(!!jobId || operation === "send");
  let entryEmpty = $derived(!sessionLoading && !session?.turns?.length && !pending && !jobId);
  $effect(() => {
    if (!voiceDevice && capabilities?.audio?.devices?.length)
      voiceDevice = capabilities.audio.devices.includes("NPU")
        ? "NPU"
        : capabilities.audio.devices[0];
  });
  let commandQuery = $derived(composerCommandQuery(draft, commandCaret, commandSelectionEnd));
  let commandSignature = $derived(
    commandQuery
      ? `${commandQuery.start}:${commandQuery.end}:${commandQuery.marker}:${commandQuery.query}`
      : "",
  );
  let activePickerTab = $derived(
    uiConfig.pickerTabs.find((tab) => tab.id === pickerTab) ??
      uiConfig.pickerTabs.find((tab) => tab.marker === (commandQuery?.marker ?? "/")) ??
      uiConfig.pickerTabs[0],
  );
  let allCommandResources = $derived<ComposerResource[]>([
    {
      id: "attach",
      label: uiConfig.attachmentLabel,
      kind: "action",
      action: "attach",
      icon: "file",
      marker: "/",
      description: "Attach local files",
    },
    ...(uiConfig.modeCommands
      ? presentationConfig.modes.map((mode) => ({
          id: `mode:${mode}`,
          label: `/${mode}`,
          kind: "mode" as const,
          mode,
          marker: "/" as const,
          icon: "message",
          description: `Switch to ${presentationConfig.modeLabels?.[mode] ?? mode}`,
        }))
      : []),
    ...commandResources.map((item) => ({
      ...item,
      icon:
        item.icon ??
        (item.kind === "tool"
          ? "workflow"
          : item.kind === "skill"
            ? "code"
            : item.kind === "plugin"
              ? "layers"
              : "server"),
    })),
  ]);
  let commandVisible = $derived(
    (resourcePickerOpen || (!!commandQuery && commandSignature !== dismissedCommand)) &&
      !busy &&
      !sessionLoading &&
      active,
  );
  let commandMatches = $derived(
    matchingComposerResources(
      allCommandResources.filter(
        (item) =>
          (!activePickerTab || activePickerTab.kinds.includes(item.kind)) &&
          (!item.marker || item.marker === activePickerTab?.marker),
      ),
      commandQuery?.query ?? "",
      24,
    ),
  );
  function closeResourcePicker() {
    resourcePickerOpen = false;
    dismissedCommand = commandSignature;
    void tick().then(() => composerInput?.focus());
  }
  function openResourcePicker() {
    resourcePickerOpen = !resourcePickerOpen;
    pickerTab = uiConfig.pickerTabs[0]?.id ?? "";
    commandIndex = 0;
    if (resourcePickerOpen) {
      void refreshCommandResources();
      void tick().then(() => composerInput?.focus());
    }
  }
  $effect(() => {
    const visible = commandVisible;
    if (visible && !commandWasVisible) untrack(() => refreshCommandResources());
    commandWasVisible = visible;
  });
  $effect(() => {
    commandSignature;
    pickerTab = "";
    commandIndex = 0;
  });
  $effect(() => {
    if (session?.id && !sessionLoading)
      saveDraft(`chat:${session.id}`, { content: draft, attachments });
  });
  let device = $derived(backend.startsWith("local:") ? backend.split(":")[1].toUpperCase() : "");
  let model = $derived(catalogue?.models?.find((item: any) => item.id === modelId));
  let setupBusy = $derived(["loading", "downloading"].includes(catalogue?.job?.state));
  let selectedDevices = $derived(
    isCompare
      ? comparisonTargets.map((target) => target.device)
      : comparison
        ? compareBackends.map((id) => id.split(":")[1].toUpperCase())
        : device
          ? [device]
          : [],
  );
  let modelCompatible = $derived.by(() =>
    isCompare
      ? comparisonValid
      : !!model &&
        selectedDevices.length > 0 &&
        selectedDevices.every((item) => model.devices?.includes(item)),
  );
  let compatibleModel = $derived(
    (catalogue?.models ?? []).find(
      (item: any) =>
        item.installed &&
        selectedDevices.length > 0 &&
        selectedDevices.every((selected) => item.devices?.includes(selected)),
    ),
  );
  function localDevice(item: WorkspaceBackend): item is WorkspaceBackend & { device: string } {
    return item.kind === "local" && typeof item.device === "string";
  }
  let supportedDevices = $derived(
    backends
      .filter(localDevice)
      .filter((item) => item.ready && model?.devices?.includes(item.device)),
  );
  let visibleSessions = $derived(
    sessions
      .filter(
        (item) =>
          (item.title ?? "New chat").toLowerCase().includes(sessionSearch.toLowerCase()) &&
          (recentFilter === "all" ||
            (recentFilter === "messages" ? item.message_count > 0 : !item.message_count)),
      )
      .sort((a, b) =>
        recentSort === "title"
          ? String(a.title ?? "").localeCompare(String(b.title ?? ""))
          : String(b[recentSort === "created" ? "created_at" : "updated_at"] ?? "").localeCompare(
              String(a[recentSort === "created" ? "created_at" : "updated_at"] ?? ""),
            ),
      ),
  );
  let modelOptions = $derived(
    (catalogue?.models ?? []).map((item: any) => ({
      value: item.id,
      label: `${item.label} · ${item.capabilities?.vision_label ?? "Capabilities unavailable"}${item.installed ? "" : " · install"}`,
    })),
  );
  let availableTargets = $derived.by<CompareTarget[]>(() =>
    (catalogue?.models ?? [])
      .filter((candidate: any) => candidate.installed)
      .flatMap((candidate: any) =>
        backends
          .filter(localDevice)
          .filter((engine) => engine.ready && candidate.devices?.includes(engine.device))
          .map((engine) => ({
            model_id: candidate.id as string,
            device: engine.device.toUpperCase(),
          })),
      ),
  );
  function comparisonId(target: CompareTarget) {
    return `${target.model_id}@${target.device}`;
  }
  function ensureComparisonTargets(count = comparisonCount) {
    comparisonCount = Math.min(maxComparisonPanels, Math.max(2, count));
    const primary = comparisonTargets[0]?.model_id ?? modelId;
    const seenModels = new Set<string>();
    const chosen = comparisonTargets
      .slice(0, comparisonCount)
      .filter(
        (target) =>
          availableTargets.some((candidate) => comparisonId(candidate) === comparisonId(target)) &&
          (comparisonKind === "processors"
            ? target.model_id === primary
            : !seenModels.has(target.model_id) && !!seenModels.add(target.model_id)),
      );
    const preferred = [...availableTargets].sort(
      (a, b) => Number(b.model_id === modelId) - Number(a.model_id === modelId),
    );
    for (const candidate of preferred) {
      if (chosen.length >= comparisonCount) break;
      if (
        (comparisonKind === "processors"
          ? candidate.model_id === primary
          : !chosen.some((target) => target.model_id === candidate.model_id)) &&
        !chosen.some((target) => comparisonId(target) === comparisonId(candidate))
      )
        chosen.push(candidate);
    }
    while (chosen.length < comparisonCount) chosen.push({ model_id: "", device: "" });
    comparisonTargets = chosen;
    activeComparison = Math.min(activeComparison, comparisonCount - 1);
  }
  async function focusComparison(index: number) {
    activeComparison = index;
    await tick();
    document
      .getElementById(`comparison-panel-${index}`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }
  function addComparison() {
    if (!busy && !operation && comparisonCount < maxComparisonPanels) {
      ensureComparisonTargets(comparisonCount + 1);
      void focusComparison(comparisonCount - 1);
    }
  }
  function removeComparison(index: number) {
    if (busy || operation || comparisonTargets.length <= 2) return;
    comparisonTargets = comparisonTargets.filter((_, i) => i !== index);
    comparisonCount = comparisonTargets.length;
    activeComparison = Math.min(activeComparison, comparisonCount - 1);
  }
  function messageTime(value: unknown) {
    const date =
      typeof value === "number"
        ? new Date(value * 1000)
        : typeof value === "string"
          ? new Date(value)
          : null;
    return date && Number.isFinite(date.getTime())
      ? {
          text: date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          iso: date.toISOString(),
        }
      : { text: undefined, iso: undefined };
  }
  function pickComparisonModel(index: number, id: string) {
    if (comparisonKind === "processors") {
      comparisonTargets = [];
      modelId = id;
      ensureComparisonTargets();
      return;
    }
    const current = comparisonTargets[index];
    const candidate =
      availableTargets.find(
        (target) => target.model_id === id && target.device === current?.device,
      ) ?? availableTargets.find((target) => target.model_id === id);
    if (candidate)
      comparisonTargets = comparisonTargets.map((target, i) =>
        i === index ? { ...candidate } : target,
      );
  }
  function pickComparisonDevice(index: number, device: string) {
    comparisonTargets = comparisonTargets.map((target, i) =>
      i === index ? { ...target, device } : target,
    );
  }
  let comparisonValid = $derived(
    comparisonTargets.length === comparisonCount &&
      (comparisonKind === "models"
        ? new Set(comparisonTargets.map((t) => t.model_id)).size === comparisonCount
        : new Set(comparisonTargets.map((t) => t.model_id)).size === 1) &&
      new Set(comparisonTargets.map(comparisonId)).size === comparisonCount &&
      comparisonTargets.every((target) =>
        availableTargets.some((candidate) => comparisonId(candidate) === comparisonId(target)),
      ),
  );
  function comparisonLabel(target: CompareTarget) {
    return target.model_id
      ? `${catalogue?.models?.find((candidate: any) => candidate.id === target.model_id)?.label ?? target.model_id} · ${target.device || "Choose device"}`
      : "Choose model and device";
  }
  function matchesLane(reply: any, target: CompareTarget | undefined) {
    if (!target) return true;
    return reply.comparison_id
      ? reply.comparison_id === comparisonId(target)
      : reply.model_id === target.model_id && String(reply.device).toUpperCase() === target.device;
  }
  function outputOrigin(target: CompareTarget, index: number) {
    return {
      id: `${session?.id ?? "unsaved"}:${comparisonId(target)}`,
      label: comparisonLabel(target),
      color: comparisonColors[index % 3],
      resultOnly: true,
    };
  }
  function openComparisonOutput(target: CompareTarget, index: number, result?: unknown) {
    if (onOpenOutput)
      onOpenOutput("apps", {
        ...outputOrigin(target, index),
        ...(result === undefined ? {} : { result }),
      });
    else onNavigate("apps");
  }
  let proposalOrigin = $state<{ target: CompareTarget; index: number } | null>(null);
  let proposalRequest = 0;
  let engineOptions = $derived(
    backends.filter(localDevice).map((item) => ({
      value: item.device,
      label: `${item.device}${model?.devices?.includes(item.device) ? "" : " · incompatible"}`,
      disabled: !item.ready || !model?.devices?.includes(item.device),
    })),
  );
  function checked(d: any) {
    if (d?.error) throw new Error(d.error);
    return d;
  }
  function settings() {
    return {
      model_id: isCompare ? (comparisonTargets[0]?.model_id ?? modelId) : modelId,
      device: isCompare ? (comparisonTargets[0]?.device ?? (device || "NPU")) : device || "NPU",
      max_new_tokens: maxTokens,
      compare_devices: !isCompare && comparison ? selectedDevices : [],
      compare_targets: isCompare ? comparisonTargets : [],
      compare_kind: isCompare ? comparisonKind : "models",
      tools: toolIds,
    };
  }
  // Hydration establishes a baseline. Merely viewing a saved chat is passive.
  let settingsOwner = "";
  let settingsSignature = "";
  $effect(() => {
    const id = session?.id;
    if (
      !id ||
      busy ||
      sessionLoading ||
      operation ||
      messageRemoval ||
      confirmation ||
      renaming ||
      (isCompare && !comparisonValid)
    )
      return;
    const saved = settings();
    const signature = JSON.stringify(saved);
    if (settingsOwner !== id) {
      settingsOwner = id;
      settingsSignature = signature;
      return;
    }
    if (signature === settingsSignature) return;
    const timer = window.setTimeout(() => {
      api
        .sessionUpdate(id, { settings: saved })
        .then((d) => {
          if (d.error) error = `Could not save chat settings: ${d.error}`;
          else if (session?.id === id) {
            settingsSignature = signature;
            if (d.session?.version > session.version) session.version = d.session.version;
          }
        })
        .catch((e) => (error = `Could not save chat settings: ${e.message}`));
    }, 400);
    return () => clearTimeout(timer);
  });
  function rememberSession(id: string) {
    try {
      localStorage.setItem("laya-session", id);
    } catch {}
  }
  function stamp(value: any) {
    if (!value) return "";
    const d = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function metrics(reply: any) {
    return reply.metrics ?? reply;
  }
  function numeric(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
  }
  function useCompatibleModel() {
    if (!compatibleModel || busy || operation) return;
    modelId = compatibleModel.id;
    error = "";
    notice = `Selected ${compatibleModel.label} for ${selectedDevices.join(" / ")}. Send your message when ready.`;
  }
  function useSupportedDevice(id: string) {
    if (busy || operation) return;
    onCompareSettings(false, []);
    onPick(id);
    error = "";
    notice = `Selected ${id.split(":")[1].toUpperCase()} for ${model?.label ?? "this model"}. Send your message when ready.`;
  }
  async function scrollEnd(force = false) {
    const nearEnd =
      !transcript ||
      isNearLatest(transcript.scrollTop, transcript.clientHeight, transcript.scrollHeight);
    await tick();
    if (force || nearEnd) {
      transcript?.scrollTo({ top: transcript.scrollHeight, behavior: "auto" });
      unread = false;
    } else unread = true;
  }
  function observeScroll() {
    if (!transcript) return;
    readingHistory = !isNearLatest(
      transcript.scrollTop,
      transcript.clientHeight,
      transcript.scrollHeight,
    );
    if (!readingHistory) unread = false;
    const id = session?.id,
      top = transcript.scrollTop;
    clearTimeout(scrollSave);
    if (id && !sessionLoading)
      scrollSave = setTimeout(() => saveDraft(`chat-scroll:${id}`, top), 120);
  }
  async function copyText(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedItem = id;
      notice = "Copied to clipboard.";
      setTimeout(() => {
        if (copiedItem === id) copiedItem = "";
      }, 1600);
    } catch {
      error = "Clipboard is unavailable. Select the message text and copy it manually.";
    }
  }
  function plainConversation() {
    return (session?.turns ?? [])
      .map((turn: any) =>
        [
          `You:\n${turn.content}`,
          ...(turn.replies ?? []).map(
            (reply: any) => `${reply.device ?? "Assistant"}:\n${reply.text || reply.error || ""}`,
          ),
        ].join("\n\n"),
      )
      .join("\n\n---\n\n");
  }
  async function forkSession(turnId?: string, boundary = "after", replyIndex?: number) {
    if (!session || busy || operation || micActive || attachmentWorking || voiceWorking) return;
    operation = "fork";
    error = "";
    try {
      const d = checked(
        await api.sessionFork(session.id, { turn_id: turnId, boundary, reply_index: replyIndex }),
      );
      applySession(d.session);
      draft = d.draft?.content ?? "";
      attachments = d.draft?.attachments ?? [];
      await refreshSessions();
      await scrollEnd(true);
      notice = d.draft?.missing_attachments?.length
        ? "Branch opened. Some original attachments were deleted; attach them again before sending."
        : "Opened a new branch.";
    } catch (e: any) {
      error = e.message;
    } finally {
      operation = "";
    }
  }
  async function refreshModels() {
    catalogue = checked(await api.chatStatus());
  }
  async function refreshSessions() {
    const d = checked(await api.sessions());
    sessions = d.sessions ?? [];
  }
  function applySession(d: any) {
    clearVoice();
    session = d;
    readingHistory = false;
    unread = false;
    renaming = false;
    messageRemoval = null;
    renameTitle = d.title ?? "New chat";
    rememberSession(d.id);
    const s = d.settings ?? {};
    modelId = s.model_id ?? modelId;
    maxTokens = s.max_new_tokens ?? 128;
    toolIds = s.tools ?? [];
    if (s.device) onPick(`local:${s.device.toLowerCase()}`);
    comparisonKind =
      s.compare_kind === "processors"
        ? "processors"
        : (presentationConfig.comparisonKinds?.[0] ?? "models");
    const savedTargets = Array.isArray(s.compare_targets) ? s.compare_targets : [];
    const savedMode = readDraft<string>(`chat-mode:${d.id}`, "");
    const devices = Array.isArray(s.compare_devices) ? s.compare_devices : [];
    const inferredMode = savedTargets.length >= 2 || devices.length >= 2 ? "compare" : "chat";
    presentationMode = presentationConfig.modes.includes(savedMode as "chat" | "work" | "compare")
      ? (savedMode as "chat" | "work" | "compare")
      : presentationConfig.modes.includes(inferredMode)
        ? inferredMode
        : presentationConfig.modes.includes("chat")
          ? "chat"
          : (presentationConfig.defaultMode ?? "chat");
    activeComparison = 0;
    comparisonCount = 2;
    comparisonTargets = savedTargets
      .filter(
        (target: any) => typeof target?.model_id === "string" && typeof target?.device === "string",
      )
      .slice(0, 3);
    if (comparisonTargets.length >= 2) {
      comparisonCount = comparisonTargets.length;
    }
    if (!comparisonTargets.length && devices.length >= 2) {
      comparisonKind = "processors";
      comparisonTargets = devices
        .slice(0, 3)
        .map((device: string) => ({ model_id: modelId, device }));
      comparisonCount = comparisonTargets.length;
    }
    if (isCompare && !comparisonTargets.length) ensureComparisonTargets();
    onCompareSettings(false, []);
    toolApproval = null;
    toolResult = null;
    proposalRequest++;
    proposalOrigin = null;
    dismissedCommand = commandSignature;
    resourcePickerOpen = false;
    if (d.active_job_id) {
      jobId = d.active_job_id;
      pending =
        [...(d.turns ?? [])].reverse().find((turn: any) => turn.status === "running")?.content ??
        "";
    }
  }
  async function readSession(id: string) {
    if (busy || operation || attachmentWorking || voiceWorking || micActive) return;
    const request = ++sessionRequest;
    sessionLoading = true;
    error = "";
    confirmation = "";
    try {
      const d = checked(await api.sessionRead(id));
      if (request !== sessionRequest) return;
      applySession(d.session);
      const stored = readDraft<any>(`chat:${id}`, null);
      draft = typeof stored?.content === "string" ? stored.content : "";
      attachments = Array.isArray(stored?.attachments)
        ? stored.attachments
            .filter((file: any) => typeof file?.id === "string")
            .slice(0, capabilities?.attachments?.max_files_per_turn ?? 4)
        : [];
      navigationOpen = false;
      sessionLoading = false;
      const position = readDraft<number | null>(`chat-scroll:${id}`, null);
      await tick();
      if (typeof position === "number" && Number.isFinite(position)) {
        transcript?.scrollTo({ top: Math.max(0, position), behavior: "auto" });
        observeScroll();
      } else await scrollEnd(true);
    } catch (e: any) {
      error = e.message;
    } finally {
      if (request === sessionRequest) sessionLoading = false;
    }
  }
  async function newSession() {
    if (busy || operation || attachmentWorking || voiceWorking || micActive) return;
    ++sessionRequest;
    operation = "new";
    error = "";
    try {
      const initialSettings = {
        ...settings(),
        model_id: comparisonTargets[0]?.model_id || modelId,
        device: comparisonTargets[0]?.device || device || "NPU",
        compare_targets: [],
        compare_devices: [],
        compare_kind: "models",
      };
      const d = checked(await api.sessionCreate({ settings: initialSettings }));
      saveDraft(`chat-mode:${d.session.id}`, "chat");
      applySession(d.session);
      draft = "";
      attachments = [];
      pendingAttachments = [];
      pending = "";
      job = null;
      navigationOpen = false;
      await refreshSessions();
    } catch (e: any) {
      error = e.message;
    } finally {
      operation = "";
      sessionLoading = false;
    }
  }
  async function initialize() {
    sessionLoading = true;
    error = "";
    try {
      await Promise.all([
        refreshModels(),
        refreshSessions(),
        api.capabilities().then((d) => {
          if (!d.error) capabilities = d;
        }),
      ]);
      let saved = "";
      try {
        saved = localStorage.getItem("laya-session") ?? "";
      } catch {}
      if (isCompare) ensureComparisonTargets();
      if (sessions.length)
        await readSession(sessions.find((item) => item.id === saved)?.id ?? sessions[0].id);
      else await newSession();
    } catch (e: any) {
      error = e.message ?? "The chat could not load. Reload the page to try again.";
    } finally {
      sessionLoading = false;
    }
  }
  async function pollJob() {
    if (!jobId || polling) return;
    polling = true;
    try {
      const d = checked(await api.chatJob(jobId));
      job = d;
      if (["done", "error", "cancelled"].includes(d.state)) {
        const id = session?.id;
        jobId = "";
        pending = "";
        if (d.result?.session) session = d.result.session;
        else if (id) session = checked(await api.sessionRead(id)).session;
        renameTitle = session?.title ?? "New chat";
        if (d.state === "error")
          error = d.error ?? "Generation failed. You can retry your message.";
        if (d.state === "cancelled")
          notice = "Generation stopped. Any partial replies were kept in this session.";
        await refreshSessions();
        await refreshModels();
        await scrollEnd();
      } else await scrollEnd();
    } catch (e: any) {
      error = `Waiting for local generation: ${e.message}`;
      if (String(e.message).includes("no longer available") && session?.id) {
        jobId = "";
        pending = "";
        try {
          session = checked(await api.sessionRead(session.id)).session;
        } catch {}
      }
    } finally {
      polling = false;
    }
  }
  onMount(() => {
    byokKeyHeld = hasProviderKey();
    fetch("/api/ai/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ai?.enabled && Array.isArray(data.ai.providers) && data.ai.providers.length > 0) {
          serverAiConfig = data.ai;
          serverProvider = data.ai.providers[0].id as AiProvider;
          serverModel = data.ai.providers[0].models[0] ?? "";
        }
      })
      .catch(() => {});
    presentationMode = presentationConfig.modes.includes("chat")
      ? "chat"
      : (presentationConfig.defaultMode ?? "chat");
    recentSort = readDraft<string>("chat-list-sort", "updated");
    comparisonKind = presentationConfig.comparisonKinds?.[0] ?? "models";
    const removeShortcuts = registerMenuShortcuts(window, () => {
      if (!active || !session || document.querySelector('[role="dialog"]')) return [];
      return [
        {
          id: "rename-current",
          label: "Rename",
          binding: { key: "r", ctrl: true, alt: true, allowInEditable: true },
          disabled: busy || !!operation || attachmentWorking || voiceWorking || micActive,
          onSelect: () => {
            void beginRename();
          },
        },
        {
          id: "pin-current",
          label: "Pin",
          binding: { key: "p", ctrl: true, alt: true, allowInEditable: true },
          onSelect: () => pinSession(session.id),
        },
      ];
    });
    pinnedIds = validPinnedSessions(readDraft("pinned-sessions", []));
    const speech = readDraft<any>("speech-controls", null);
    if (speech && ["NPU", "GPU", "CPU"].includes(speech.device)) voiceDevice = speech.device;
    if (typeof speech?.language === "string") voiceLanguage = speech.language;
    initialize();
    const timer = window.setInterval(() => {
      if (jobId && active && !document.hidden) pollJob();
    }, 250);
    const setupTimer = window.setInterval(() => {
      if (setupBusy) refreshModels().catch((e) => (error = e.message));
    }, 1000);
    return () => {
      destroyed = true;
      removeShortcuts();
      commandRequest++;
      releaseResize?.();
      clearInterval(timer);
      clearTimeout(scrollSave);
      clearInterval(setupTimer);
      if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    };
  });
  async function uploadAttachments(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    const targetSession = session?.id;
    attachmentWorking = true;
    error = "";
    const failures: string[] = [];
    try {
      for (const file of files) {
        try {
          if (attachments.length >= (capabilities?.attachments?.max_files_per_turn ?? 4))
            throw new Error("Remove an attachment before adding another file.");
          if (file.size > (capabilities?.attachments?.max_file_bytes ?? 10 * 1024 * 1024))
            throw new Error("File is too large. Choose a smaller file.");
          const uploaded = checked(await api.attachmentUpload(file));
          if (session?.id !== targetSession) {
            notice = "Upload finished for another chat; choose the file again in the current chat.";
            break;
          }
          attachments = [...attachments, uploaded];
          unsavedUploads.add(uploaded.id);
        } catch (e: any) {
          failures.push(`${file.name}: ${e.message}`);
        }
      }
      if (failures.length)
        error =
          failures.join(" ") +
          " Other attached files were kept. Choose the failed files again to retry.";
    } finally {
      attachmentWorking = false;
    }
  }
  async function removeAttachment(id: string) {
    attachmentWorking = true;
    try {
      if (unsavedUploads.has(id)) checked(await api.attachmentDelete(id));
      unsavedUploads.delete(id);
      attachments = attachments.filter((item) => item.id !== id);
    } catch (e: any) {
      error = e.message;
    } finally {
      attachmentWorking = false;
    }
  }
  async function transcribeRecording(file: File) {
    if (!voiceDevice) {
      error = "Choose a transcription device before recording.";
      return;
    }
    voiceWorking = true;
    error = "";
    const version = ++voiceRequest;
    const targetSession = session?.id;
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    voiceUrl = URL.createObjectURL(file);
    try {
      const result = checked(
        await postAudio("/api/asr", await file.arrayBuffer(), {
          "X-Device": voiceDevice,
          "X-Language": voiceLanguage,
        }),
      );
      if (version !== voiceRequest || session?.id !== targetSession) return;
      attach(result.text);
      notice = `Recording transcribed locally on ${result.device ?? device}. Review and edit the message before sending.`;
    } catch (e: any) {
      if (version === voiceRequest) error = e.message;
    } finally {
      if (version === voiceRequest) voiceWorking = false;
    }
  }
  function clearVoice() {
    voiceRequest++;
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    voiceUrl = "";
    voiceWorking = false;
  }
  async function sendCloudTurn(content: string) {
    const turnId = `turn-${Date.now()}`;
    jobId = `cloud-${Date.now()}`;
    job = { job_id: jobId, state: "running", device: "Cloud", results: [] };
    draft = "";
    clearVoice();
    pendingAttachments = attachments;
    unsavedUploads.clear();
    attachments = [];
    await scrollEnd(true);

    // The Convex action takes text only, so this path stays on the plain string contract.
    type CloudMessage = { role: "user" | "assistant"; content: string };
    const history: CloudMessage[] = (session?.turns ?? []).flatMap((t: any) => [
      { role: "user" as const, content: String(t.content ?? "") },
      ...(t.replies ?? [])
        .filter((r: any) => r.text && !r.error)
        .map((r: any) => ({
          role: "assistant" as const,
          content: r.text,
        })),
    ]);
    const messages: CloudMessage[] = [...history, { role: "user" as const, content }];
    const ref = modelId.includes("/") ? modelId : `openai/${modelId}`;

    const startMs = Date.now();
    try {
      const result = await cloudTurn({ ref, messages });
      const elapsed = Date.now() - startMs;
      if (result.ok) {
        const reply = {
          text: result.text,
          model_id: result.model,
          model_label: `${result.provider}/${result.model}`,
          device: "Cloud",
          ms: elapsed,
          error: null,
        };
        const newTurn = {
          id: turnId,
          content,
          attachments: pendingAttachments,
          status: "done",
          created_at: Date.now(),
          replies: [reply],
        };
        const turns = [...(session?.turns ?? []), newTurn];
        const title =
          session?.title === "New chat"
            ? content.slice(0, 60) || "New chat"
            : session?.title ?? "New chat";
        session = { ...session, title, turns };
        renameTitle = session.title;
        await api.sessionUpdate(session.id, { title, turns, settings: settings() });
        await refreshSessions();
      } else {
        error = result.message;
        const reply = {
          text: "",
          model_id: modelId,
          model_label: "Cloud assistant",
          device: "Cloud",
          ms: elapsed,
          error: result.message,
        };
        const newTurn = {
          id: turnId,
          content,
          attachments: pendingAttachments,
          status: "error",
          created_at: Date.now(),
          replies: [reply],
        };
        const turns = [...(session?.turns ?? []), newTurn];
        session = { ...session, turns };
        await api.sessionUpdate(session.id, { turns, settings: settings() });
      }
    } finally {
      jobId = "";
      job = null;
      pending = "";
      pendingAttachments = [];
      await scrollEnd();
    }
  }

  async function sendServerTurn(content: string) {
    const turnId = `turn-${Date.now()}`;
    jobId = `server-${Date.now()}`;
    job = { job_id: jobId, state: "running", device: "BYOK", partial: "", results: [] };
    draft = "";
    clearVoice();
    pendingAttachments = attachments;
    unsavedUploads.clear();
    attachments = [];
    await scrollEnd(true);

    const history: ChatMessage[] = (session?.turns ?? []).flatMap((t: any) => [
      { role: "user" as const, content: t.content },
      ...(t.replies ?? [])
        .filter((r: any) => r.text && !r.error)
        .map((r: any) => ({
          role: "assistant" as const,
          content: r.text,
        })),
    ]);
    const messages: ChatMessage[] = [...history, { role: "user" as const, content }];

    const providerEntry =
      serverAiConfig?.providers.find((entry) => entry.id === serverProvider) ??
      serverAiConfig?.providers?.[0];
    const provider: AiProvider = (providerEntry?.id as AiProvider) ?? "openai";
    const chosenModel =
      providerEntry?.models.find((name) => name === serverModel) ??
      providerEntry?.models?.[0] ??
      modelId;
    // Tab-scoped only. The old `localStorage` fallback meant any key this origin had ever
    // persisted was picked up and sent on the user's behalf.
    const apiKey = readProviderKey();
    // Saved notes reach the model as untrusted context, never as an instruction. `context()`
    // is already bounded to MAX_CONTEXT_CHARS, so the server never sees more than that.
    const memory = memoryStore.context();

    // Without a key the route is guaranteed to reject the body, so say that here instead of
    // spending a round trip on a 400 the user cannot read.
    if (!apiKey) {
      error =
        "This server has AI enabled but holds no key for this tab. Add one under Chat settings → Bring your own key.";
      pending = "";
      return;
    }

    activeAbortController = new AbortController();
    const startMs = Date.now();

    try {
      const result = await streamServerChat(
        {
          provider,
          model: chosenModel,
          apiKey,
          messages,
          ...(memory ? { memory } : {}),
          ...(serverToolUse ? { toolUse: true } : {}),
        },
        (partial) => {
          job = { ...job, partial };
        },
        activeAbortController.signal,
      );

      const elapsed = Date.now() - startMs;
      if (result.error) {
        error = result.error;
        const reply = {
          text: result.text,
          model_id: chosenModel,
          model_label: `${provider}/${chosenModel}`,
          device: "BYOK",
          ms: elapsed,
          error: result.error,
        };
        const newTurn = {
          id: turnId,
          content,
          attachments: pendingAttachments,
          status: "error",
          created_at: Date.now(),
          replies: [reply],
        };
        const turns = [...(session?.turns ?? []), newTurn];
        session = { ...session, turns };
        await api.sessionUpdate(session.id, { turns, settings: settings() });
      } else {
        const reply = {
          text: result.text,
          model_id: chosenModel,
          model_label: `${provider}/${chosenModel}`,
          device: "BYOK",
          ms: elapsed,
          error: null,
        };
        const newTurn = {
          id: turnId,
          content,
          attachments: pendingAttachments,
          status: "done",
          created_at: Date.now(),
          replies: [reply],
        };
        const turns = [...(session?.turns ?? []), newTurn];
        const title =
          session?.title === "New chat"
            ? content.slice(0, 60) || "New chat"
            : session?.title ?? "New chat";
        session = { ...session, title, turns };
        renameTitle = session.title;
        await api.sessionUpdate(session.id, { title, turns, settings: settings() });
        await refreshSessions();
      }
    } finally {
      activeAbortController = null;
      jobId = "";
      job = null;
      pending = "";
      pendingAttachments = [];
      await scrollEnd();
    }
  }

  async function sendStubTurn(content: string) {
    notice = "No provider configured";
    const d = checked(
      await api.chatStart({
        session_id: session.id,
        content,
        model_id: isCompare ? comparisonTargets[0].model_id : modelId,
        device: isCompare ? comparisonTargets[0].device : device || selectedDevices[0],
        max_new_tokens: maxTokens,
        compare_devices: !isCompare && comparison ? selectedDevices : [],
        compare_targets: isCompare ? comparisonTargets : [],
        compare_kind: isCompare ? comparisonKind : "models",
        tool_ids: toolIds,
        attachment_ids: attachments.map((item) => item.id),
      }),
    );
    pendingAttachments = attachments;
    unsavedUploads.clear();
    attachments = [];
    jobId = d.job_id;
    job = d;
    draft = "";
    clearVoice();
    await scrollEnd(true);
    await pollJob();
  }

  async function send() {
    const content =
      draft.trim() || (attachments.length ? "Help me understand these attached files." : "");
    if (
      !content ||
      busy ||
      !session ||
      (!cloudAvailable() &&
        !serverAiAvailable() &&
        ((!isCompare && !model?.installed) ||
          !modelCompatible ||
          !selectedDevices.length)) ||
      operation ||
      attachmentWorking ||
      voiceWorking ||
      micActive
    )
      return;
    error = "";
    notice = "";
    pending = content;
    operation = "send";
    try {
      checked(await api.sessionUpdate(session.id, { settings: settings() }));

      // Decision point: Convex cloud chat -> SvelteKit BYOK /api/ai/chat -> Fallback stub
      const backendKind = resolveChatBackend({
        cloudAvailable: cloudAvailable(),
        serverAiAvailable: serverAiAvailable(),
      });

      if (backendKind === "convex") {
        await sendCloudTurn(content);
      } else if (backendKind === "server") {
        await sendServerTurn(content);
      } else {
        await sendStubTurn(content);
      }
    } catch (e: any) {
      error = e.message;
      pending = "";
    } finally {
      operation = "";
    }
  }
  async function stop() {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
      notice = "Generation stopped.";
      return;
    }
    if (!jobId) return;
    try {
      checked(await api.chatCancel(jobId));
      notice =
        "Stop requested. Compilation or prefill may need to finish before cancellation takes effect.";
    } catch (e: any) {
      error = e.message;
    }
  }
  async function prepareModel(action: "load" | "download") {
    operation = action;
    error = "";
    try {
      checked(
        action === "load"
          ? await api.chatLoad(device || "NPU", modelId)
          : await api.chatDownload(modelId),
      );
      await refreshModels();
    } catch (e: any) {
      error = e.message;
    } finally {
      operation = "";
    }
  }
  async function updateTitle() {
    if (!session || busy || operation || attachmentWorking || voiceWorking || micActive) return;
    operation = "rename";
    try {
      session = checked(await api.sessionUpdate(session.id, { title: renameTitle })).session;
      await refreshSessions();
      renaming = false;
      notice = "Chat renamed.";
    } catch (e: any) {
      error = e.message;
    } finally {
      operation = "";
    }
  }
  async function beginRename() {
    renameTitle = session?.title ?? "";
    renaming = true;
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }
  async function modifySession(action: "clear" | "delete") {
    if (!session || busy || operation || attachmentWorking || voiceWorking || micActive) return;
    operation = action;
    error = "";
    try {
      const id = session.id;
      if (action === "clear") session = checked(await api.sessionClear(id)).session;
      else {
        checked(await api.sessionDelete(id));
        clearDraft(`chat:${id}`);
        clearVoice();
        draft = "";
        attachments = [];
        session = null;
        await refreshSessions();
        if (sessions.length) {
          applySession(checked(await api.sessionRead(sessions[0].id)).session);
          const stored = readDraft<any>(`chat:${session.id}`, null);
          draft = typeof stored?.content === "string" ? stored.content : "";
          attachments = Array.isArray(stored?.attachments) ? stored.attachments : [];
        } else await newSession();
      }
      confirmation = "";
      await refreshSessions();
      notice = action === "clear" ? "Chat messages cleared." : "Chat deleted.";
    } catch (e: any) {
      error = e.message;
    } finally {
      operation = "";
    }
  }
  function askMessageRemoval(
    turn: any,
    target: "turn" | "reply" | "attachment",
    value?: number | string,
  ) {
    if (!session || busy || operation || attachmentWorking || voiceWorking || micActive) return;
    confirmation = "";
    messageRemoval = {
      id: session.id,
      turn_id: turn.id,
      target,
      expected_version: session.version,
      ...(target === "reply" ? { reply_index: value as number } : {}),
      ...(target === "attachment" ? { attachment_id: value as string } : {}),
      label:
        target === "turn"
          ? "Delete your message and its replies?"
          : target === "reply"
            ? "Delete this assistant reply?"
            : "Remove this attachment from the saved message?",
    };
  }
  async function removeMessage() {
    if (!messageRemoval || busy || operation || micActive || attachmentWorking || voiceWorking)
      return;
    const { label: _, ...selection } = messageRemoval;
    if (selection.id !== session?.id) return;
    operation = "remove-message";
    error = "";
    try {
      const result = checked(
        await post("/api/sessions/message-delete", { ...selection, confirm: true }),
      );
      if (session?.id !== selection.id) return;
      session = result.session;
      renameTitle = session.title;
      messageRemoval = null;
      await refreshSessions();
      notice =
        "Removed from this chat. Saved tool activity and copies in other chats are preserved.";
    } catch (e: any) {
      error = e.message;
      if (session?.id === selection.id) {
        try {
          session = checked(await api.sessionRead(selection.id)).session;
        } catch {}
        messageRemoval = null;
      }
    } finally {
      operation = "";
    }
  }
  async function exportSession() {
    if (!session) return;
    try {
      const d = checked(await api.sessionExport(session.id));
      const content =
        typeof d.content === "string" ? d.content : JSON.stringify(d.content, null, 2);
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = d.filename ?? "laya-session.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      error = e.message;
    }
  }
  function attach(text: string) {
    const max = catalogue?.limits?.max_message_chars ?? 4000;
    const next = [draft, text].filter(Boolean).join("\n\n");
    draft = next.slice(0, max);
    if (next.length > max)
      notice =
        "Attached text was shortened to the message limit. The full tool result remains visible.";
    openPanel("");
    composerInput?.focus();
  }
  async function previewProposal(proposal: any, target?: CompareTarget, index = 0) {
    const request = ++proposalRequest;
    const owner = session?.id;
    proposalOrigin = target ? { target: { ...target }, index } : null;
    error = "";
    try {
      const split = proposal.tool_id.lastIndexOf("::");
      if (split < 0) throw new Error("This proposal does not name a connected tool.");
      const approval = checked(
        await api.mcpPrepare({
          connection_id: proposal.tool_id.slice(0, split),
          tool: proposal.tool_id.slice(split + 2),
          arguments: proposal.arguments ?? {},
          session_id: session?.id,
        }),
      );
      if (destroyed || request !== proposalRequest || session?.id !== owner) return;
      toolApproval = approval;
      toolResult = null;
    } catch (e: any) {
      if (!destroyed && request === proposalRequest && session?.id === owner) error = e.message;
    }
  }
  async function runProposal() {
    if (!toolApproval) return;
    const approval = toolApproval;
    const origin = proposalOrigin;
    const owner = session?.id;
    operation = "tool";
    try {
      const result = checked(await api.mcpCall(approval.approval_id));
      if (destroyed || session?.id !== owner) return;
      toolResult = result;
      if (origin) openComparisonOutput(origin.target, origin.index, toolResult);
      toolApproval = null;
      await refreshToolHistory();
    } catch (e: any) {
      error = e.message;
      toolApproval = null;
    } finally {
      operation = "";
    }
  }
  async function refreshToolHistory() {
    if (!session?.id) return;
    const id = session.id;
    try {
      const d = checked(await api.sessionRead(id));
      if (session?.id === id) session = d.session;
    } catch (e: any) {
      notice = `Tool ran, but session history could not refresh: ${e.message}`;
    }
  }
  async function refreshCommandResources() {
    if (commandLoading || destroyed) return;
    const request = ++commandRequest;
    commandLoading = true;
    commandError = "";
    const items = commandResources.filter((item) => item.kind === "category");
    commandResources = items;
    commandIndex = 0;
    const values = await Promise.allSettled([
      api.mcpStatus(),
      api.mcpTools("local-laya"),
      get("/api/chat/resources"),
    ]);
    if (destroyed || request !== commandRequest) return;
    const value = (index: number) => {
      const row = values[index];
      if (row.status === "rejected" || row.value?.error) {
        commandError = "Some resources could not be loaded. Refresh to try again.";
        return null;
      }
      return row.value;
    };
    const status = value(0),
      local = value(1),
      resources = value(2);
    for (const connection of status?.connections ?? [])
      if (typeof connection.id === "string" && typeof connection.name === "string")
        items.push({
          id: `connection:${connection.id}`,
          label: connection.name,
          kind: "connection",
          connectionId: connection.id,
          description: "MCP server",
          panel: "tools",
        });
    for (const tool of local?.tools ?? [])
      if (typeof tool.name === "string")
        items.push({
          id: `local-laya::${tool.name}`,
          label: tool.name,
          kind: "tool",
          connectionId: "local-laya",
          toolName: tool.name,
          description: String(tool.description ?? "MCP tool").slice(0, 300),
          panel: "tools",
        });
    for (const skill of resources?.skills ?? [])
      if (typeof skill.id === "string" && typeof skill.name === "string")
        items.push({
          id: `skill:${skill.id}`,
          label: skill.name,
          kind: "skill",
          skillId: skill.id,
          description: String(skill.description ?? "Installed skill").slice(0, 300),
          panel: "skills",
        });
    for (const plugin of resources?.plugins ?? [])
      if (typeof plugin.id === "string" && typeof plugin.name === "string")
        items.push({
          id: `plugin:${plugin.id}`,
          label: plugin.name,
          kind: "plugin",
          description: String(plugin.description ?? "Plugin").slice(0, 300),
          panel: "tools",
          connectionId: plugin.connection_id,
        });
    commandResources = [...new Map(items.map((item) => [item.id, item])).values()];
    commandIndex = 0;
    commandLoading = false;
  }
  function resourcesChanged() {
    commandRequest++;
    commandLoading = false;
    refreshCommandResources();
  }
  function observeComposer(event: Event) {
    const field = event.currentTarget as HTMLTextAreaElement;
    commandCaret = field.selectionStart;
    commandSelectionEnd = field.selectionEnd;
  }
  async function chooseResource(item: ComposerResource) {
    if (busy || operation) return;
    if (item.kind === "tool" && !toolIds.includes(item.id)) {
      const limit = capabilities?.mcp?.max_selected_tools;
      if (!Number.isInteger(limit) || toolIds.length >= limit) {
        error = "Deselect a chat tool in Tools before adding another.";
        return;
      }
    }
    const token = commandQuery;
    if (token) {
      const result = replaceComposerCommand(draft, token);
      if (!result.replaced) return;
      draft = result.text;
      commandCaret = result.caret;
      commandSelectionEnd = result.caret;
    }
    dismissedCommand = commandSignature;
    resourcePickerOpen = false;
    if (item.kind === "mode" && item.mode) {
      choosePresentationMode(item.mode);
      await tick();
      composerInput?.focus();
      composerInput?.setSelectionRange(commandCaret, commandCaret);
      return;
    }
    if (item.kind === "action" && item.action === "attach") {
      filePicker?.click();
      return;
    }
    if (item.kind === "tool") {
      const limit = capabilities?.mcp?.max_selected_tools;
      if (!toolIds.includes(item.id)) {
        if (!Number.isInteger(limit) || toolIds.length >= limit) {
          error = "Deselect a chat tool in Tools before adding another.";
          return;
        }
        toolIds = [...toolIds, item.id];
      }
      notice = `${item.label} is available to this chat. Any tool call still needs approval.`;
    }
    resourceFocus = {
      connectionId: item.connectionId ?? "",
      toolName: item.toolName ?? "",
      skillId: item.skillId ?? "",
      tab:
        item.id === "plugins" || item.kind === "plugin"
          ? "plugins"
          : item.kind === "skill" || item.panel === "skills"
            ? "skills"
            : "mcp",
    };
    openPanel(item.panel ?? "tools");
    await tick();
    composerInput?.setSelectionRange(commandCaret, commandCaret);
  }
  function resizeInspector(event: PointerEvent, kind: "navigation" | "inspector") {
    if (event.button !== 0) return;
    releaseResize?.();
    const initial = kind === "navigation" ? visibleSidebarWidth : visibleInspectorWidth;
    const width = kind === "navigation" ? chatWidth : chatContentWidth;
    releaseResize = beginPanelResize(event, (deltaX) => {
      if (kind === "navigation") sidebarWidth = dragNavigationWidth(initial, deltaX, width);
      else inspectorWidth = dragInspectorWidth(initial, deltaX, width);
    });
  }
  function resizeInspectorKey(event: KeyboardEvent, kind: "navigation" | "inspector") {
    const next =
      kind === "navigation"
        ? keyboardNavigationWidth(event.key, visibleSidebarWidth, chatWidth, event.shiftKey)
        : keyboardInspectorWidth(
            event.key,
            visibleInspectorWidth,
            chatContentWidth,
            event.shiftKey,
          );
    if (next === null) return;
    event.preventDefault();
    if (kind === "navigation") sidebarWidth = next;
    else inspectorWidth = next;
  }
  function onKey(e: KeyboardEvent) {
    if (commandVisible && !e.isComposing) {
      if (e.key === "Tab") {
        resourcePickerOpen = false;
        dismissedCommand = commandSignature;
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        resourcePickerOpen = false;
        dismissedCommand = commandSignature;
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        commandIndex = nextComposerSelection(commandIndex, e.key, commandMatches.length);
        tick().then(() => {
          if (!destroyed && commandVisible)
            document.getElementById(`composer-resource-${commandIndex}`)?.scrollIntoView({
              block: "nearest",
              inline: "nearest",
            });
        });
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const item = commandMatches[commandIndex];
        if (item) chooseResource(item);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }
  async function withRowSession(item: any, action: () => unknown) {
    if (busy || operation || attachmentWorking || voiceWorking || micActive) return;
    if (session?.id !== item.id) await readSession(item.id);
    if (session?.id === item.id) await action();
  }
  function sessionMenu(item: any): WorkspaceMenuItem[] {
    const handlers: Record<string, () => void> = {
      rename: () => {
        void withRowSession(item, beginRename);
      },
      pin: () => pinSession(item.id),
      "section-pinned": () => {
        if (!pinnedIds.includes(item.id)) pinSession(item.id);
      },
      "section-recents": () => {
        if (pinnedIds.includes(item.id)) pinSession(item.id);
      },
      export: () => {
        void withRowSession(item, exportSession);
      },
      "remove-project": () => {
        projectStore.assign(item.id, null);
        projectVersion += 1;
      },
      delete: () => {
        void withRowSession(item, () => {
          confirmation = "delete";
        });
      },
    };
    const bind = (actions: readonly ChatMenuAction[]): WorkspaceMenuItem[] =>
      actions.map((action) => ({
        ...action,
        label: action.id === "pin" && pinnedIds.includes(item.id) ? "Unpin" : action.label,
        separatorBefore: action.separator,
        description: action.disabledReason,
        shortcut: session?.id === item.id ? action.shortcut : undefined,
        disabled:
          !!action.disabledReason ||
          busy ||
          !!operation ||
          attachmentWorking ||
          voiceWorking ||
          micActive ||
          (!action.children && !handlers[action.id]),
        children: action.children?.length
          ? bind(action.children)
          : action.id === "move-project"
            ? projectMenuItems().map((row) => ({
                ...row,
                onSelect: () => moveToProject(item.id, row.id),
              }))
            : undefined,
        onSelect: handlers[action.id],
      }));
    return bind(uiConfig.sessionMenu);
  }
  function recentOptions(): WorkspaceMenuItem[] {
    return [
      { id: "updated", label: "Last updated" },
      { id: "created", label: "Date created" },
      { id: "title", label: "Name" },
    ].map((item) => ({
      ...item,
      icon: recentSort === item.id ? "check" : undefined,
      onSelect: () => {
        recentSort = item.id;
        saveDraft("chat-list-sort", recentSort);
      },
    }));
  }
  function recentFilters(): WorkspaceMenuItem[] {
    return [
      { id: "all", label: "All chats" },
      { id: "messages", label: "With messages" },
      { id: "empty", label: "Empty chats" },
    ].map((item) => ({
      ...item,
      icon: recentFilter === item.id ? "check" : undefined,
      onSelect: () => {
        recentFilter = item.id;
      },
    }));
  }
  async function closeSessionDrawer() {
    navigationOpen = false;
    await tick();
    (
      document.getElementById("sidebar-toggle") ?? document.getElementById("session-drawer-trigger")
    )?.focus();
  }
</script>

{#snippet transcriptContent(lane?: CompareTarget, laneIndex = 0)}
  {#if sessionLoading}<div class="conversation-empty">
      <h1>Loading your chats</h1>
      <p>Reading the chats saved in this tab…</p>
    </div>{:else if !lane && !session?.turns?.length && !pending}<div class="conversation-empty">
      <h1>
        {presentationMode === "work" ? "What should we work on?" : "What would you like to do?"}
      </h1>
    </div>{/if}
  {#each (session?.turns ?? []).filter((turn: any) => !jobId || turn.status !== "running") as turn}<section
      class="conversation-turn"
    >
      <article class="conversation-user">
        <MessageFrame
          tone="user"
          time={messageTime(turn.created_at).text}
          datetime={messageTime(turn.created_at).iso}
        >
          {#snippet children()}
            <h2 class="sr-only">You</h2>
            <p>{turn.content}</p>

            {#if turn.attachments?.length}<div class="saved-attachments">
                {#each turn.attachments as file}<div class="saved-attachment">
                    <AttachmentPreview {file} />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${file.name} from this message`}
                      title="Remove attachment from message"
                      onclick={() => askMessageRemoval(turn, "attachment", file.id)}
                      disabled={busy ||
                        !!operation ||
                        attachmentWorking ||
                        voiceWorking ||
                        micActive}><Icon name="x" size={14} /></Button
                    >
                  </div>{/each}
              </div>{/if}
          {/snippet}
          {#snippet actions()}
            <div class="message-actions user-message-actions">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy your message"
                title="Copy message"
                onclick={() => copyText(turn.content, `user-${turn.id}`)}
                ><Icon
                  name={copiedItem === `user-${turn.id}` ? "check" : "copy"}
                  size={14}
                /></Button
              ><Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit message in a new branch"
                title="Edit in a new branch"
                onclick={() => forkSession(turn.id, "user")}
                disabled={busy || !!operation}><Icon name="fork" size={14} /></Button
              ><Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete your message and its replies"
                title="Delete message and replies"
                onclick={() => askMessageRemoval(turn, "turn")}
                disabled={busy || !!operation || attachmentWorking || voiceWorking || micActive}
                ><Trash2 size={14} /></Button
              >
            </div>{/snippet}
        </MessageFrame>
      </article>
      <div class="conversation-replies" class:comparison-replies={turn.replies?.length > 1}>
        {#each (turn.replies ?? []).filter( (reply: any) => matchesLane(reply, lane) ) as reply}{@const replyIndex =
            (turn.replies ?? []).indexOf(reply)}{@const m = metrics(reply)}
          <article class="conversation-assistant">
            <MessageFrame tone="assistant">
              {#snippet children()}
                <div class="reply-heading">
                  <strong>{reply.device ?? "Local assistant"}</strong><span
                    >{reply.model_label ?? reply.model_id ?? "Saved model"}</span
                  >
                  {#if reply.model_capabilities && !reply.imported}
                    <ModelCapabilities capabilities={reply.model_capabilities} compact />
                  {/if}
                </div>
                {#if reply.error}<RecoveryNotice message={reply.error} />{:else}<div
                    class="reply-text"
                  >
                    <RichText text={reply.text ?? ""} />
                    {#if extractArtifact(reply.text ?? "")}
                      {@const view = extractArtifact(reply.text ?? "")!}
                      <ArtifactFrame html={view.html} title={view.title} />
                    {/if}
                  </div>
                {/if}
                {#if reply.comparison_timing}<p class="reply-note">
                    Parallel · preparation {Math.round(reply.comparison_timing.preparation_ms)} ms · inference
                    {m.ms ?? reply.ms ?? "—"} ms<br />Shared host resources; this is a concurrent
                    workload measurement.
                  </p>{/if}

                {#if turn.attachments?.length && reply.attachment_context?.note}<p
                    class="reply-note"
                  >
                    {reply.attachment_context.note}
                  </p>{/if}
                {#if m.context_omitted_turns > 0}<p class="reply-note">
                    {m.context_omitted_turns} older turns omitted from this model input. The full session
                    remains saved.
                  </p>{/if}
                {#if m.truncated || m.timed_out}<p class="reply-note">
                    {m.timed_out
                      ? "Generation reached its time limit."
                      : "Reply reached the output limit."}
                  </p>{/if}
                {#each reply.tool_proposals ?? [] as proposal}<div class="tool-proposal">
                    <strong>Proposed tool: {proposal.tool_id}</strong>
                    <p>{proposal.reason ?? "Review the arguments before this tool can run."}</p>
                    <pre>{JSON.stringify(proposal.arguments ?? {}, null, 2)}</pre>
                    <button
                      class="btn"
                      onclick={() => previewProposal(proposal, lane, laneIndex)}
                      disabled={busy || !!operation}>Preview tool call</button
                    >
                    {#if lane}<button
                        class="btn"
                        aria-label={`Open tool output for comparison ${laneIndex + 1}`}
                        disabled={!lane.model_id || !lane.device}
                        onclick={() => openComparisonOutput(lane, laneIndex)}
                        >Open tool output</button
                      >{/if}
                  </div>{/each}
              {/snippet}
              {#snippet actions()}
                <div class="reply-footer">
                  {@render replyMetrics(m)}
                  <div class="reply-actions">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Copy assistant reply"
                      title="Copy reply"
                      onclick={() =>
                        copyText(reply.text || reply.error || "", `reply-${turn.id}-${replyIndex}`)}
                      ><Icon
                        name={copiedItem === `reply-${turn.id}-${replyIndex}` ? "check" : "copy"}
                        size={14}
                      /></Button
                    ><Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Branch from this reply"
                      title="Branch from reply"
                      onclick={() => forkSession(turn.id, "assistant", replyIndex)}
                      disabled={busy || !!operation}><Icon name="fork" size={14} /></Button
                    ><Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete assistant reply"
                      title="Delete reply"
                      onclick={() => askMessageRemoval(turn, "reply", replyIndex)}
                      disabled={busy ||
                        !!operation ||
                        attachmentWorking ||
                        voiceWorking ||
                        micActive}><Trash2 size={14} /></Button
                    >
                  </div>
                </div>{/snippet}
            </MessageFrame>
          </article>{/each}
      </div>
      {#if turn.status === "error" && turn.error}<RecoveryNotice
          message={turn.error}
        />{:else if turn.status === "cancelled"}<p class="reply-note">
          Generation stopped. Partial replies, if any, are shown above.
        </p>{/if}{#if turn.context}<p class="reply-note">
          {turn.context.note ??
            "An explicit context window was used; the full session remains saved."}
        </p>{/if}
    </section>{/each}
  {#if !lane && session?.tool_events?.length}<details class="conversation-turn tool-history">
      <summary>Saved tool activity · {session.tool_events.length} calls</summary
      >{#each session.tool_events as event}<article class="tool-result">
          <strong>{event.tool} · {event.result?.isError ? "Failed" : "Completed"}</strong>
          <p>{event.connection_id} · {stamp(event.created_at)}</p>
          <pre>{JSON.stringify({ arguments: event.arguments, result: event.result }, null, 2)}</pre>
          <button
            class="btn"
            onclick={() =>
              attach(`Saved tool result from ${event.tool}:\n${JSON.stringify(event.result)}`)}
            >Attach to message</button
          >
        </article>{/each}
    </details>{/if}
  {#if pending}{@const laneJob = lane
      ? (job?.lanes ?? []).find((row: any) => row.comparison_id === comparisonId(lane))
      : job}
    <section class="conversation-turn">
      <article class="conversation-user">
        <MessageFrame tone="user">
          <h2 class="sr-only">You</h2>
          <p>{pending}</p>
        </MessageFrame>
      </article>
      <div class="conversation-replies" class:comparison-replies={comparison}>
        {#each (job?.results ?? []).filter( (reply: any) => matchesLane(reply, lane) ) as completed}<article
            class="conversation-assistant"
          >
            <div class="reply-heading">
              <strong>{completed.device}</strong><span>Completed</span>
              {#if completed.model_capabilities}
                <ModelCapabilities capabilities={completed.model_capabilities} compact />
              {/if}
            </div>
            {#if completed.error}<RecoveryNotice message={completed.error} />{:else}<div
                class="reply-text"
              >
                <RichText text={completed.text ?? ""} />
                {#if extractArtifact(completed.text ?? "")}
                  {@const view = extractArtifact(completed.text ?? "")!}
                  <ArtifactFrame html={view.html} title={view.title} />
                {/if}
              </div>
              <div class="reply-footer">{@render replyMetrics(metrics(completed))}</div>{/if}
          </article>{/each}
      </div>
      {#if !lane || !(job?.results ?? []).some((reply: any) => matchesLane(reply, lane))}<article
          class="conversation-assistant"
        >
          <div class="reply-heading">
            <strong>{lane?.device ?? job?.device ?? selectedDevices.join(" / ")}</strong><span
              >{lane && !laneJob
                ? "Waiting for this candidate…"
                : laneJob?.state === "preparing" ||
                    job?.state === "preparing" ||
                    job?.state === "loading"
                  ? "Preparing model…"
                  : isCompare || comparison
                    ? job?.execution === "parallel"
                      ? "Generating candidates together…"
                      : "Waiting for comparison runtime…"
                    : "Generating locally…"}</span
            >
          </div>
          {#if laneJob?.partial}<div class="reply-text streaming-text">
              <RichText text={laneJob.partial} /><span class="streaming-caret" aria-hidden="true"
              ></span>
            </div>{:else}<div class="generation-status" role="status">
              <span class="typing-indicator" aria-hidden="true"><i></i><i></i><i></i></span><span
                >{lane && !laneJob
                  ? "Waiting"
                  : laneJob?.state === "preparing" ||
                      job?.state === "preparing" ||
                      job?.state === "loading"
                    ? "Preparing model"
                    : job?.state === "queued" || !job
                      ? "Starting"
                      : "Thinking"}</span
              >
            </div>{/if}
        </article>{/if}
    </section>{/if}
{/snippet}

{#snippet chatToolbar()}
  <ChatHeader title={session?.title ?? "Chat"}>
    {#snippet leading()}
      {#if !splitLayout}<button
          id="session-drawer-trigger"
          class="btn session-drawer-trigger"
          aria-label="Open saved chats"
          onclick={() => (navigationOpen = true)}><Icon name="sidebar" size={16} /></button
        >{/if}
    {/snippet}
    {#snippet actions()}
      <button
        class="btn"
        aria-label={outputOpen ? "Hide output panel" : "Show output panel"}
        title="Output panel"
        onclick={onToggleOutput}><Icon name="sidebar" size={16} /></button
      >
      <DropdownMenu.Root
        ><DropdownMenu.Trigger class="btn" aria-label="Chat actions" title="Chat actions"
          ><Icon name="more" size={17} /></DropdownMenu.Trigger
        ><DropdownMenu.Portal
          ><DropdownMenu.Content
            class="workspace-overflow-menu"
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={10}
            loop
          >
            <DropdownMenu.Item
              class="workspace-overflow-item"
              disabled={!session || busy || !!operation}
              onSelect={beginRename}><Pencil size={14} />Rename chat</DropdownMenu.Item
            >
            <DropdownMenu.Item
              class="workspace-overflow-item"
              disabled={!session || busy || !!operation}
              onSelect={() => forkSession()}
              ><Icon name="fork" size={14} />Branch chat</DropdownMenu.Item
            >
            <DropdownMenu.Item
              class="workspace-overflow-item"
              disabled={!session || busy}
              onSelect={exportSession}
              ><Icon name="folder" size={14} />Export chat</DropdownMenu.Item
            >
            <DropdownMenu.Separator class="chat-menu-separator" />
            <DropdownMenu.Item class="workspace-overflow-item" onSelect={() => openPanel("utils")}
              >Chat details</DropdownMenu.Item
            >
            <DropdownMenu.Item class="workspace-overflow-item" onSelect={() => openPanel("tools")}
              >Resources</DropdownMenu.Item
            >
            <DropdownMenu.Item class="workspace-overflow-item" onSelect={() => onNavigate("apps")}
              >Automation</DropdownMenu.Item
            >
            <DropdownMenu.Item class="workspace-overflow-item" onSelect={() => openPanel("tools")}
              >Chat tools</DropdownMenu.Item
            >
            <DropdownMenu.Item class="workspace-overflow-item" onSelect={() => openPanel("models")}
              >Chat settings</DropdownMenu.Item
            >
            <DropdownMenu.Item
              class="workspace-overflow-item"
              onSelect={() => (contextSummaryOpen = true)}>Context summary</DropdownMenu.Item
            >
            <DropdownMenu.Separator class="chat-menu-separator" />
            <DropdownMenu.Item
              class="workspace-overflow-item"
              disabled={!session ||
                busy ||
                !!operation ||
                attachmentWorking ||
                voiceWorking ||
                micActive}
              onSelect={() => {
                messageRemoval = null;
                confirmation = "delete";
              }}><Trash2 size={14} />Delete chat</DropdownMenu.Item
            >
          </DropdownMenu.Content></DropdownMenu.Portal
        ></DropdownMenu.Root
      >
    {/snippet}
  </ChatHeader>
{/snippet}

<Dialog.Root bind:open={contextSummaryOpen}
  ><Dialog.Portal
    ><Dialog.Overlay class="chat-summary-overlay" /><Dialog.Content
      class="chat-context-summary chat-summary-dialog"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        void tick().then(() =>
          requestAnimationFrame(() => {
            if (!document.querySelector('[role="dialog"]:not([data-state="closed"])'))
              document
                .querySelector<HTMLButtonElement>(
                  '.conversation-toolbar [aria-label="Chat actions"]',
                )
                ?.focus();
          }),
        );
      }}
      ><Dialog.Title>Context summary</Dialog.Title><Dialog.Description
        >Current chat configuration and permissions</Dialog.Description
      >
      <h3>Local model</h3>
      <p>{model?.label ?? "No model selected"}<br />{device || "No device selected"}</p>
      <ModelCapabilities capabilities={model?.capabilities} compact />
      <h3>Context</h3>
      <button class="summary-row" onclick={() => openPanel("utils")}
        ><Icon name="message" size={15} />{session?.title ?? "New chat"}</button
      >
      <p>
        {attachments.length} attached files · {toolIds.length} selected tools · {outputTabCount}
        output tabs
      </p>
      <h3>Access</h3>
      <p>
        Nothing runs from this panel. Each computer action or document write needs its own review and approval.
      </p>
      <button class="btn" onclick={() => openPanel("tools")}>Manage tools</button>
      <Dialog.Close class="btn">Close</Dialog.Close></Dialog.Content
    ></Dialog.Portal
  ></Dialog.Root
>
<svelte:window
  bind:innerWidth={viewportWidth}
  onpointerdown={(event) => {
    if (
      commandVisible &&
      event.target instanceof Element &&
      !event.target.closest(".conversation-composer")
    ) {
      resourcePickerOpen = false;
      dismissedCommand = commandSignature;
    }
  }}
  onkeydown={(event) => {
    if (commandVisible && event.key === "Escape") {
      event.preventDefault();
      closeResourcePicker();
      return;
    }
    if (!navigationOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeSessionDrawer();
    } else if (event.key === "Tab") {
      const items = Array.from(
        document
          .querySelector(".session-sidebar")!
          .querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]"),
      ).filter((item) => item.getClientRects().length);
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }}
/>

{#snippet replyMetrics(m: any)}
  <div class="reply-statistics">
    {#if numeric(m.ms)}<span title="Total generation time"
        ><Icon name="clock" size={13} /><span>{(m.ms / 1000).toFixed(2)} s</span></span
      >{/if}
    {#if numeric(m.tokens_per_second)}<span title="Generation speed"
        ><Icon name="gauge" size={13} /><span>{m.tokens_per_second.toFixed(1)} tok/s</span></span
      >{/if}
    {#if numeric(m.generated_tokens)}<span title="Generated tokens"
        ><Icon name="layers" size={13} /><span>{m.generated_tokens} tok</span></span
      >{/if}
  </div>
{/snippet}

{#snippet sessionRow(item: any)}
  <ChatListRow selected={session?.id === item.id}>
    {#snippet children()}
      <button
        class="session-open"
        onclick={() => readSession(item.id)}
        disabled={busy || !!operation || attachmentWorking || voiceWorking || micActive}
        aria-current={session?.id === item.id ? "page" : undefined}
        title={`${item.title || "New chat"} · ${stamp(item.updated_at)}`}
        ><span>{item.title || "New chat"}</span></button
      >{/snippet}
    {#snippet actions()}
      <button
        class="session-pin"
        aria-label={`${pinnedIds.includes(item.id) ? "Unpin" : "Pin"} ${item.title || "chat"}`}
        title={pinnedIds.includes(item.id) ? "Unpin chat" : "Pin chat"}
        onclick={() => pinSession(item.id)}><Icon name="pin" size={13} /></button
      >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="session-more"
          aria-label={`Actions for ${item.title || "chat"}`}
          title="Chat actions"><Icon name="more" size={14} /></DropdownMenu.Trigger
        >
        <DropdownMenu.Portal
          ><DropdownMenu.Content
            class="workspace-menu-content"
            side="bottom"
            align="end"
            sideOffset={4}
            collisionPadding={10}
            loop
          >
            <WorkspaceMenuItems items={sessionMenu(item)} />
          </DropdownMenu.Content></DropdownMenu.Portal
        >
      </DropdownMenu.Root>
    {/snippet}
  </ChatListRow>
{/snippet}

<div
  class="conversation-app reference-chat laya-chat"
  class:inspector-open={!!panel && !externalPanels}
  class:split-layout={splitLayout}
  class:nav-collapsed={navigationCollapsed}
  bind:clientWidth={chatWidth}
  style:--chat-nav-width={`${visibleSidebarWidth}px`}
  style:--chat-inspector-width={`${visibleInspectorWidth}px`}
  style={chatAppearanceStyle(appearance)}
>
  {#if navigationOpen}<button
      class="session-scrim"
      aria-label="Close session drawer"
      onclick={closeSessionDrawer}
    ></button>{/if}
  <aside
    id="chat-sessions"
    class="session-sidebar"
    class:session-drawer-open={navigationOpen}
    aria-label="Chat sessions"
  >
    {#if navigation}<div class="workspace-navigation">{@render navigation()}</div>{/if}
    <button
      class="new-chat-button"
      onclick={newSession}
      disabled={busy || !!operation || attachmentWorking || voiceWorking || micActive}
      ><Pencil size={15} />New chat</button
    >
    <button class="new-chat-button project-create" onclick={createProjectPrompt}
      ><span aria-hidden="true">+</span>New project</button
    >
    {#if searchOpen || sessionSearch}<label class="sr-only" for="session-search"
        >Search saved chats</label
      ><input
        id="session-search"
        type="search"
        class="field session-search"
        bind:value={sessionSearch}
        placeholder="Search chats"
        onkeydown={(event) => {
          if (event.key === "Escape") {
            sessionSearch = "";
            searchOpen = false;
            document.getElementById("workspace-search")?.focus();
          }
        }}
      />{/if}
    {#if navigationItems}<div class="sidebar-context-navigation">
        {@render navigationItems()}
      </div>{/if}
    <nav class="session-list" aria-label="Saved conversations">
      <button
        class="session-group-heading"
        aria-expanded={pinsOpen}
        onclick={() => (pinsOpen = !pinsOpen)}>Pinned<Icon name="chevron" size={12} /></button
      >
      {#if pinsOpen}{#each visibleSessions.filter( (item) => pinnedIds.includes(item.id) ) as item}{@render sessionRow(
            item,
          )}{/each}{#if !pinnedIds.length && !sessionSearch}<p class="session-empty">
            Pin a chat to keep it here.
          </p>{/if}{/if}
      <ChatGroupHeader
        label={uiConfig.recentsLabel}
        expanded={recentsOpen}
        ontoggle={() => (recentsOpen = !recentsOpen)}
      >
        {#snippet actions()}{#each uiConfig.recentsActions as action}
            {#if action.id === "new"}<button
                type="button"
                aria-label={action.label}
                title={action.label}
                onclick={newSession}
                disabled={busy || !!operation}><Icon name={action.icon} size={14} /></button
              >
            {:else}<DropdownMenu.Root
                ><DropdownMenu.Trigger aria-label={action.label} title={action.label}
                  ><Icon name={action.icon} size={14} /></DropdownMenu.Trigger
                ><DropdownMenu.Portal
                  ><DropdownMenu.Content
                    class="workspace-menu-content"
                    side="bottom"
                    align="end"
                    sideOffset={4}
                    ><WorkspaceMenuItems
                      items={action.id === "filter" ? recentFilters() : recentOptions()}
                    /></DropdownMenu.Content
                  ></DropdownMenu.Portal
                ></DropdownMenu.Root
              >{/if}
          {/each}{/snippet}
      </ChatGroupHeader>
      {#if recentsOpen}{#each visibleSessions.filter((item) => !pinnedIds.includes(item.id)) as item}{@render sessionRow(
            item,
          )}{/each}{/if}
      {#if !visibleSessions.length}<p>
          {sessionLoading
            ? "Loading chats…"
            : sessionSearch
              ? "No matching chats."
              : "Your saved chats appear here."}
        </p>{/if}
    </nav>
    {#if !navigation}<div class="session-sidebar-bottom">
        <button onclick={() => openPanel(panel === "models" ? "" : "models")}
          ><Icon name="layers" size={16} />Models</button
        ><button onclick={() => openPanel(panel === "mcp" ? "" : "mcp")}
          ><Icon name="server" size={16} />MCP connections</button
        >
        <p>Chats are saved in this browser tab.</p>
      </div>{/if}
  </aside>
  {#if splitLayout && navBounds}<div class="chat-pane-resize navigation-resize">
      <input
        type="range"
        aria-label="Resize navigation"
        min={navBounds.min}
        max={navBounds.max}
        value={visibleSidebarWidth}
        onpointerdown={(event) => resizeInspector(event, "navigation")}
        onkeydown={(event) => resizeInspectorKey(event, "navigation")}
        oninput={(event) => (sidebarWidth = event.currentTarget.valueAsNumber)}
      /><span></span>
    </div>{/if}
  <ChatSurface
    empty={entryEmpty && !isCompare}
    bind:transcript
    onscroll={observeScroll}
    ariaLabel="Current chat"
    ariaLogLabel="Conversation"
    ariaLive="polite"
    {busy}
    inert={navigationOpen}
    scrollClass={isCompare ? "comparison-scroll" : ""}
    scrollStyle={isCompare ? "display:flex;overflow:hidden;--chat-transcript-padding:0" : undefined}
    style={`--chat-composer-max:calc(var(${entryEmpty ? "--chat-entry-width" : "--chat-reading-width"},${entryEmpty ? "640px" : "738px"}) + 48px)`}
  >
    {#snippet header()}
      <h1 class="sr-only">{session?.title ?? "Chat"}</h1>
      {@render chatToolbar()}
    {/snippet}
    {#snippet modes()}
      {#if entryEmpty || uiConfig.modeSelection === "always"}<ChatModeSwitch
          modes={presentationConfig.modes}
          value={presentationMode}
          labels={presentationConfig.modeLabels}
          disabled={busy || !!operation}
          onchange={(mode) => choosePresentationMode(mode as "chat" | "work" | "compare")}
        />{/if}
      <div
        class="conversation-titlebar"
        hidden={!renaming}
        style:display={renaming ? "flex" : "none"}
      >
        {#if renaming}<form
            class="rename-chat"
            onsubmit={(event) => {
              event.preventDefault();
              updateTitle();
            }}
          >
            <label class="sr-only" for="rename-chat-title">Chat title</label>
            <input
              id="rename-chat-title"
              bind:this={renameInput}
              class="field"
              bind:value={renameTitle}
              maxlength="120"
              disabled={!!operation}
            />
            <Button size="sm" type="submit" disabled={!!operation || !renameTitle.trim()}
              >Save name</Button
            >
            <Button
              size="sm"
              variant="ghost"
              onclick={() => {
                renaming = false;
                renameTitle = session?.title ?? "";
              }}
              disabled={!!operation}>Cancel</Button
            >
          </form>{/if}
      </div>
      {#if isCompare}<div class="comparison-options">
          <label
            >Compare <select
              aria-label="Comparison kind"
              value={comparisonKind}
              disabled={busy || !!operation}
              onchange={(event) => {
                comparisonKind = event.currentTarget.value as "models" | "processors";
                comparisonTargets = [];
                ensureComparisonTargets();
              }}
            >
              {#each presentationConfig.comparisonKinds ?? [] as kind}<option value={kind}
                  >{kind === "models" ? "Models" : "Processors"}</option
                >{/each}
            </select></label
          >
          <ComparisonTabs
            items={comparisonTargets.map((target, index) => ({
              id: `slot-${index}`,
              label: `${index + 1} · ${comparisonLabel(target)}`,
              color: comparisonColors[index % comparisonColors.length],
            }))}
            active={activeComparison}
            disabled={busy || !!operation}
            max={maxComparisonPanels}
            onfocus={focusComparison}
            onadd={addComparison}
            onremove={removeComparison}
            addLabel={presentationConfig.comparisonAddLabel}
          />
          <span>One prompt · separate histories · parallel generation after preparation</span>
          {#if !comparisonValid}<p role="status">
              {comparisonKind === "models"
                ? "Choose a different installed model in each panel, or switch to Processors to compare devices using one model."
                : "Choose a different ready processor in every panel."}
            </p>{/if}
        </div>{/if}
    {/snippet}
    {#snippet children()}
      {#if isCompare}
        <div
          class="comparison-lanes"
          style:--comparison-columns={comparisonTargets.length || comparisonCount}
        >
          {#each comparisonTargets as lane, laneIndex (laneIndex)}
            <section
              id={`comparison-panel-${laneIndex}`}
              class="comparison-lane"
              data-comparison-id={comparisonId(lane)}
              style:--comparison-color={comparisonColors[laneIndex % comparisonColors.length]}
              aria-label={`Comparison ${laneIndex + 1}: ${comparisonLabel(lane)}`}
            >
              <header class="comparison-lane-header">
                <strong
                  ><span class="comparison-dot" aria-hidden="true"></span>{laneIndex + 1} · {comparisonLabel(
                    lane,
                  )}</strong
                >
                <label
                  >Model<select
                    aria-label={`Model for comparison ${laneIndex + 1}`}
                    value={lane.model_id}
                    disabled={busy ||
                      !!operation ||
                      (comparisonKind === "processors" && laneIndex > 0)}
                    onchange={(event) => pickComparisonModel(laneIndex, event.currentTarget.value)}
                  >
                    <option value="" disabled>Choose model</option>
                    {#each (catalogue?.models ?? []).filter((candidate: any) => candidate.installed && availableTargets.some((target) => target.model_id === candidate.id)) as candidate}<option
                        value={candidate.id}>{candidate.label}</option
                      >{/each}
                  </select></label
                >
                <label
                  >Device<select
                    aria-label={`Device for comparison ${laneIndex + 1}`}
                    value={lane.device}
                    disabled={busy || !!operation}
                    onchange={(event) => pickComparisonDevice(laneIndex, event.currentTarget.value)}
                  >
                    <option value="" disabled>Choose device</option>
                    {#each availableTargets.filter((target) => target.model_id === lane.model_id) as target}<option
                        value={target.device}>{target.device}</option
                      >{/each}
                  </select></label
                >
                <button
                  class="btn"
                  aria-label={`Open tools for comparison ${laneIndex + 1}`}
                  disabled={!lane.model_id || !lane.device}
                  onclick={() => openComparisonOutput(lane, laneIndex)}
                  ><Icon name="workflow" size={14} />Open tools</button
                >
              </header>
              <div class="comparison-lane-transcript">
                {@render transcriptContent(lane, laneIndex)}
              </div>
            </section>
          {/each}
          {#if !comparisonTargets.length}<p class="comparison-empty">
              Install compatible models and connect local compute to compare candidates.
            </p>{/if}
        </div>
      {:else}{@render transcriptContent()}{/if}
    {/snippet}
    {#snippet afterTranscript()}
      {#if unread && readingHistory}<button
          class="new-messages-indicator"
          onclick={() => scrollEnd(true)}><Icon name="chevron" size={13} />New messages</button
        >{/if}
    {/snippet}
    {#snippet composer()}
      {#if messageRemoval}<div
          class="message-removal"
          role="group"
          aria-label="Confirm message removal"
        >
          <p>{messageRemoval.label}</p>
          <p>
            Other messages, attachment copies in other chats and saved tool activity stay unchanged.
          </p>
          <Button
            variant="destructive"
            size="sm"
            onclick={removeMessage}
            disabled={!!operation || busy || micActive || attachmentWorking || voiceWorking}
            >Delete</Button
          >
          <Button
            variant="ghost"
            size="sm"
            onclick={() => (messageRemoval = null)}
            disabled={!!operation}>Keep message</Button
          >
        </div>{/if}
      {#if confirmation}<div class="message-removal" role="group" aria-label="Confirm chat removal">
          <p>
            {confirmation === "clear"
              ? "Clear every message from this saved chat?"
              : `Delete “${session?.title ?? "this chat"}” and all its saved messages?`}
          </p>
          <Button
            variant="destructive"
            size="sm"
            onclick={() => modifySession(confirmation as "clear" | "delete")}
            disabled={!!operation || busy || attachmentWorking || voiceWorking || micActive}
            >Confirm {confirmation}</Button
          >
          <Button
            variant="ghost"
            size="sm"
            onclick={() => (confirmation = "")}
            disabled={!!operation}>Keep chat</Button
          >
        </div>{/if}
      {#if error}<RecoveryNotice
          message={error}
          retry={!session ? initialize : undefined}
          retryLabel="Reconnect chat"
        />{/if}
      {#if notice}<p class="conversation-notice" role="status">{notice}</p>{/if}
      {#if !isCompare && model && selectedDevices.length && !modelCompatible}<div
          class="model-compatibility"
          role="status"
        >
          <p>
            {model.label} supports {(model.devices ?? []).join(" / ") || "no available device"}.
            Choose a compatible model or device before sending.
          </p>
          <div>
            {#if compatibleModel}<Button
                variant="outline"
                size="sm"
                onclick={useCompatibleModel}
                disabled={busy || !!operation}
                >Use {comparison ? "compatible" : device} model</Button
              >{/if}
            {#each supportedDevices as item}<Button
                variant="outline"
                size="sm"
                onclick={() => useSupportedDevice(item.id)}
                disabled={busy || !!operation}>Use {item.device}</Button
              >{/each}
            <Button
              variant="ghost"
              size="sm"
              onclick={() => openPanel("models")}
              disabled={busy || !!operation}>Model settings</Button
            >
          </div>
        </div>{/if}
      {#if toolApproval}<div class="inline-tool-approval">
          <h2>Approve tool call</h2>
          <p>{toolApproval.tool} on {toolApproval.connection_id}</p>
          <pre>{JSON.stringify(toolApproval.arguments, null, 2)}</pre>
          <button class="btn btn-solid" onclick={runProposal} disabled={!!operation}
            >Approve and run</button
          ><button class="btn" onclick={() => (toolApproval = null)} disabled={!!operation}
            >Cancel</button
          >
        </div>{/if}
      {#if toolResult}<div class="inline-tool-approval">
          <h2>Tool result</h2>
          <pre>{JSON.stringify(toolResult.result ?? toolResult, null, 2)}</pre>
          <button
            class="btn"
            onclick={() => {
              attach(`Tool result:\n${JSON.stringify(toolResult.result ?? toolResult, null, 2)}`);
              toolResult = null;
            }}>Attach to next message</button
          ><button class="btn" onclick={() => (toolResult = null)}>Dismiss</button>
        </div>{/if}
      {#if model && !model.installed}<div class="model-install-prompt">
          <span
            >{model.label} needs a local download{model.download_mb
              ? ` (~${model.download_mb} MB)`
              : ""}.</span
          ><button
            class="btn"
            onclick={() => prepareModel("download")}
            disabled={!!operation || setupBusy}>Download model</button
          >
        </div>{/if}
      {#if setupBusy}<p class="conversation-notice" role="status">
          {catalogue.job.state === "downloading"
            ? "Downloading model files…"
            : "Preparing local model…"} Status updates automatically.
        </p>{/if}
      <input
        class="hidden"
        type="file"
        multiple
        accept={capabilities?.attachments?.accept}
        aria-label="Attach files to chat"
        bind:this={filePicker}
        onchange={uploadAttachments}
      />
      <ChatComposer onsubmit={() => send()}>
        {#if attachments.length}<div class="composer-attachments">
            {#each attachments as file}<div>
                <AttachmentPreview {file} compact /><span
                  >{file.note ??
                    (file.capabilities?.text
                      ? "Text available to model"
                      : "Preview only · model cannot see this file")}</span
                >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${file.name}`}
                  title="Remove attachment"
                  onclick={() => removeAttachment(file.id)}
                  disabled={busy || attachmentWorking || !!operation}
                  ><Icon name="x" size={14} /></Button
                >
              </div>{/each}
          </div>{/if}
        {#if voiceUrl}<div class="composer-voice-preview">
            <audio controls src={voiceUrl} aria-label="Your recorded message"></audio>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete recorded voice"
              title="Delete recording"
              onclick={() => {
                clearVoice();
                notice = "Recording removed. Your editable message is preserved.";
              }}
              disabled={busy || !!operation}><Trash2 size={15} /></Button
            >
          </div>{/if}
        <label class="sr-only" for="chat-message"
          >{presentationMode === "work" ? "Work with Laya" : "Message Laya"}</label
        ><Textarea
          id="chat-message"
          bind:ref={composerInput}
          bind:value={draft}
          onkeydown={onKey}
          oninput={observeComposer}
          onkeyup={observeComposer}
          onclick={observeComposer}
          onselect={observeComposer}
          aria-autocomplete="list"
          aria-expanded={commandVisible}
          aria-controls={commandVisible ? "composer-resources" : undefined}
          aria-activedescendant={commandVisible && commandMatches[commandIndex]
            ? `composer-resource-${commandIndex}`
            : undefined}
          rows={2}
          maxlength={catalogue?.limits?.max_message_chars ?? 4000}
          placeholder={presentationMode === "work"
            ? "Work with Laya · / tools · @ mentions"
            : "Message Laya · / tools · @ mentions"}
          disabled={busy || sessionLoading || !session}
        />
        {#if commandVisible}<ComposerPicker
            items={commandMatches}
            tabs={uiConfig.pickerTabs}
            activeTab={activePickerTab?.id ?? ""}
            onTabChange={(id) => {
              pickerTab = id;
              commandIndex = 0;
            }}
            onSelect={chooseResource}
            onClose={closeResourcePicker}
            position={entryEmpty ? "below" : "above"}
            loading={commandLoading}
            error={commandError}
            selectedIndex={commandIndex}
            onRetry={refreshCommandResources}
            title={uiConfig.pickerTitle}
            emptyLabel={uiConfig.pickerEmptyLabel}
          />{/if}
        <div class="composer-controls">
          <div class="composer-left-actions">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Add tools and plugins"
              title={uiConfig.pickerTitle}
              disabled={busy ||
                !!operation ||
                attachmentWorking ||
                voiceWorking ||
                micActive ||
                !session}
              onclick={openResourcePicker}><Icon name="plus" size={20} /></Button
            >
            {#snippet approvalIcon()}
              <Icon name="shield" size={16} />
            {/snippet}
            {#snippet approvalFooter()}
              <Popover.Close class="summary-row" onclick={() => openPanel("tools")}
                ><Icon name="workflow" size={15} />Manage integrations</Popover.Close
              >
            {/snippet}
            {#if approval}
              <ApprovalModeSelector
                modes={approval.modes}
                value={approval.value}
                label={approval.label}
                onSelect={approval.onSelect}
                iconOnly
                renderIcon={approvalIcon}
                footer={approvalFooter}
              />
            {/if}
          </div>
          <div class="composer-right-actions">
            {#if isCompare}<span class="comparison-composer-summary"
                >{comparisonTargets.length} candidates</span
              >{:else}
              <label class="composer-model-select"
                ><span class="sr-only">Generative model</span><AppSelect
                  bind:value={modelId}
                  options={modelOptions}
                  displayLabel={`${model?.label ?? "No model selected"} · ${device || "no device"}`}
                  label="Chat model"
                  disabled={busy || !!operation}
                /></label
              >
            {/if}
            <Recorder
              compact
              {active}
              bind:microphone
              disabled={busy ||
                !!operation ||
                attachmentWorking ||
                voiceWorking ||
                !session ||
                !voiceDevice}
              onRecorded={transcribeRecording}
              onBusyChange={(value) => (micActive = value)}
              label="Record and transcribe message"
              maxSeconds={capabilities?.audio?.max_seconds ?? 300}
            />
            {#if busy}<button class="btn stop-button" type="button" onclick={stop}
                ><span aria-hidden="true">■</span> Stop</button
              >{:else}<button
                class="btn btn-solid send-button"
                aria-label="Send message"
                disabled={(!draft.trim() && !attachments.length) ||
                  !session ||
                  (!cloudAvailable() &&
                    !serverAiAvailable() &&
                    ((!isCompare && !model?.installed) ||
                      !modelCompatible ||
                      !selectedDevices.length)) ||
                  !!operation ||
                  setupBusy ||
                  attachmentWorking ||
                  voiceWorking ||
                  micActive}><Icon name="arrowUp" size={18} /></button
              >{/if}
          </div>
        </div>
      </ChatComposer>
    {/snippet}
  </ChatSurface>
  {#if panel && !externalPanels}<aside
      class="chat-inspector"
      aria-label={`${panel === "models" ? "Chat settings" : panel} panel`}
    >
      {#if panelBounds}<div class="chat-pane-resize inspector-resize">
          <input
            type="range"
            aria-label="Resize chat settings"
            min={-panelBounds.max}
            max={-panelBounds.min}
            value={-visibleInspectorWidth}
            onpointerdown={(event) => resizeInspector(event, "inspector")}
            onkeydown={(event) => resizeInspectorKey(event, "inspector")}
            oninput={(event) => (inspectorWidth = -event.currentTarget.valueAsNumber)}
          /><span></span>
        </div>{/if}
      <button
        class="btn inspector-close"
        aria-label="Close settings panel"
        onclick={() => openPanel("")}><Icon name="x" size={16} /></button
      >
      {@render sharedPanel()}
    </aside>{/if}
</div>

{#snippet sharedPanel()}
  <div class="shared-chat-panel">
    {#if toolsVisited}<div
        hidden={panel !== "tools" && panel !== "mcp" && panel !== "skills"}
        inert={panel !== "tools" && panel !== "mcp" && panel !== "skills"}
      >
        {#key `${session?.id}:${toolPanel}:${resourceFocus.connectionId}:${resourceFocus.toolName}:${resourceFocus.skillId}:${resourceFocus.tab}`}{#if ChatTools}<ChatTools
              mode={toolPanel}
              embedded={externalPanels}
              active={panel === "tools" || panel === "mcp" || panel === "skills"}
              initialConnection={resourceFocus.connectionId}
              initialTool={resourceFocus.toolName}
              initialSkill={resourceFocus.skillId}
              initialTab={resourceFocus.tab}
              sessionId={session?.id ?? ""}
              selectedTools={toolIds}
              onTools={(ids: string[]) => (toolIds = ids)}
              onAttach={attach}
              onResult={refreshToolHistory}
              onResourcesChange={resourcesChanged}
            />{/if}{/key}
      </div>{/if}
    {#if settingsVisited}<div hidden={panel !== "models"} inert={panel !== "models"}>
        <section class="chat-inspector-section">
          <h2 class:sr-only={externalPanels}>Chat settings</h2>
          <h3>Voice</h3>
          <MicrophoneSelect bind:value={microphone} disabled={busy || voiceWorking || micActive} />
          {#await import("#lib/SpeechControls.svelte") then { default: SpeechControls }}<SpeechControls
              bind:device={voiceDevice}
              bind:language={voiceLanguage}
              status={capabilities?.audio}
              disabled={busy || voiceWorking || micActive}
            />{/await}
          <h3 class="mt-6">Model & device</h3>
          {#if serverAiAvailable()}<section class="inspector-section">
              <h4>Bring your own key</h4>
              <p class="inspector-note">
                Sent with each turn to this server, which relays it to the provider. Held in this
                tab's memory only — never written to storage, never logged, gone when the tab
                closes. Save it through Model keys instead if you want the server to keep it
                encrypted.
              </p>
              <div class="inspector-field">
                <span>Provider</span><AppSelect
                  label="BYOK provider"
                  bind:value={serverProvider}
                  options={(serverAiConfig?.providers ?? []).map((entry) => ({
                    value: entry.id,
                    label: entry.label,
                  }))}
                  disabled={busy || !!operation}
                />
              </div>
              <div class="inspector-field">
                <span>Model</span><AppSelect
                  label="BYOK model"
                  bind:value={serverModel}
                  options={(
                    serverAiConfig?.providers.find((entry) => entry.id === serverProvider)?.models ??
                    []
                  ).map((name) => ({ value: name, label: name }))}
                  disabled={busy || !!operation}
                />
              </div>
              <label class="inspector-field"
                >Provider key<input
                  class="field mono"
                  type="password"
                  autocomplete="off"
                  spellcheck="false"
                  bind:value={byokKeyDraft}
                  placeholder={byokKeyHeld ? "Key held in this tab" : "sk-..."}
                /></label
              >
              <div class="inspector-button-row">
                <button
                  class="btn"
                  type="button"
                  disabled={!byokKeyDraft.trim()}
                  onclick={() => {
                    byokKeyNotice = saveProviderKey(byokKeyDraft)
                      ? "Key held in this tab. Send a message to use it."
                      : "That does not look like a key: 8 or more characters, no spaces.";
                    byokKeyHeld = hasProviderKey();
                    if (byokKeyHeld) byokKeyDraft = "";
                  }}>Use this key</button
                ><button
                  class="btn"
                  type="button"
                  disabled={!byokKeyHeld}
                  onclick={() => {
                    clearProviderKey();
                    byokKeyHeld = false;
                    byokKeyDraft = "";
                    byokKeyNotice = "Key discarded from this tab.";
                  }}>Forget key</button
                >
              </div>
              {#if byokKeyNotice}<p class="inspector-note" role="status">{byokKeyNotice}</p>{/if}
              <label class="inspector-check"
                ><input type="checkbox" bind:checked={serverToolUse} disabled={busy || !!operation} />
                Let this turn use tools</label
              >
              <p class="inspector-note">
                Off by default, and only works when the server sets <code>AI_TOOLS_ENABLED=true</code>
                and its policy allows the verb. A denied verb is shown as denied, never silently
                skipped.
              </p>
            </section>{/if}
          <div class="inspector-field">
            <span>Model</span><AppSelect
              label="Model"
              bind:value={modelId}
              options={modelOptions}
              disabled={busy || !!operation}
            />
          </div>
          <ModelCapabilities capabilities={model?.capabilities} />
          <div class="inspector-field">
            <span>Device</span><AppSelect
              label="Chat device"
              value={device}
              options={engineOptions}
              onchange={(value) => onPick(`local:${value.toLowerCase()}`)}
              disabled={busy || !!operation}
            />
          </div>
          {#if model}<dl class="model-facts">
              <div>
                <dt>Installation</dt>
                <dd>
                  {(model as any).stub
                    ? "No model is installed in this build"
                    : model.installed
                      ? "Installed"
                      : "Download needed"}
                </dd>
              </div>
              <div>
                <dt>Export device support</dt>
                <dd>
                  {model.capabilities?.supported_devices?.join(", ") ||
                    "Unverified custom checkpoint"}
                </dd>
              </div>
              <div>
                <dt>Download</dt>
                <dd>{model.download_mb ? `${model.download_mb} MB` : "Size not reported"}</dd>
              </div>
            </dl>
            <button
              class="btn"
              onclick={() => prepareModel(model.installed ? "load" : "download")}
              disabled={busy || setupBusy || !!operation}
              >{model.installed ? `Prepare ${device || "NPU"}` : "Download model"}</button
            >{/if}<button
            class="btn"
            onclick={() => refreshModels().catch((e) => (error = e.message))}>Refresh models</button
          >
          <details class="inspector-description">
            <summary>Device and comparison details</summary>
            <p>
              OpenVINO GenAI runs on your chosen device. Switching can require compilation.
              Comparison prepares isolated pipelines first, then starts generation together.
              Parallel comparisons need enough available RAM. Timings describe concurrent load, not
              an isolated processor benchmark.
            </p>
          </details>
          <button class="btn" onclick={() => onNavigate("models")}>Decision model catalogue</button>
          <button class="btn" onclick={() => openPanel("utils")}>Chat utilities</button>
        </section>
      </div>{/if}
    {#if sessionVisited}<div hidden={panel !== "utils"} inert={panel !== "utils"}>
        <section class="chat-inspector-section">
          <h2 class:sr-only={externalPanels}>Chat and utilities</h2>
          <div class="inspector-button-row">
            <Button
              variant="outline"
              onclick={() => copyText(plainConversation(), "chat")}
              disabled={!session?.turns?.length}
              ><Icon name={copiedItem === "chat" ? "check" : "copy"} size={15} />Copy chat</Button
            ><Button
              variant="outline"
              onclick={() => forkSession()}
              disabled={!session || busy || !!operation}
              ><Icon name="fork" size={15} />Branch chat</Button
            >
          </div>
          <label class="inspector-field"
            >Chat title<input
              class="field"
              bind:value={renameTitle}
              maxlength="120"
              disabled={!session || busy}
            /></label
          >
          <div class="inspector-button-row">
            <button
              class="btn"
              onclick={updateTitle}
              disabled={!session || busy || !renameTitle.trim() || !!operation}>Rename</button
            ><button class="btn" onclick={exportSession} disabled={!session || busy}
              >Export JSON</button
            >
          </div>
          <div class="inspector-button-row">
            <button class="btn" onclick={() => (confirmation = "clear")} disabled={!session || busy}
              >Clear messages</button
            ><button
              class="btn"
              onclick={() => (confirmation = "delete")}
              disabled={!session || busy}>Delete chat</button
            >
          </div>
          <h3 class="mt-6">Laptop utilities</h3>
          <div class="utility-links">
            {#each [{ id: "transcribe", label: "Transcribe audio", icon: "mic" }, { id: "voice", label: "Voice to action", icon: "mic" }, { id: "apps", label: "Document automation", icon: "workflow" }, { id: "embeddings", label: "Search by meaning", icon: "search" }, { id: "setup", label: "Setup & diagnostics", icon: "check" }] as item}<button
                onclick={() => onNavigate(item.id)}
                ><Icon name={item.icon} size={16} />{item.label}<Icon
                  name="arrowUpRight"
                  size={14}
                /></button
              >{/each}
          </div>
        </section>
      </div>{/if}
  </div>
{/snippet}

<style>
  .reference-chat :global(.conversation-user) {
    background: transparent;
    padding: 0;
    border-radius: 0;
    width: 100%;
    max-width: none;
    margin-left: 0;
  }
  .reference-chat :global(.conversation-assistant) {
    background: transparent;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  :global(.chat-menu-separator) {
    height: 1px;
    background: var(--color-line);
    margin: 5px 0;
  }
  :global(.chat-summary-overlay) {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.45);
    z-index: 120;
  }
  :global(.chat-summary-dialog) {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 121;
    width: min(400px, calc(100vw - 32px));
    max-height: 85vh;
    overflow: auto;
    padding: 20px;
    border: 1px solid var(--color-line);
    border-radius: 12px;
    background: var(--color-panel);
  }

  .shared-chat-panel {
    width: 100%;
    min-width: 0;
  }
  .shared-chat-panel > [hidden] {
    display: none;
  }
  .workspace-navigation {
    flex: 0 0 auto;
    overflow: visible;
    padding-bottom: 16px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--color-line);
  }
  .conversation-app.split-layout,
  .conversation-app.split-layout.inspector-open {
    position: relative;
    grid-template-columns: var(--chat-nav-width, 230px) 8px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    height: 100%;
  }
  .split-layout .session-sidebar {
    overflow-y: auto;
    padding-top: 14px;
    border-right: 0;
  }
  .split-layout .session-list {
    flex: 1 0 140px;
    min-height: 140px;
  }
  .split-layout .chat-inspector {
    position: absolute;
    z-index: 25;
    inset-block: 0;
    inset-inline-end: 0;
    width: min(var(--chat-inspector-width, 350px), calc(100% - var(--chat-nav-width, 230px) - 8px));
    padding-inline-start: 20px;
    border-inline-start: 1px solid var(--color-line);
    background: var(--color-panel);
  }
  .split-layout .composer-model-select {
    flex: 1;
    min-width: 0;
  }
  .split-layout .composer-model-select :global(.app-select-trigger) {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 12px;
  }
  .split-layout .conversation-titlebar {
    padding-inline: 18px;
  }
  .chat-pane-resize {
    position: relative;
    display: grid;
    place-items: center;
    width: 8px;
    background: var(--color-panel);
    cursor: col-resize;
    touch-action: none;
  }
  .chat-pane-resize::before {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    width: 1px;
    background: var(--color-line);
    pointer-events: none;
  }
  .chat-pane-resize input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    cursor: col-resize;
  }
  .chat-pane-resize span {
    height: 28px;
    width: 2px;
    background: transparent;
    pointer-events: none;
    border-radius: 2px;
  }
  .chat-pane-resize:hover span,
  .chat-pane-resize:focus-within span {
    z-index: 1;
    background: var(--color-ink-2);
  }
  .chat-pane-resize:focus-within::before {
    width: 2px;
    background: var(--color-ink-2);
  }
  .inspector-resize {
    position: absolute;
    inset-inline-start: 0;
    top: 0;
    bottom: 0;
    z-index: 2;
  }
  @media (min-width: 1101px) {
    .conversation-app.split-layout.nav-collapsed,
    .conversation-app.split-layout.nav-collapsed.inspector-open {
      grid-template-columns: minmax(0, 1fr);
    }
    .split-layout.nav-collapsed .session-sidebar,
    .split-layout.nav-collapsed .navigation-resize {
      display: none;
    }
    .split-layout.nav-collapsed .chat-inspector {
      width: min(var(--chat-inspector-width, 350px), 100%);
    }
  }
  @media (max-width: 1100px) {
    .conversation-app.split-layout,
    .conversation-app.split-layout.inspector-open {
      grid-template-columns: minmax(0, 1fr);
    }
    .split-layout .chat-inspector {
      position: absolute;
      width: min(var(--chat-inspector-width, 350px), 100%);
    }
    .split-layout .session-sidebar {
      display: none;
    }
    .split-layout .navigation-resize {
      display: none;
    }
    .split-layout .session-sidebar.session-drawer-open {
      display: flex;
      position: fixed;
      z-index: 50;
      inset-block: 0;
      inset-inline-start: 0;
      width: min(300px, 85vw);
      border-right: 1px solid var(--color-line);
    }
    .split-layout .session-scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 45;
      background: rgb(0 0 0 / 0.55);
      border: 0;
    }
  }
  .conversation-titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 28px 10px;
    min-width: 0;
  }
  .conversation-titlebar h2 {
    color: var(--color-ink-2);
    font-size: 12px;
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin: 0;
  }
  .rename-chat {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .rename-chat {
    width: 100%;
  }
  .rename-chat input {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    padding: 7px 10px;
  }
  .message-removal {
    padding: 10px 0 14px;
    color: var(--color-ink);
    font-size: 12px;
    line-height: 1.6;
  }
  .message-removal p {
    margin: 0 0 6px;
  }
  .message-removal p + p {
    color: var(--color-ink-2);
    font-size: 11px;
  }
  .message-removal :global(button) {
    margin-inline-end: 5px;
    margin-top: 4px;
  }
  .saved-attachment {
    display: inline-flex;
    align-items: flex-start;
    gap: 3px;
    min-width: 0;
  }
  .composer-controls {
    position: relative;
    flex-wrap: wrap;
    gap: 8px;
  }
  .composer-left-actions,
  .composer-right-actions {
    align-items: center;
    flex-wrap: nowrap;
    gap: 4px;
  }
  .composer-right-actions {
    margin-inline-start: auto;
  }
  .composer-left-actions > :global(button) {
    border-radius: 50%;
  }
  .composer-voice-preview {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }
  .composer-voice-preview audio {
    flex: 1;
    min-width: 0;
    height: 36px;
  }
  .reply-footer {
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: 100%;
    margin-top: 8px;
    overflow-x: auto;
  }
  .reply-statistics {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--color-ink-2);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .reply-statistics > span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .reply-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .reply-actions :global([data-slot="button"]) {
    width: 30px;
    height: 30px;
    min-height: 30px;
    padding: 5px;
    color: var(--color-ink-2);
  }
  .reply-actions :global([data-slot="button"]:hover) {
    color: var(--color-ink);
  }
  .model-compatibility {
    margin: 0 0 10px;
    padding: 12px 0;
    color: var(--color-ink-2);
    font-size: 12px;
    line-height: 1.5;
  }
  .model-compatibility p {
    margin: 0 0 8px;
  }
  .model-compatibility > div {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  @media (max-width: 480px) {
    .conversation-titlebar {
      padding-inline: 12px;
      gap: 6px;
    }
    .reply-footer,
    .reply-statistics {
      gap: 8px;
    }
  }
  .reference-chat .session-sidebar {
    padding: 10px 10px 16px;
    background: var(--color-nav, var(--color-panel));
  }
  .reference-chat .workspace-navigation {
    padding: 0;
    margin: 0;
    border: 0;
  }
  .reference-chat .new-chat-button {
    display: flex;
    align-items: center;
    gap: 9px;
    background: transparent;
    border: 0;
    border-radius: 8px;
    text-align: left;
    justify-content: flex-start;
    padding: 7px 8px;
    font-size: 13px;
    min-height: 34px;
    flex: none;
  }
  .reference-chat .sidebar-context-navigation {
    margin: 18px 0 8px;
  }
  .reference-chat .project-create {
    color: var(--ink-3);
    font-size: 12.5px;
  }
  .reference-chat .session-list {
    gap: 0;
    overflow: auto;
    padding-top: 0;
  }
  .reference-chat .session-group-heading {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--color-ink-2);
    padding: 7px 8px;
    margin: 17px 0 3px;
    width: 100%;
    text-align: left;
  }
  .reference-chat .session-empty {
    padding: 3px 8px;
    font-size: 12px;
  }
  .reference-chat .session-open > span {
    font-size: 13px;
    color: var(--color-ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reference-chat .composer-controls {
    margin-top: 8px;
    gap: 5px;
    flex-wrap: nowrap;
  }
  .reference-chat .composer-controls > div {
    gap: 5px;
    align-items: center;
    flex-wrap: nowrap;
  }
  .composer-model-select {
    max-width: 230px;
    min-width: 0;
  }
  .composer-model-select :global(.app-select-trigger) {
    font-size: 11px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    background: transparent;
    padding-inline: 4px;
  }
  .reference-chat .composer-right-actions {
    min-width: 0;
    margin-left: auto;
  }
  .reference-chat .send-button {
    width: 30px;
    height: 30px;
    min-height: 30px;
    background: var(--color-execution);
    color: var(--color-ink);
    border: 0;
  }
  .reference-chat .send-button:hover {
    background: var(--color-execution-hover);
  }
  .reference-chat :global(.entry-chat .conversation-empty) {
    padding: 0;
    margin: 0 auto;
    width: 100%;
    max-width: none;
    min-height: 0;
    text-align: center;
  }
  .reference-chat :global(.entry-chat .conversation-empty h1) {
    font-size: 28px;
    line-height: 1.4;
    font-weight: 400;
    letter-spacing: normal;
    margin: 0;
  }
  .new-messages-indicator {
    align-self: center;
    padding: 7px 13px;
    background: var(--color-hover);
    border: 1px solid var(--color-line);
    border-radius: 20px;
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    margin-bottom: 8px;
  }
  :global(.chat-context-summary) {
    z-index: 100;
    max-width: calc(100vw - 24px);
    width: 300px;
    max-height: calc(100dvh - 90px);
    overflow: auto;
    padding: 16px 20px;
    border-radius: 16px;
    background: var(--color-panel-2);
    color: var(--color-ink);
    box-shadow: 0 12px 30px #0004;
    font-family: var(--font-sans);
  }
  :global(.chat-context-summary h3) {
    font-size: 12px;
    font-weight: 500;
    color: var(--color-ink-2);
    margin: 14px 0 8px;
  }
  :global(.chat-context-summary h3:first-child) {
    margin-top: 0;
  }
  :global(.chat-context-summary p) {
    font-size: 12px;
    line-height: 1.65;
    margin: 0 0 12px;
  }
  :global(.summary-row) {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    max-width: 100%;
    text-align: left;
    overflow-wrap: anywhere;
  }
  .reference-chat .composer-attachments {
    gap: 8px;
    flex-wrap: wrap;
  }
  .reference-chat .composer-attachments > div {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 122px;
    min-width: 0;
    height: 122px;
    padding: 8px;
    border-radius: 7px;
    background: var(--color-nav, var(--color-panel));
    border: 1px solid var(--color-line-strong);
    overflow: hidden;
  }
  .reference-chat .composer-attachments > div > span {
    font-size: 9px;
    line-height: 1.4;
    margin-top: auto;
    max-height: 28px;
    overflow: hidden;
  }
  .reference-chat .composer-attachments :global(.attachment-preview.compact img) {
    width: 104px;
    height: 72px;
    object-fit: cover;
    border-radius: 4px;
  }
  .reference-chat .composer-attachments :global(.attachment-preview a) {
    display: block;
    font-size: 10px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .reference-chat .composer-attachments > div :global(button) {
    position: absolute;
    right: 3px;
    top: 3px;
    background: var(--color-hover);
    border-radius: 50%;
    width: 24px;
    height: 24px;
    min-height: 24px;
    padding: 3px;
    opacity: 0;
  }
  .reference-chat .composer-attachments > div:hover :global(button),
  .reference-chat .composer-attachments > div:focus-within :global(button) {
    opacity: 1;
  }
  .shared-chat-panel .chat-inspector-section {
    max-width: 730px;
    width: 100%;
    margin: 0 auto;
    padding: 32px 20px 50px;
  }
  .shared-chat-panel .chat-inspector-section > h3 {
    font-size: 14px;
    font-weight: 600;
    margin: 24px 0 15px;
  }
  .shared-chat-panel .chat-inspector-section > h2.sr-only + h3 {
    margin-top: 0;
  }
  .shared-chat-panel .model-facts {
    background: var(--color-panel);
    border: 1px solid var(--color-line);
    border-radius: 12px;
    padding: 4px 16px;
  }
  .shared-chat-panel .inspector-field {
    font-size: 12px;
  }
  .shared-chat-panel .inspector-section {
    padding-block: 12px;
    border-bottom: 1px solid var(--color-line);
  }
  .shared-chat-panel .inspector-section > h4 {
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 6px;
  }
  .shared-chat-panel .inspector-note {
    font-size: 12px;
    line-height: 1.5;
    color: var(--color-ink-2);
    margin: 0 0 10px;
  }
  .shared-chat-panel .inspector-check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    margin-bottom: 6px;
  }
  .shared-chat-panel :global(.speech-controls),
  .shared-chat-panel :global(.microphone-select) {
    padding-block: 10px;
    border-bottom: 1px solid var(--color-line);
  }
  @container (max-width:430px) {
    .composer-model-select {
      max-width: 130px;
    }
    .reference-chat :global(.entry-chat .conversation-empty h1) {
      font-size: 24px;
    }
  }
  @media (hover: none) {
    .reference-chat .session-list .session-pin,
    .reference-chat .composer-attachments > div :global(button) {
      opacity: 1;
    }
  }

  .comparison-options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 6px 12px;
    font-size: 12px;
    color: var(--color-ink-2);
  }
  .comparison-options label,
  .comparison-lane-header label {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .comparison-options select,
  .comparison-lane-header select {
    min-width: 0;
    max-width: 100%;
    border: 1px solid var(--color-line);
    background: var(--color-panel);
    border-radius: 5px;
    padding: 4px;
    color: var(--color-ink);
  }
  .comparison-options p {
    width: 100%;
    margin: 0;
  }
  .comparison-lanes {
    display: grid;
    grid-template-columns: repeat(
      var(--comparison-columns),
      minmax(var(--chat-comparison-min, 220px), 1fr)
    );
    min-width: 100%;
    height: 100%;
    min-height: 220px;
  }
  .comparison-lane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--color-line);
  }
  .comparison-lane:last-child {
    border-right: 0;
  }
  .comparison-lane-header {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 10px;
    border-bottom: 1px solid var(--color-line);
  }
  .comparison-lane-header strong {
    display: flex;
    gap: 7px;
    align-items: center;
    width: 100%;
    color: var(--comparison-color);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .comparison-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--comparison-color);
    flex: none;
  }
  .comparison-lane-header label {
    flex: 1 1 120px;
    font-size: 11px;
  }
  .comparison-lane-header select {
    flex: 1;
  }
  .comparison-lane-transcript {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 12px;
  }
  .comparison-lane-transcript :global(.conversation-turn) {
    width: 100%;
    padding: 0;
    margin: 0 0 20px;
  }
  .comparison-lane-transcript :global(.conversation-replies) {
    display: block;
  }
  .comparison-lane-transcript :global(.conversation-assistant) {
    margin-top: 12px;
  }
  .comparison-lane-transcript :global(.reply-heading) {
    flex-wrap: wrap;
  }
  .comparison-composer-summary {
    font-size: 12px;
    color: var(--color-ink-2);
    white-space: nowrap;
  }
  .comparison-empty {
    padding: 16px;
  }
</style>

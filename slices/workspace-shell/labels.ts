/** Presentation labels only; these do not indicate capability or authority. */
export type WorkspaceLabels = {
  menuFile: string;
  menuEdit: string;
  menuView: string;
  menuHelp: string;
  close: string;
  settingsMenu: string;
  toggleSidebarMenu: string;
  toggleTheme: string;
  toggleOutputPanel: string;
  switchChatTabs: string;
  tools: string;
  back: string;
  forward: string;
  previousSidebarItem: string;
  nextSidebarItem: string;
  previousTab: string;
  nextTab: string;
  exitFullscreen: string;
  toggleFullscreen: string;
  keyboardShortcuts: string;
  helpAndLimits: string;
  troubleshooting: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  delete: string;
  selectAll: string;
  openTools: string;
  explore: string;
  workspaceNavigation: string;
  backInWorkspace: string;
  forwardInWorkspace: string;
  showSidebar: string;
  hideSidebar: string;
  openNavigation: string;
  toggleSidebar: string;
  appShortcuts: string;
  userMenu: string;
  settings: string;
  integrations: string;
  help: string;
  visibleWorkspaceRegion: string;
  output: string;
  reconnect: string;
  outputWorkspace: string;
  openOutputTabs: string;
  keptTab: string;
  workingTabDescription: string;
  keepTabDescription: string;
  newTab: string;
  newTabDescription: string;
  plugins: string;
  pluginsAndIntegrations: string;
  restoreSplitView: string;
  expandOutputPanel: string;
  findOpenTab: string;
  openTabs: string;
  findTab: string;
  noMatchingOpenTab: string;
  workspace: string;
  loadingView: string;
  viewLoadFailed: string;
  dismissPanelNotice: string;
  shortcutsDescription: string;
  loadingSettings: string;
  settingsLoadFailed: string;
  resourceCommandUnavailable: string;
  fullscreenUnavailable: string;
  outputLimitReached: string;
  keepTab: string;
  closeTab: string;
  outputShare: string;

  chat: string;
  newChat: string;
  findChats: string;
  searchChats: string;
  skipToChat: string;
  focusMessage: string;
  chatAndNavigation: string;
  resizeChatOutput: string;
  statusOnline: string;
  statusConnecting: string;
  statusOffline: string;
  hostedConnection: string;
  connectedTooltip: string;
  disconnectedTooltip: string;
  stubTooltip: string;
  connectionFailed: string;
  connectionLost: string;
  moreTools: string;
  moreToolsTitle: string;
};

export const defaultWorkspaceLabels: Readonly<WorkspaceLabels> = {
  menuFile: "File",
  menuEdit: "Edit",
  menuView: "View",
  menuHelp: "Help",
  close: "Close",
  settingsMenu: "Settings…",
  toggleSidebarMenu: "Toggle Sidebar",
  toggleTheme: "Toggle Light/Dark Theme",
  toggleOutputPanel: "Toggle output panel",
  switchChatTabs: "Switch between Chat and tabs",
  tools: "Tools",
  back: "Back",
  forward: "Forward",
  previousSidebarItem: "Previous Sidebar Item",
  nextSidebarItem: "Next Sidebar Item",
  previousTab: "Previous Tab",
  nextTab: "Next Tab",
  exitFullscreen: "Exit Full Screen",
  toggleFullscreen: "Toggle Full Screen",
  keyboardShortcuts: "Keyboard Shortcuts",
  helpAndLimits: "Help & limits",
  troubleshooting: "Troubleshooting",
  undo: "Undo",
  redo: "Redo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  delete: "Delete",
  selectAll: "Select All",
  openTools: "Open tools",
  explore: "Explore",
  workspaceNavigation: "Workspace navigation",
  backInWorkspace: "Back in workspace",
  forwardInWorkspace: "Forward in workspace",
  showSidebar: "Show sidebar",
  hideSidebar: "Hide sidebar",
  openNavigation: "Open navigation",
  toggleSidebar: "Toggle sidebar",
  appShortcuts: "App shortcuts",
  userMenu: "User menu",
  settings: "Settings",
  integrations: "Integrations",
  help: "Help",
  visibleWorkspaceRegion: "Visible workspace region",
  output: "Output",
  reconnect: "Reconnect",
  outputWorkspace: "Output panel",
  openOutputTabs: "Open output tabs",
  keptTab: "Kept tab",
  workingTabDescription: "Working tab: menu selections reuse this tab",
  keepTabDescription: "Keep tab open while browsing other tools",
  newTab: "New tab",
  newTabDescription: "New tab: keep the current view and choose another tool",
  plugins: "Plugins",
  pluginsAndIntegrations: "Plugins and integrations",
  restoreSplitView: "Restore split view",
  expandOutputPanel: "Expand output panel",
  findOpenTab: "Find an open tab",
  openTabs: "Open tabs",
  findTab: "Find a tab",
  noMatchingOpenTab: "No matching open tab.",
  workspace: "Workspace",
  loadingView: "Loading view…",
  viewLoadFailed: "Unable to load this view. Reload to retry.",
  dismissPanelNotice: "Dismiss panel notice",
  shortcutsDescription:
    "Available workspace commands. Native edit shortcuts act on the focused text field.",
  loadingSettings: "Loading settings…",
  settingsLoadFailed: "Unable to load settings. Reload to retry.",
  resourceCommandUnavailable: "This panel command is unavailable. Open the panel and try again.",
  fullscreenUnavailable: "Full screen is unavailable in this browser.",
  outputLimitReached: "Close and reload the workspace before opening more comparison outputs.",
  keepTab: "Keep {label} tab",
  closeTab: "Close {label} tab",
  outputShare: "Output {percent} percent",

  chat: "Chat",
  newChat: "New chat",
  findChats: "Find chats",
  searchChats: "Search chats",
  skipToChat: "Skip to chat",
  focusMessage: "Focus message",
  chatAndNavigation: "Chat and navigation",
  resizeChatOutput: "Resize chat and output",
  statusOnline: "Workspace ready",
  statusConnecting: "Connecting…",
  statusOffline: "Disconnected",
  hostedConnection: "Connection settings",
  connectedTooltip: "Connected",
  disconnectedTooltip: "Disconnected",
  // A backend can answer every request from inside the page. That is not a connection, and
  // saying "Connected" over it was the exact claim this pass exists to remove.
  stubTooltip: "In-page stub · no runtime",
  connectionFailed: "The service could not be reached.",
  connectionLost: "Connection lost.",
  moreTools: "More tools",
  moreToolsTitle: "More tools",
};

export function resolveWorkspaceLabels(overrides: Partial<WorkspaceLabels> = {}): WorkspaceLabels {
  return { ...defaultWorkspaceLabels, ...overrides };
}

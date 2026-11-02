/** Presentation and behavior of an available menu command. */
export type WorkspaceMenuItem = {
  id: string;
  label: string;
  icon?: string;
  /** Human-readable shortcut label; pair with a binding and registration. */
  shortcut?: string;
  destructive?: boolean;
  /** Draw a separator before this command within its current menu. */
  separatorBefore?: boolean;
  /** Optional keyboard binding, installed explicitly with registerMenuShortcuts. */
  binding?: WorkspaceMenuBinding;
  disabled?: boolean;
  /** Explanation for a capability or command, rendered under the label. */
  description?: string;
  children?: readonly WorkspaceMenuItem[];
  onSelect?: () => void;
};

/** A top-level heading and its commands in the workspace menubar. */
export type WorkspaceMenuGroup = {
  id: string;
  label: string;
  items: readonly WorkspaceMenuItem[];
  /** Optional preferred content width in pixels, bounded by the viewport. */
  width?: number;
};

export type WorkspaceMenuBinding = {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  allowInEditable?: boolean;
};

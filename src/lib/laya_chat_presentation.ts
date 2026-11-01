import {
  resolveChatPresentation,
  type WorkspaceChatPresentation,
} from "../../slices/workspace-shell/shared/runtime/index.js";
import { chatPresentation } from "./workspace_routes.js";
export type LayaChatMode = (typeof chatPresentation.modes)[number];
export type LayaComparisonKind = (typeof chatPresentation.comparisonKinds)[number];
/** Product taxonomy belongs to the consumer, never to the reusable shell. */
export function resolveLayaChatPresentation(config?: WorkspaceChatPresentation) {
  const resolved = resolveChatPresentation(config);
  const modes = resolved.modes.filter((mode): mode is LayaChatMode =>
    chatPresentation.modes.some((id) => id === mode),
  );
  if (!modes.length) modes.push("chat");
  const comparisonKinds = (resolved.comparisonKinds ?? []).filter(
    (kind): kind is LayaComparisonKind =>
      chatPresentation.comparisonKinds.some((id) => id === kind),
  );
  return {
    ...resolved,
    modes,
    comparisonKinds,
    defaultMode: modes.includes(resolved.defaultMode as LayaChatMode)
      ? (resolved.defaultMode as LayaChatMode)
      : modes[0],
  };
}

export type ComposerCommandQuery = { marker: "/" | "@"; start: number; end: number; query: string };
export type ComposerResource = {
  id: string;
  label: string;
  kind: "plugin" | "connection" | "tool" | "skill" | "category" | "mode" | "action";
  mode?: "chat" | "work" | "compare";
  action?: "attach";
  marker?: "/" | "@";
  icon?: string;
  description?: string;
  connectionId?: string;
  toolName?: string;
  skillId?: string;
  panel?: "tools" | "mcp" | "skills";
};

/** Only a token immediately before the caret can be a command; emails/URLs stay text. */
export function composerCommandQuery(
  text: string,
  caret: number,
  selectionEnd = caret,
): ComposerCommandQuery | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length || selectionEnd !== caret)
    return null;
  const prefix = text.slice(0, caret);
  const match = /(?:^|\s)([\/@])([^\s\/@]{0,80})$/.exec(prefix);
  if (!match) return null;
  const marker = match[1] as "/" | "@";
  return { marker, start: caret - match[2].length - 1, end: caret, query: match[2] };
}

/** Preserve text after the caret and refuse a stale selection rather than delete unrelated text. */
export function replaceComposerCommand(
  text: string,
  token: ComposerCommandQuery,
  replacement = "",
) {
  const current = composerCommandQuery(text, token.end);
  if (
    !current ||
    current.start !== token.start ||
    current.marker !== token.marker ||
    current.query !== token.query
  )
    return { text, caret: Math.min(text.length, token.end), replaced: false };
  return {
    text: text.slice(0, token.start) + replacement + text.slice(token.end),
    caret: token.start + replacement.length,
    replaced: true,
  };
}

export function matchingComposerResources(resources: ComposerResource[], query: string, max = 12) {
  const needle = query.trim().toLocaleLowerCase();
  return resources
    .map((item, index) => {
      const label = item.label.toLocaleLowerCase();
      const text = `${label} ${item.description ?? ""} ${item.kind}`.toLocaleLowerCase();
      const rank = !needle
        ? 0
        : label === needle
          ? 0
          : label.startsWith(needle)
            ? 1
            : label.includes(needle)
              ? 2
              : text.includes(needle)
                ? 3
                : 4;
      return { item, index, rank };
    })
    .filter((row) => row.rank < 4)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, Math.min(24, Math.max(1, max)))
    .map((row) => row.item);
}

/** A selected name must belong to the connection that supplied the visible catalogue. */
export function toggleAvailableTool(
  selected: string[],
  connection: string,
  loadedConnection: string,
  toolNames: string[],
  name: string,
  enabled: boolean,
  maximum: unknown,
) {
  if (!connection || loadedConnection !== connection || !toolNames.includes(name))
    throw new Error("The tool list changed. Refresh this connection before selecting a tool.");
  const id = `${connection}::${name}`;
  if (!enabled) return selected.filter((item) => item !== id);
  if (selected.includes(id)) return [...selected];
  if (typeof maximum !== "number" || !Number.isInteger(maximum) || maximum < 1)
    throw new Error("Tool limits are unavailable. Refresh before selecting a tool.");
  if (selected.length >= maximum)
    throw new Error(`Choose up to ${maximum} tools for one chat. Deselect a tool first.`);
  return [...selected, id];
}

export function nextComposerSelection(current: number, key: string, count: number) {
  // `count` comes from a derived array length, but a negative or fractional value used to
  // index outside the list: `(-5 + 1 + -1) % -1` returned `-0`, and `Enter` returned `-2`.
  // `-1` is the caller's "nothing selected", so anything else must be a real row.
  if (!Number.isInteger(count) || count < 1) return -1;
  const index = Number.isInteger(current) ? ((current % count) + count) % count : 0;
  if (key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowUp") return (index - 1 + count) % count;
  return index;
}

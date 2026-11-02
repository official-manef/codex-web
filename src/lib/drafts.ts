import { createDraftStore } from "#lib/draft_storage.js";

const PREFIX = "laya-draft-v1:";
let hostedScope = "";

/** Scope hosted drafts to the signed-in identity and explicitly paired runtime. */
export function setHostedDraftScope(value: string): void {
  hostedScope = typeof value === "string" && value.length <= 500 ? encodeURIComponent(value) : "";
}
function storagePrefix(): string | null {
  const hosted =
    typeof document !== "undefined" &&
    document.querySelector('meta[name="laya-hosted"]')?.getAttribute("content") === "1";
  return hosted ? (hostedScope ? PREFIX + "hosted:" + hostedScope + ":" : null) : PREFIX;
}
function tabStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

const drafts = createDraftStore({
  prefix: storagePrefix,
  defaultStorage: tabStorage,
  maxChars: 500_000,
  maxKeyChars: 150,
});

/** Per-tab drafts survive refresh without overwriting another tab's work. */
export const readDraft = drafts.read;
export const saveDraft = drafts.save;
export const clearDraft = drafts.clear;

/**
 * The three keys the chat writes per chat id: the unsent draft, its presentation mode and its
 * scroll offset. Each one is keyed by session id, so it outlives its chat unless something
 * sweeps it.
 */
const SESSION_KEYS = ["chat", "chat-mode", "chat-scroll"] as const;

/** Drop every per-chat key for one id. Deleting a chat used to leave two of the three behind. */
export function clearSessionDrafts(id: string): void {
  for (const name of SESSION_KEYS) clearDraft(`${name}:${id}`);
}

/**
 * A per-chat key is written for every chat the user ever opens, and a deleted chat — or one
 * dropped past the write cap — used to leave its keys in storage forever. Measured on the
 * built preview: 30 create/delete cycles left 30 `chat-mode:` keys (4.1 kB) and grew the key
 * count from 6 to 36, with no prune anywhere. Unbounded by construction, so it ends in quota.
 *
 * Called after every session-list refresh: that is the only moment the live ids are known.
 * Returns how many keys it removed, for the caller to log if it ever wants to.
 */
export function pruneSessionDrafts(knownIds: Iterable<string>): number {
  try {
    if (typeof window === "undefined") return 0;
    const storage = window.sessionStorage;
    const prefix = storagePrefix();
    if (!prefix) return 0;
    const live = new Set(knownIds);
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const local = key.slice(prefix.length);
      const cut = local.indexOf(":");
      if (cut < 0) continue;
      if (!SESSION_KEYS.includes(local.slice(0, cut) as (typeof SESSION_KEYS)[number])) continue;
      if (!live.has(local.slice(cut + 1))) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
    return doomed.length;
  } catch {
    // Unavailable storage cannot hold an orphan either.
    return 0;
  }
}

import { createDraftStore } from '#lib/draft_storage.js';

const PREFIX = 'laya-draft-v1:';
let hostedScope = '';

/** Scope hosted drafts to the signed-in identity and explicitly paired runtime. */
export function setHostedDraftScope(value: string): void {
  hostedScope = typeof value === 'string' && value.length <= 500 ? encodeURIComponent(value) : '';
}
function storagePrefix(): string | null {
  const hosted =
    typeof document !== 'undefined' &&
    document.querySelector('meta[name="laya-hosted"]')?.getAttribute('content') === '1';
  return hosted ? (hostedScope ? PREFIX + 'hosted:' + hostedScope + ':' : null) : PREFIX;
}
function tabStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
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
/** Keys this tab found unreadable (copied to `:quarantine`) or too new to overwrite. */
export const draftStorageReport = drafts.report;

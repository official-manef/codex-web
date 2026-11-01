# State model

> **Superseded.** The ten axes below belong to the 0.3.0 `slices/workspace/state.svelte.ts`
> design, which `6ed1f3e` deleted. The shipped shell keeps its state in Laya's
> `slices/workspace-shell/**` plus `src/lib/workspace_persistence.ts` and
> `src/lib/draft_storage.ts`. Kept as design rationale. Index: [README.md](README.md).

One workspace state object, decomposed per slice. Sourced from
`docs/reference/classification-uiux-state.json` (`state_model`, `persistence_plan`) and
normalized to Svelte 5 Runes. No new dimension is added without a note here.

## 1. Dimensions

Ten independent axes. They compose; none implies another.

| ID  | Axis           | Values                                                                                |
| --- | -------------- | ------------------------------------------------------------------------------------- |
| D01 | `location`     | `application_area`, `context_collection`, `active_object`, `active_secondary_content` |
| D02 | `visibility`   | `shown`, `hidden`, `overlay`                                                          |
| D03 | `layout`       | `single_region`, `adjacent_regions`, `focused_region`                                 |
| D04 | `data`         | `unknown`, `loading`, `empty`, `populated`, `partial`, `error`                        |
| D05 | `interaction`  | `rest`, `hover`, `focus`, `pressed`, `selected`, `disabled`                           |
| D06 | `draft`        | `empty`, `modified`, `validating`, `valid`, `invalid`                                 |
| D07 | `process`      | `idle`, `queued`, `running`, `waiting`, `success`, `failed`, `cancelled`              |
| D08 | `persistence`  | `clean`, `dirty`, `saving`, `saved`, `save_error`                                     |
| D09 | `authority`    | `unknown`, `allowed`, `restricted`, `expired`                                         |
| D10 | `connectivity` | `online`, `offline`, `reconnecting`                                                   |

D04 and D07 are different questions. A loaded list (`data: populated`) can belong to a
failing operation (`process: failed`); the UI shows both.

## 2. Owned state, per slice

| Slice              | State                                                                                      | Scope         |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------- |
| `app-shell`        | `activeArea`, `sidebar` (`expanded`/`collapsed`/`drawer_open`), `overlay`, `connectivity`  | app (context) |
| `workspace`        | `mode` (`chat`/`work`), `populated`, `activeObjectId`, `contextSummary` (`shown`/`hidden`) | workspace     |
| `composer`         | `draft` keyed by `draftKey`, `attachments[]`, `submitGuard`, `authority`                   | per draft key |
| `workbench`        | `layout` (`closed`/`split`/`focused`), `tabs[]`, `activeTabId`, `splitWidth`               | per workspace |
| `capabilities`     | `selectedCapabilityId`, `connection` per capability                                        | area          |
| `settings-surface` | `activeSectionId`, `query` (no-match vs empty), `values` + `persistence` per key           | area          |

Nothing in this list lives in a shared mutable server module. State is component or
context scoped; server loaders return immutable data only.

## 3. Entities

```ts
type Tab = {
	id: string;
	kind: 'browser' | 'document' | 'file_preview' | 'tool' | 'review';
	titleKey: string; // placeholder token, not raw copy
	resourceId: string | null;
	status: 'idle' | 'loading' | 'ready' | 'error';
	dirty: boolean;
	ownerChatId: string | null;
	lastFocusedAt: number;
	error: { code: string; messageKey: string } | null;
};

type Attachment = {
	id: string;
	name: string; // real file name, never a token
	mimeType: string;
	sizeBytes: number;
	status: 'validating' | 'uploading' | 'ready' | 'failed';
	progress: number | null;
	previewUrl: string | null; // object URL, revoked on remove/unmount
	reasonKey: string | null; // placeholder token for a failed state
};

type FieldValue = boolean | string;

type Setting = {
	key: string; // placeholder token root
	type: 'toggle' | 'select' | 'path' | 'action';
	value: FieldValue;
	status: 'clean' | 'dirty' | 'saving' | 'saved' | 'invalid' | 'save_error';
	revision: number; // last-write wins per key
};
```

`Tab.titleKey` and `Setting.key` are tokens to stay consistent with
[placeholder-copy.md](placeholder-copy.md). `Attachment.name` is real input data, not copy.

## 4. Derivation rules

```text
draftKey        = activeObjectId ?? ('new:' + (projectId ?? 'none'))
submitEnabled   = draft.valid && authority !== 'restricted' && process !== 'running'
                 && !attachments.some(a => a.status === 'validating' || a.status === 'uploading')
submitReasonKey = first failing predicate → placeholder token
layout          = viewport >= 1100 ? requested layout : single_region
sidebarMode     = viewport < 650 ? 'drawer_open' : requested
activeTab       = tabs.find(t => t.id === activeTabId) ?? tabs.at(-1) ?? null
```

`layout` and `sidebarMode` are derived, never stored as the user's request. The user
request is kept separately so a resize back to desktop restores it (AC10).

## 5. Transitions

Twenty contracts, collapsed to the ones MVP must enforce:

| #   | Trigger                                     | Guard                                        | Effect                                                                          |
| --- | ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| T1  | rail destination click                      | none                                         | `activeArea` set; overlay closed; sidebar visibility per area; drafts untouched |
| T2  | sidebar row selected                        | target exists                                | `activeObjectId` set; previous draft saved to its key first                     |
| T3  | mode switch                                 | draft may be present                         | `mode` set; draft preserved verbatim                                            |
| T4  | submit                                      | `submitEnabled` true; not already submitting | one request id created; message appended once; `process: running`               |
| T5  | cancel during run                           | `process === 'running'`                      | request aborted; partial output kept; `process: cancelled`                      |
| T6  | asset added                                 | type/size within limits                      | `attachments` append; `draft: validating` until ready                           |
| T7  | asset removed                               | exists                                       | removed; object URL revoked                                                     |
| T8  | secondary toggled                           | none                                         | `layout` toggles; tabs + activeTabId preserved                                  |
| T9  | tab closed                                  | `dirty === false`                            | tab removed; if last tab removed, `layout: closed`                              |
| T10 | tab closed while dirty                      | `dirty === true`                             | confirm: keep / discard / cancel; cancel aborts close                           |
| T11 | splitter dragged                            | adjacent layout                              | `splitWidth` clamped to `[340, container-320]`                                  |
| T12 | overlay opened                              | none                                         | one overlay at a time; focus moves into it                                      |
| T13 | Escape                                      | overlay or menu open                         | closes topmost layer; focus returns to trigger                                  |
| T14 | settings field changed                      | none                                         | `persistence: dirty`, then `saving` with incrementing revision                  |
| T15 | settings save resolves                      | response revision < current revision         | ignored (AC12)                                                                  |
| T16 | category search typed                       | settings area                                | filter applied; `no_match` distinct from `empty`                                |
| T17 | capability selected                         | exists                                       | detail pane loads; connection state shown as-is                                 |
| T18 | connect toggled                             | capability present                           | state changes optimistically with a pending marker, reverts on failure          |
| T19 | viewport crosses breakpoint                 | any                                          | derived layout recomputed; no state discarded                                   |
| T20 | unknown `[chatId]` / `[slug]` / `[section]` | route validation fails                       | redirect or 404 boundary with recovery link, not a blank shell                  |

## 6. Persistence

| Data                               | Where                                   | Restore rule                                           |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `activeArea`, settings section     | route (URL)                             | validate against registry                              |
| `sidebar` visibility, `splitWidth` | localStorage, per viewport bucket       | clamp on restore; never force split on narrow screens  |
| drafts (text only)                 | sessionStorage keyed by `draftKey`      | validate key; drop if object gone                      |
| attachment references              | memory only                             | object URLs never survive reload; ask to re-pick       |
| open tabs + active tab             | sessionStorage per workspace            | reload resources only if authority still allows        |
| scroll positions                   | memory, session-scoped                  | restore after content ready; do not steal focus (AC14) |
| settings values                    | per-key source (local or backend later) | never infer an active permission from cached value     |

Never persisted as plain UI preference: integration tokens, credentials, one-off
approval decisions promoted to permanent grants, raw file objects.

## 7. Races MVP must handle

1. Late chat response from a previously selected chat must not replace the current chat.
2. Late settings save must not overwrite a newer value (revision compare, T15).
3. Tab restore must not steal focus after the user already picked another tab.
4. Retry must reuse the request identity so a message is never duplicated (AC04/AC05).
5. Attachment removal during `validating` cancels that validation and revokes its URL.

## 8. Implementation shape

```ts
// slices/workspace/state.svelte.ts  (example, one owner per slice)
let state = $state<WorkspaceState>(initialWorkspaceState());

export function workspaceState() {
	const mode = $derived(state.mode);
	const populated = $derived(state.populated);
	// …
	return {
		get mode() {
			return state.mode;
		},
		setMode(next: Mode) {
			state.mode = next;
		}
	};
}
```

- One state module per slice, exported through the slice barrel.
- App-level state shared via Svelte context (`setContext`/`getContext`) set once in
  `app-shell`, never via a module singleton — the app has one browser session but the
  rule keeps SSR safe and slices testable in isolation.
- Derived values use `$derived`; `$effect` is reserved for real side effects: object URL
  revocation, scroll restoration, focus return, storage writes.
- No `$effect` used to fetch. MVP has no fetch; when a backend arrives it goes through a
  loader or a reactive adapter, not an effect.

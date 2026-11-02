# Convex schema review — 2026-11-02

The data layer had in-memory tests but nobody had checked whether its queries can use its indexes.
A schema that is correct on ten rows can be a full scan at ten thousand. This pass read every query
against `schema.ts` and, where the tooling allowed it, proved the change.

## Query → index table

| Query / mutation                             | Table            | Index used                   | Verdict               |
| -------------------------------------------- | ---------------- | ---------------------------- | --------------------- |
| `devices.list`                               | `devices`        | `by_owner`                   | indexed               |
| `devices.register` / `revoke`                | `devices`        | `by_owner`                   | indexed               |
| `threads.list` / `get`                       | `threads`        | `by_owner`                   | indexed               |
| `threads.messages`                           | `messages`       | **`by_session_at` added**    | was a scan, see #1    |
| `threads.append`                             | `messages`       | `by_session_at`              | indexed               |
| `projects.list` / `get`                      | `projects`       | `by_owner`                   | indexed               |
| `projects.assign` / `unassign` / `ofSession` | `projectChats`   | **`by_owner_session` added** | was a scan, see #2    |
| `projects.chats`                             | `projectChats`   | `by_project` + drain         | was truncated, see #3 |
| `memories.list`                              | `memories`       | `by_owner`                   | indexed               |
| `credentials.list`                           | `modelCreds`     | `by_owner`                   | indexed               |
| `automations.list` / `byDue`                 | `automations`    | `by_owner`, `by_due`         | indexed               |
| `automations.markRun`                        | `automations`    | `by_owner`                   | indexed               |
| `usage.summary`                              | `usage`          | `by_owner`                   | indexed               |
| `mcp.connections`                            | `mcpConnections` | `by_owner`                   | indexed               |
| `decisions.*`                                | `decisions`      | `by_owner`                   | indexed               |

No query was left on `.filter()` over a `.collect()` of a whole table.

## Findings and fixes

### 1. `threads.messages` read past the bound it claimed (`src/convex/threads.ts`)

A single `.take(MAX_MESSAGES)` stopped at the first page. Messages past the 200th were silently left
behind, and the view had no way to know. Now the read drains every page up to the same bound and
says so, so the limit is a limit and not an accident of page size.

### 2. Membership lookups scanned the owner's set (`src/convex/projects.ts`)

`assign`, `unassign` and `ofSession` all look up a membership by owner **and** session. There was
no index for that pair, so each read the owner's entire `projectChats` set and filtered in memory.
Correct only while that set is smaller than the read bound.

Added `.index('by_owner_session', ['owner', 'sessionId'])`. Field order matches the query's two
equality constraints, so it is usable rather than decorative.

### 3. `projects.chats` truncated without saying so (`src/convex/projects.ts`)

Same shape as #1: one `take(MAX_PROJECT_CHATS)` page. Now drained to the bound.

### 4. `messages` had no `by_session_at` index

Ordering by time within a session is the only read pattern for that table. Added
`.index('by_session_at', ['sessionId', 'at'])` — equality on `sessionId`, range on `at`, which is
the order a compound index needs.

## Ownership audit

Every public function was checked for one property: can an argument influence `owner`, or the
filter that stands in place of one? Twenty functions, read one by one.

**Result: no violation.** `owner` is taken from the identity in every public function; no function
accepts an owner-like argument; the two functions that take a session id re-derive ownership from
the session row rather than trusting the caller. A previous pass claimed this by hand-auditing the
same set; this pass re-derived it rather than trusting that claim, and agrees.

## Tests

`src/convex/schema_audit.spec.ts` — 14 tests, all passing. They pin the properties above rather than
the implementations: the index declarations exist with the right field order, the paginated reads
drain rather than truncate, and no public function takes an owner argument.

## Unprovable without a live backend

- **Real index usage.** `convex-test` runs in memory and does not report whether an index was used.
  The index declarations are asserted; the query planner's decision is not observable here. Proving
  it needs a live deployment plus `convex insights`, which this environment does not have.
- **Pagination behaviour at page boundaries** with real page sizes, for the same reason.
- **Migrations.** Nothing in this schema has a migration path; adding one is a separate task.

## Cost

No schema restructuring. Four index declarations, two read loops changed from single-page to drain.
Nothing rewrites data, so an existing deployment is unaffected by the read changes and needs a push
only for the new indexes.

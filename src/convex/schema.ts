import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Tables for the workspace template.
 *
 * Two data planes, deliberately separate:
 *  - Local mode writes nothing here. The shell's chat works offline and keeps its own state.
 *  - Cloud mode (signed in) persists sessions, messages and BYOK credentials here.
 *
 * Every table that holds user data is indexed by owner, so no read needs a scan.
 */
export default defineSchema({
	// ── BYOK credentials ────────────────────────────────────────────────────────────────
	// One row per (owner, provider). `ciphertext` = encryptSecret() output; the raw key is
	// never stored, never logged and never returned to a client.
	modelCreds: defineTable({
		owner: v.string(),
		provider: v.string(),
		/** 'api_key' | 'oauth' — an OAuth row stores JSON {access,refresh,expires}. */
		kind: v.string(),
		ciphertext: v.string(),
		/** Custom-endpoint rows carry their own baseURL; built-ins stay pinned to the registry. */
		endpoint: v.optional(v.string()),
		/** 'anthropic' when the custom endpoint speaks the Messages API; unset = OpenAI. */
		protocol: v.optional(v.string()),
		/** Model ids for a custom provider, which has no catalog entry. */
		models: v.optional(v.array(v.string())),
		label: v.optional(v.string()),
		updatedAt: v.number()
	})
		.index('by_owner', ['owner'])
		.index('by_owner_provider', ['owner', 'provider']),

	// ── per-user MCP (BYOK) ──────────────────────────────────────────────────────────────
	// One row per (owner, alias). `ciphertext` is the same AES-256-GCM blob as `modelCreds`;
	// `tools` is the allowlist enforced on discovery and again before every call.
	mcpConnections: defineTable({
		owner: v.string(),
		alias: v.string(),
		url: v.string(),
		/** 'bearer' | 'x-api-key' — the header convention the credential is sent with. */
		auth: v.union(v.literal('bearer'), v.literal('x-api-key')),
		ciphertext: v.string(),
		tools: v.array(v.string()),
		label: v.optional(v.string()),
		enabled: v.boolean(),
		updatedAt: v.number()
	})
		.index('by_owner', ['owner'])
		.index('by_owner_alias', ['owner', 'alias']),

	// Pending one-shot tool approvals. `tokenHash` is SHA-256 of a token shown to the browser
	// once; the row is deleted by the next call and never contains the plaintext token.
	mcpApprovals: defineTable({
		owner: v.string(),
		tokenHash: v.string(),
		alias: v.string(),
		tool: v.string(),
		/** Exact JSON argument snapshot the user confirmed, sent verbatim on the call. */
		arguments: v.string(),
		expiresAt: v.number()
	})
		.index('by_owner_token', ['owner', 'tokenHash'])
		.index('by_owner', ['owner']),

	// ── chat ─────────────────────────────────────────────────────────────────────────────
	sessions: defineTable({
		owner: v.string(),
		title: v.string(),
		/** "provider/model", or a custom slug. Empty = local-only session synced as text. */
		model: v.string(),
		/** Device the turn ran on: 'local' (browser/NPU) or 'cloud'. */
		engine: v.string(),
		at: v.number()
	})
		.index('by_owner_at', ['owner', 'at'])
		.index('by_owner_title', ['owner', 'title']),

	messages: defineTable({
		owner: v.string(),
		sessionId: v.id('sessions'),
		role: v.string(),
		content: v.string(),
		/** Where the text came from: 'local' | 'cloud' | 'decision'. */
		source: v.string(),
		at: v.number()
	})
		.index('by_session_at', ['sessionId', 'at'])
		.index('by_owner', ['owner']),

	// ── decision model (Jev) ─────────────────────────────────────────────────────────────
	// Passive log of decisions a *device* ran. The template never runs the model server-side;
	// the NPU call happens in the browser or on the paired device, and only the verdict is
	// recorded so a session can show what was decided.
	decisions: defineTable({
		owner: v.string(),
		sessionId: v.optional(v.id('sessions')),
		kind: v.string(),
		question: v.string(),
		choice: v.string(),
		probability: v.number(),
		/** 'npu' (paired device) | 'host' (provider endpoint) | 'local' (in-browser stub). */
		engine: v.string(),
		at: v.number()
	})
		.index('by_owner_at', ['owner', 'at'])
		.index('by_session', ['sessionId', 'at']),

	// ── device pairing ──────────────────────────────────────────────────────────────────
	// A user's own machine can be linked to their account so the browser can stream from it.
	// `tokenHash` is a SHA-256 of the pairing token; the token itself is shown once.
	devices: defineTable({
		owner: v.string(),
		name: v.string(),
		kind: v.string(),
		tokenHash: v.string(),
		/** Validated http/https origin of the user's bridge; absent when unset or not an origin. */
		endpoint: v.optional(v.string()),
		lastSeenAt: v.number(),
		revokedAt: v.optional(v.number())
	}).index('by_owner', ['owner']),

	// ── usage ────────────────────────────────────────────────────────────────────────────
	usage: defineTable({
		owner: v.string(),
		provider: v.string(),
		model: v.string(),
		promptTokens: v.number(),
		completionTokens: v.number(),
		status: v.string(),
		at: v.number()
	}).index('by_owner_at', ['owner', 'at']),

	// ── memories & projects ───────────────────────────────────────────────────────────────
	memories: defineTable({
		owner: v.string(),
		text: v.string(), // ≤ 400 chars, enforced in the handler
		createdAt: v.number(),
		usedAt: v.optional(v.number())
	}).index('by_owner', ['owner']),

	projects: defineTable({
		owner: v.string(),
		name: v.string(), // ≤ 60 chars
		instructions: v.optional(v.string()), // ≤ 2000 chars
		createdAt: v.number()
	}).index('by_owner', ['owner']),

	projectChats: defineTable({
		owner: v.string(),
		projectId: v.id('projects'),
		sessionId: v.string()
	})
		.index('by_owner', ['owner'])
		.index('by_project', ['projectId']),

	// ── automations ───────────────────────────────────────────────────────────────────────
	automations: defineTable({
		owner: v.string(),
		sessionId: v.optional(v.id('sessions')),
		prompt: v.string(),
		intervalMinutes: v.number(),
		nextRunAt: v.number(),
		enabled: v.boolean(),
		failureCount: v.number(),
		lastRunAt: v.optional(v.number())
	})
		.index('by_owner', ['owner'])
		.index('by_due', ['enabled', 'nextRunAt'])
});

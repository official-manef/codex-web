/**
 * In-browser implementation of Laya's API client.
 *
 * The files copied from `rahmanef63/laya-npu` import `#lib/http.js` and call `api.*`, `get`,
 * `post`, `postAudio`. This module keeps that exact surface and serves it from a local
 * store instead of a Python server, so the copied views and the real 3531-line Chat run
 * unchanged in a zero-backend template.
 *
 * What is real: navigation, sessions, drafts, attachments, layout, the whole UI.
 * What is stubbed: model inference, transcription, embeddings, automation, MCP and the
 * hosted pairing handshake. Every stub names itself in its own answer; none claims a
 * capability it does not have.
 *
 * `src/lib/http.ts` re-exports this file. Replacing that re-export with a real transport is
 * the single change a product needs to become backend-connected: call sites never move.
 */

import {
	readVersioned,
	writeVersioned,
	type StorageLike,
	type VersionedSpec
} from '#lib/storage_version.js';

type RuntimeConnection = {
	hosted: boolean;
	connected: boolean;
	baseUrl: string;
	expiresAt: number;
	allowActions: boolean;
};

export function isHostedWorkspace(): boolean {
	// This template is never hosted: there is no local runtime to pair with.
	return false;
}

export function runtimeConnection(): RuntimeConnection {
	return { hosted: false, connected: true, baseUrl: '', expiresAt: 0, allowActions: false };
}

export function loopbackEndpoint(value: string): string {
	const url = new URL(value);
	if (
		url.protocol !== 'http:' ||
		!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	)
		throw new Error('Choose the local runtime on localhost or 127.0.0.1, with its port.');
	return url.origin;
}

export async function pairRuntime(base: string, code: string): Promise<RuntimeConnection> {
	void base;
	void code;
	// TODO(rr): confirm — no pairing in a zero-backend template. A product that ships the
	// hosted mode implements the portal handshake here and deletes this guard.
	throw new Error('This build runs entirely in your browser; there is no runtime to pair.');
}

export async function disconnectRuntime(): Promise<void> {
	if (typeof window !== 'undefined') window.dispatchEvent(new Event('laya:disconnected'));
}

export function headers(extra: Record<string, string> = {}): Record<string, string> {
	return extra;
}

export async function runtimeFetch(path: string, init: RequestInit = {}): Promise<Response> {
	// Kept for API compatibility: the copied attachment upload calls it directly. Nothing
	// here reaches the network, so an unexpected path fails closed instead of hanging.
	if (!path.startsWith('/api/')) throw new Error('Only local API paths are allowed.');
	const handled = await dispatch(path, init);
	return new Response(JSON.stringify(handled), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

export function configureEndpoint(url: string, key: string, model: string) {
	void url;
	void key;
	void model;
	// BYOK credentials have no consumer in this template; accepting them silently would
	// suggest they were stored, so they are dropped with this explicit no-op.
}

// The copied views destructure response fields without declaring them, exactly as Laya's
// client allows. Re-typing 21 vendored views is the drift the vendoring exists to avoid.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function get<T = any>(path: string, signal?: AbortSignal): Promise<T> {
	void signal;
	return (await dispatch(path, {})) as T;
}

export async function post<T = any>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
	void signal;
	return (await dispatch(path, { body: JSON.stringify(body), method: 'POST' })) as T;
}

export async function postAudio<T = any>(
	path: string,
	bytes: ArrayBuffer,
	extra: Record<string, string> = {}
): Promise<T> {
	void extra;
	return (await dispatch(path, { body: bytes as unknown as BodyInit, method: 'POST' })) as T;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── in-browser store ────────────────────────────────────────────────────────────────────

export type LocalReply = {
	text: string;
	model_id: string;
	model_label: string;
	device: string;
	ms: number;
	metrics?: Record<string, unknown>;
	error?: string | null;
	model_capabilities?: Record<string, unknown>;
	tool_proposals?: unknown[];
	comparison_id?: string | null;
	comparison_timing?: unknown;
	attachment_context?: unknown;
	imported?: boolean;
};

export type LocalTurn = {
	id: string;
	content: string;
	context?: unknown;
	attachments: unknown[];
	status: 'done' | 'error' | 'cancelled';
	created_at: number;
	error?: string | null;
	replies: LocalReply[];
};

export type LocalSession = {
	id: string;
	title: string;
	settings: Record<string, unknown>;
	turns: LocalTurn[];
	tool_events: unknown[];
	created_at: number;
	updated_at: number;
};

export type LocalJob = {
	job_id: string;
	state: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
	session_id: string;
	started_at: number;
};

const SESSIONS_KEY = 'workspace-template:sessions';
const JOB_MS = 700;
/** Oldest chats beyond this are not written; the session list says how many were dropped. */
const MAX_SESSIONS = 50;

const jobs = new Map<string, { job: LocalJob; startedAt: number }>();
let sequence = 0;
let persistFailed = false;
/** Sessions that exist in memory but are past the write cap, so the view can say so. */
let droppedFromStorage = 0;
/** Where an unreadable payload was copied on load, and whether it was too new to read. */
let quarantinedOnLoad: string | null = null;
let newerOnLoad: number | null = null;

function nextId(prefix: string): string {
	sequence += 1;
	return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

/** A turn this build can render. Shared by storage load and the update route. */
function cleanTurns(value: unknown): LocalTurn[] {
	if (!Array.isArray(value)) return [];
	return value.filter((turn): turn is LocalTurn => {
		if (!turn || typeof turn !== 'object') return false;
		const candidate = turn as Partial<LocalTurn>;
		return (
			typeof candidate.id === 'string' &&
			typeof candidate.content === 'string' &&
			Array.isArray(candidate.replies)
		);
	});
}

/**
 * Storage is user-writable and may hold a row written by an older build. Trusting the array
 * shape alone was not enough: `[null]`, a row without `turns`, and `turns: null` each threw
 * during `initialize()`, which left the composer disabled with no way back — "New chat" could
 * not run because `session` was never assigned. Every row is therefore rebuilt here, and a row
 * that cannot be rebuilt is left out of the view; the shared reader keeps the original bytes.
 */
function loadSession(value: unknown): LocalSession | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const row = value as Partial<LocalSession>;
	if (typeof row.id !== 'string' || !row.id) return null;
	const created = typeof row.created_at === 'number' ? row.created_at : Date.now();
	return {
		id: row.id,
		title: typeof row.title === 'string' && row.title ? row.title : 'New chat',
		settings: row.settings && typeof row.settings === 'object' ? row.settings : {},
		turns: cleanTurns(row.turns),
		tool_events: Array.isArray(row.tool_events) ? row.tool_events : [],
		created_at: created,
		updated_at: typeof row.updated_at === 'number' ? row.updated_at : created
	};
}

/** Rows this build cannot address are counted, so the original payload is preserved. */
function validateSessions(value: unknown): { value: LocalSession[]; dropped: number } | null {
	if (!Array.isArray(value)) return null;
	const seen = new Set<string>();
	const out: LocalSession[] = [];
	let dropped = 0;
	for (const row of value) {
		const session = loadSession(row);
		if (!session || seen.has(session.id)) {
			dropped += 1;
			continue;
		}
		seen.add(session.id);
		out.push(session);
	}
	return { value: out, dropped };
}

const SESSIONS_SPEC: VersionedSpec<LocalSession[]> = {
	key: SESSIONS_KEY,
	current: 1,
	// A whole chat list can be large; this ceiling is abuse, not a size policy.
	maxChars: 8_000_000,
	fromLegacy: (parsed) => (Array.isArray(parsed) ? parsed : null),
	validate: validateSessions
};

function sessionStorageLike(): StorageLike | undefined {
	try {
		return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
	} catch {
		return undefined;
	}
}

function load(): LocalSession[] {
	const result = readVersioned(SESSIONS_SPEC, sessionStorageLike);
	quarantinedOnLoad = result.quarantineKey;
	newerOnLoad = result.status === 'newer' ? (result.version ?? null) : null;
	return result.value ?? [];
}

/**
 * `false` means this turn exists only in memory. The caller has to say so: a full quota used
 * to drop everything past the write with no message at all, and the chat looked saved until
 * the next reload. A newer payload on disk is never overwritten either, so a downgraded client
 * cannot destroy chats it cannot read.
 */
function persist(): boolean {
	const kept = sessions.slice(0, MAX_SESSIONS);
	droppedFromStorage = sessions.length - kept.length;
	const written = writeVersioned(SESSIONS_SPEC, kept, sessionStorageLike);
	persistFailed = !written;
	return written;
}

/** Read by the session list so the view can tell the user their turn was not written. */
function persistState(): {
	persisted: boolean;
	dropped: number;
	/** Key holding a verbatim copy of a payload this build could not read, if any. */
	quarantined: string | null;
	/** Version found on disk when it was newer than this build can read, if any. */
	newer: number | null;
} {
	return {
		persisted: !persistFailed,
		dropped: droppedFromStorage,
		quarantined: quarantinedOnLoad,
		newer: newerOnLoad
	};
}

/**
 * Declared after `SESSIONS_SPEC`: the store loads at import time and the spec is a `const`, so
 * an earlier declaration would read it in its temporal dead zone.
 */
let sessions: LocalSession[] = load();

function findSession(id: string): LocalSession {
	const found = sessions.find((item) => item.id === id);
	if (!found) throw new Error('That chat is no longer available.');
	return found;
}

function touch(session: LocalSession) {
	session.updated_at = Date.now();
	sessions = [session, ...sessions.filter((item) => item.id !== session.id)];
	persist();
}

/**
 * Chat derives the active device from the backend id (`local:NPU` → `NPU`) and requires
 * `model.devices` to contain it before enabling send. The stub therefore reports a real
 * backend id and a model that claims that device, or the composer stays inert.
 */
const STUB_DEVICE = 'BROWSER';

function backendList() {
	return [
		{
			id: `local:${STUB_DEVICE.toLowerCase()}`,
			device: STUB_DEVICE,
			label: 'This browser',
			kind: 'local' as const,
			present: true,
			// `ready` stays true or the shell selects no backend and the composer can never send.
			// Honesty lives in `stub: true` + `reason`, which every screen reads before claiming
			// a device is usable.
			ready: true,
			reason: 'Browser stub: no local model is loaded',
			latency_ms: null,
			compile_s: null,
			description: 'Template stub. No model runs; replies are fixed text.',
			url: null,
			model: 'stub',
			stub: true
		}
	];
}

function catalogue() {
	return {
		backends: backendList(),
		selected: `local:${STUB_DEVICE.toLowerCase()}`,
		job: { state: 'idle' as const, progress: 0 },
		// The view's default model id is `qwen3-npu` (hardcoded in the copied Chat), so the
		// stub catalogue publishes that id. Otherwise `model` is undefined and the composer
		// stays permanently disabled.
		models: [
			{
				id: 'qwen3-npu',
				label: 'No provider configured',
				// `installed` keeps the composer usable; `stub` is what screens must believe.
				installed: true,
				ready: true,
				present: true,
				size: 0,
				device: STUB_DEVICE,
				devices: [STUB_DEVICE],
				stub: true
			}
		],
		current_model: {
			label: 'No provider configured',
			capabilities: {},
			runtime_error: null,
			stub: true
		},
		capabilities: {
			attachments: {
				max_files_per_turn: 4,
				// The views read `max_file_bytes`; `max_bytes` was a second name nothing read, so
				// Embedding search rendered "4 files · NaN MB each" from an undefined field.
				max_file_bytes: 8 * 1024 * 1024,
				kinds: ['image', 'pdf', 'text']
			},
			tools: [],
			devices: ['Browser']
		}
	};
}

function reply(_index: number): LocalReply {
	void _index;
	void _index;
	return {
		text: 'No provider configured',
		model_id: 'stub',
		model_label: 'No provider configured',
		device: 'Not configured',
		ms: JOB_MS,
		metrics: {},
		error: null,
		model_capabilities: {},
		tool_proposals: [],
		comparison_id: null,
		comparison_timing: null,
		attachment_context: null,
		imported: false
	};
}

function settle(job: LocalJob): LocalJob {
	if (job.state === 'cancelled' || job.state === 'done') return job;
	const entry = jobs.get(job.job_id);
	const elapsed = Date.now() - (entry?.startedAt ?? Date.now());
	if (elapsed < JOB_MS) return { ...job, state: 'running' };
	const session = sessions.find((item) => item.id === job.session_id);
	const turn = session?.turns.at(-1);
	if (session && turn) {
		turn.replies = [reply(session.turns.length - 1)];
		turn.status = 'done';
		touch(session);
	}
	return { ...job, state: 'done' };
}

function bodyOf(init: RequestInit): Record<string, unknown> {
	try {
		return typeof init.body === 'string' && init.body
			? (JSON.parse(init.body) as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

async function dispatch(rawPath: string, init: RequestInit): Promise<unknown> {
	// Views append query strings (`/api/models/recommendations?task=…`); the route table is
	// keyed by path only.
	const path = rawPath.split('?')[0];
	const body = bodyOf(init);

	switch (path) {
		// ── session lifecycle ────────────────────────────────────────────────────────────
		case '/api/sessions':
			return {
				sessions: sessions.map((item) => ({
					id: item.id,
					title: item.title,
					created_at: item.created_at,
					updated_at: item.updated_at,
					turns: item.turns.length,
					json: null
				})),
				storage: persistState()
			};

		case '/api/sessions/create': {
			const now = Date.now();
			const session: LocalSession = {
				id: nextId('session'),
				title: 'New chat',
				settings: (body.settings as Record<string, unknown>) ?? {},
				turns: [],
				tool_events: [],
				created_at: now,
				updated_at: now
			};
			touch(session);
			return { session };
		}

		case '/api/sessions/read':
			return { session: findSession(String(body.id)) };

		case '/api/sessions/update': {
			const session = findSession(String(body.id));
			if (typeof body.title === 'string' && body.title.trim()) session.title = body.title.trim();
			if (body.settings && typeof body.settings === 'object')
				session.settings = { ...session.settings, ...(body.settings as Record<string, unknown>) };
			// The BYOK and cloud paths send the whole turn list back; ignoring it meant every
			// one of those replies lived only until the next reload.
			if (Array.isArray(body.turns)) session.turns = cleanTurns(body.turns);
			touch(session);
			return { session };
		}

		case '/api/sessions/clear': {
			const session = findSession(String(body.id));
			session.turns = [];
			touch(session);
			return { session };
		}

		case '/api/sessions/delete':
			sessions = sessions.filter((item) => item.id !== body.id);
			persist();
			return { deleted: true };

		case '/api/sessions/fork': {
			const source = findSession(String(body.id));
			const now = Date.now();
			const fork: LocalSession = {
				...source,
				id: nextId('session'),
				title: `${source.title} (fork)`,
				turns: source.turns.map((turn) => ({ ...turn, replies: [...turn.replies] })),
				created_at: now,
				updated_at: now
			};
			touch(fork);
			return { session: fork };
		}

		case '/api/sessions/export':
			return { json: JSON.stringify(findSession(String(body.id)), null, 2) };

		case '/api/sessions/message-delete':
			return { ok: true };

		// ── chat ─────────────────────────────────────────────────────────────────────────
		case '/api/chat':
			return catalogue();

		case '/api/chat/start': {
			const session = findSession(String(body.session_id));
			const turn: LocalTurn = {
				id: nextId('turn'),
				content: String(body.content ?? ''),
				context: body.context ?? null,
				attachments: Array.isArray(body.attachment_ids) ? (body.attachment_ids as string[]) : [],
				status: 'done',
				created_at: Date.now(),
				error: null,
				replies: []
			};
			session.turns = [...session.turns, turn];
			if (session.title === 'New chat') session.title = turn.content.slice(0, 60) || 'New chat';
			touch(session);
			const job: LocalJob = {
				job_id: nextId('job'),
				state: 'running',
				session_id: session.id,
				started_at: Date.now()
			};
			jobs.set(job.job_id, { job, startedAt: Date.now() });
			return job;
		}

		case '/api/chat/job': {
			const id = String(body.job_id);
			const entry = jobs.get(id);
			if (!entry) throw new Error('That generation is no longer available.');
			entry.job = settle(entry.job);
			const session = sessions.find((item) => item.id === entry.job.session_id);
			return { ...entry.job, result: { session } };
		}

		case '/api/chat/cancel': {
			const entry = jobs.get(String(body.job_id));
			if (entry) {
				entry.job = { ...entry.job, state: 'cancelled' };
				const session = sessions.find((item) => item.id === entry.job.session_id);
				const turn = session?.turns.at(-1);
				if (session && turn) {
					turn.status = 'cancelled';
					touch(session);
				}
			}
			return { state: 'cancelled' };
		}

		case '/api/chat/load':
		case '/api/chat/download':
			return catalogue();

		case '/api/chat/resources':
			return { resources: [] };

		// ── attachments ──────────────────────────────────────────────────────────────────
		case '/api/attachments':
			// Echo what the caller actually chose. Returning a fixed `name: 'attachment'` threw
			// the filename away, so every chip read "attachment" and an image could not be
			// previewed because `kind` was never set.
			return {
				id: nextId('attachment'),
				name: typeof body.name === 'string' && body.name ? body.name.slice(0, 255) : 'attachment',
				kind: typeof body.type === 'string' && body.type.startsWith('image/') ? 'image' : 'file',
				type: typeof body.type === 'string' ? body.type : '',
				size: typeof body.size === 'number' ? body.size : 0,
				status: 'ready'
			};

		case '/api/attachments/delete':
			return { deleted: true };

		// ── discovery ────────────────────────────────────────────────────────────────────
		case '/api/backends':
			return { backends: backendList(), current: `local:${STUB_DEVICE.toLowerCase()}` };

		case '/api/device':
			return { id: 'template', name: 'This browser', portal: '', stub: true };

		case '/api/driver':
		case '/api/runtime':
			return { ok: false, runtime: 'browser-stub', backends: backendList(), stub: true };

		case '/api/health':
			return { ok: false, runtime: 'browser-stub', stub: true };

		case '/api/capabilities':
			return catalogue().capabilities;

		case '/api/asr':
			// Transcribe, Voice and SpeechControls read this: `present: false` closes the panel and
			// makes "no speech model in this build" the answer instead of a failed fetch.
			return {
				present: false,
				devices: [],
				languages: ['en'],
				multilingual: false,
				formats: [],
				max_mb: null,
				max_seconds: null,
				stub: true
			};

		case '/api/pipeline':
			return {
				asr: {
					present: false,
					devices: [],
					languages: ['en'],
					multilingual: false,
					formats: [],
					max_mb: null,
					max_seconds: null
				},
				pipeline: []
			};

		case '/api/tasks':
			return { tasks: [] };

		case '/api/runtime/restart':
			return { ok: true };

		// ── hosted pairing: impossible here, and it says so ───────────────────────────────
		case '/api/portal/claim':
		case '/api/portal/disconnect':
			throw new Error('This build runs entirely in your browser; there is no runtime to pair.');

		default:
			// Every compute-backed endpoint answers with the right shape, a `stub` flag and a
			// reason, so no view can present it as real output. Unknown paths fail closed.
			return stubResponse(path);
	}
}

/**
 * One honest answer for every endpoint that would need a real server. Each shape matches
 * what its view actually reads (verified against the copied views), and each carries
 * `stub: true` plus a reason so nothing can be presented as real output.
 */
function stubResponse(path: string): Record<string, unknown> {
	// User-facing, because a view prints it: naming the source file was talking to the repo's
	// maintainer, not to the person reading the screen.
	const reason =
		'This browser build has no runtime behind it, so the request cannot be answered here. The desktop app is the build that can.';

	switch (path) {
		// Deps.svelte reads `st.packages`, then filters. Without the array it throws.
		case '/api/deps':
			return {
				python: 'unknown',
				interpreter: 'none',
				packages: [],
				missing: [],
				required_missing: [],
				job: { state: 'idle' },
				note: reason,
				stub: true
			};

		// Models.svelte reads `d.catalogue ?? d` and `d.job`, then `cat.current_model.label`.
		case '/api/models':
			return {
				catalogue: {
					models: [],
					device: 'Browser',
					current_model: {
						label: 'No provider configured',
						capabilities: {},
						runtime_error: null,
						stub: true
					}
				},
				job: { state: 'idle' },
				stub: true,
				reason
			};

		// Models.svelte reads `recommendations.hardware.devices.join(...)` and `tasks[]`.
		case '/api/models/recommendations':
			return {
				hardware: { devices: [], runtime_error: null },
				tasks: [],
				stub: true,
				reason
			};

		// Workflow views read `workflows`, `runs`, `catalogue`.
		case '/api/workflows':
		case '/api/workflows/catalogue':
		case '/api/workflows/runs':
			return { workflows: [], runs: [], catalogue: [], stub: true, reason };

		// SnakeHistory reads `data.runs`; the stub ships no recordings.
		case '/api/benchmarks':
			return { runs: [], stub: true, reason };

		case '/api/mcp/status':
			return { connections: [], stub: true, reason };
		case '/api/mcp/tools':
			return { tools: [], stub: true, reason };

		case '/api/auth/session':
			return { session: null, stub: true, reason };

		// Apps.svelte reads `extensions`, `max_bytes`, `policy.folders`, `policy.min_confidence`,
		// `policy.review_folder`, `output_root` and `available`. Answering with the generic
		// `{error}` shape made `config.policy.folders` throw, so the whole document recipe
		// reported "Automation status did not load" — a build with no runtime shown as a
		// failure.
		case '/api/automation/status':
			return {
				available: false,
				output_root: '',
				extensions: [],
				max_bytes: null,
				policy: { folders: {}, min_confidence: 0.85, review_folder: 'Needs review' },
				reason,
				stub: true
			};

		// Embeddings reads `installed`, `reason`, `devices`, `limits` and `job`. The generic
		// error shape threw instead of reaching the view's own "install a model" panel.
		case '/api/embeddings':
			return {
				installed: false,
				reason,
				devices: [],
				dimensions: null,
				limits: { max_documents: 0, max_query_chars: 500 },
				job: { state: 'idle' },
				stub: true
			};

		default:
			return { error: reason, stub: true, reason };
	}
}

// ── named endpoint map the copied views call ─────────────────────────────────────────────

export const api = {
	tasks: () => get('/api/tasks'),
	backends: () => get('/api/backends'),
	health: () => get('/api/health'),
	driver: () => get('/api/driver'),
	device: () => get('/api/device'),
	pipeline: () => get('/api/pipeline'),
	asr: () => get('/api/asr'),
	analyse: (text: string, task: string, opts: Record<string, unknown> = {}, signal?: AbortSignal) =>
		post('/api/analyse', { text, task, ...opts }, signal),
	custom: (
		state: string | Record<string, unknown>,
		questions: unknown,
		opts: Record<string, unknown> = {},
		signal?: AbortSignal
	) => post('/api/custom', { state, questions, ...opts }, signal),
	rpa: (body: unknown) => post('/api/rpa', body),
	chatStatus: () => get('/api/chat'),
	chatLoad: (device: string, model_id?: string) => post('/api/chat/load', { device, model_id }),
	chatDownload: (model_id?: string) => post('/api/chat/download', { model_id }),
	chat: (body: unknown) => post('/api/chat', body),
	chatStart: (body: unknown) => post('/api/chat/start', body),
	chatJob: (job_id: string) => post('/api/chat/job', { job_id }),
	chatCancel: (job_id: string) => post('/api/chat/cancel', { job_id }),
	sessions: () => get('/api/sessions'),
	sessionCreate: (body: unknown = {}) => post('/api/sessions/create', body),
	sessionRead: (id: string) => post('/api/sessions/read', { id }),
	sessionUpdate: (id: string, changes: Record<string, unknown>) =>
		post('/api/sessions/update', { id, ...changes }),
	sessionClear: (id: string) => post('/api/sessions/clear', { id, confirm: true }),
	sessionDelete: (id: string) => post('/api/sessions/delete', { id, confirm: true }),
	sessionExport: (id: string) => post('/api/sessions/export', { id }),
	sessionFork: (id: string, options: Record<string, unknown> = {}) =>
		post('/api/sessions/fork', { id, ...options }),
	mcpStatus: () => get('/api/mcp/status'),
	mcpConnect: (body: unknown) => post('/api/mcp/connect', body),
	mcpTools: (connection_id: string) => post('/api/mcp/tools', { connection_id }),
	mcpDelete: (connection_id: string) => post('/api/mcp/delete', { connection_id }),
	mcpPrepare: (body: unknown) => post('/api/mcp/prepare', body),
	mcpCall: (approval_id: string) => post('/api/mcp/call', { approval_id, confirm: true }),
	capabilities: () => get('/api/capabilities'),
	attachmentUpload: async (file: File) =>
		post('/api/attachments', { name: file.name, type: file.type, size: file.size }),
	attachmentDelete: (id: string) => post('/api/attachments/delete', { id, confirm: true })
};

/**
 * MANEF AI hub client.
 *
 * The hub is a loopback process owned by `manef-ai`; a browser cannot call it directly
 * because it only answers `Host: 127.0.0.1` and same-origin requests. These functions call
 * this app's `/api/manef/*` bridge, which forwards exactly three paths on the server.
 *
 * Nothing here authenticates. The hub's descriptors grant no authority, a plan is a preview,
 * and `/api/manef/ready` reports `unconfigured` until a real authorized adapter exists.
 */

export type Capability = {
	id: string;
	summary: string;
	effects: string[];
	requiredScopes: string[];
	mode: string;
	risk: string;
	input: { format: string; ref: string | null };
	output: { format: string; ref: string | null };
};

export type Module = {
	contractVersion: string;
	id: string;
	name: string;
	version: string;
	kind: string;
	runtime: { language: string; minimumVersion: string; manager: string };
	source: { repository: string; revision: string; channel: string; link: string | null };
	capabilities: Capability[];
	config: { defaultMode: string; secrets: string };
	status: string;
	liveStatus: string;
};

export type Registry = { foundationVersion: string | null; modules: Module[] };

export type Step = { moduleId: string; capabilityId: string; input: unknown };
export type Plan = {
	ok: boolean;
	mode: string;
	status: string;
	steps: {
		index: number;
		moduleId: string;
		capabilityId: string;
		provenance: { repository: string; revision: string; channel: string };
		effects: string[];
		requiredScopes: string[];
		status: string;
		input: unknown;
	}[];
	errors: string[];
};

export type Readiness =
	| { configured: false; liveAdapters: 'unconfigured'; modules: []; foundationVersion: null }
	| { status: string; mode: string; liveAdapters: string };

/** Fixed, human-readable text for the hub's error codes. Never a raw upstream string. */
const ERRORS: Record<string, string> = {
	hub_unconfigured: 'No MANEF AI hub is configured. Set MANEF_HUB_URL to a loopback hub URL.',
	hub_unreachable: 'The MANEF AI hub did not answer. Start it with `pnpm run dev` in manef-ai.',
	hub_response_invalid: 'The MANEF AI hub sent a response this console cannot read.',
	hub_response_too_large: 'The MANEF AI hub response exceeded the bridge limit.',
	invalid_plan: 'Send a workflow object with a version and steps.',
	preview_plan_required: 'Use version 1.0.0 and preview mode.',
	invalid_steps: 'Add 1–32 steps, each with moduleId, capabilityId and input.',
	authority_not_allowed:
		'Remove identity, approval and credential fields. Products authenticate their own callers.',
	payload_too_large: 'The request exceeds 64 KB.',
	invalid_json: 'Enter valid JSON.',
	unknown_module: 'That module is not declared by the hub registry.',
	unknown_capability: 'That capability is not declared by the module.'
};

export function hubMessage(code: string): string {
	// Own-property lookup only. `ERRORS[code] ?? …` returned inherited members, so an upstream
	// code of `toString` reached the user as `function toString() { [native code] }` instead of
	// the fixed text this table promises.
	return Object.hasOwn(ERRORS, code) ? ERRORS[code] : 'The local request could not complete.';
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, { cache: 'no-store', ...init });
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const code =
			typeof body === 'object' && body !== null && 'error' in body
				? String((body as { error?: { code?: unknown } }).error?.code ?? 'unknown')
				: typeof body === 'object' && body !== null && 'code' in body
					? String((body as { code?: unknown }).code)
					: // `error()` responses carry `message`; our own failures carry `error.code`.
						typeof body === 'object' && body !== null && 'message' in body
						? String((body as { message?: unknown }).message)
						: 'unknown';
		throw new Error(hubMessage(code));
	}
	return body as T;
}

export const hub = {
	modules: () => call<Registry>('/api/manef/modules'),
	ready: () => call<Readiness>('/api/manef/ready'),
	plan: (request: unknown) =>
		call<Plan>('/api/manef/plan', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(request)
		})
};

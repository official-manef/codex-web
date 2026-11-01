/**
 * Which runtime each registered workspace feature needs.
 *
 * Metadata only: this decides what the rail shows, never what the app is allowed to do.
 * Pure data and pure functions, no runes.
 */
import type { Surface } from '#lib/config/surface.js';

export type FeatureRequirement = 'local-runtime' | 'any';

export const FEATURE_ACCESS: Readonly<Record<string, FeatureRequirement>> = Object.freeze({
	// Needs the runtime on this machine (or a paired device).
	apps: 'local-runtime',
	transcribe: 'local-runtime',
	models: 'local-runtime',
	overview: 'local-runtime',
	setup: 'local-runtime',
	backends: 'local-runtime',
	voice: 'local-runtime',
	playground: 'local-runtime',
	snake: 'local-runtime',
	embeddings: 'local-runtime',
	files: 'local-runtime',
	browser: 'local-runtime',
	terminal: 'local-runtime',
	// Works in a hosted build.
	chat: 'any',
	manef: 'any',
	providers: 'any',
	keys: 'any',
	pricing: 'any',
	faq: 'any',
	'chat-tools': 'any',
	'chat-settings': 'any',
	'chat-session': 'any',
	'workspace-home': 'any',
	// Settings surfaces that must stay reachable so the toggles can be changed back.
	tools: 'any',
	devices: 'any',
	memories: 'any',
	git: 'any'
});

/** Navigation that must stay reachable, including the Tools screen that re-enables the rest. */
export const ALWAYS_ENABLED: readonly string[] = [
	'chat',
	'manef',
	'providers',
	'keys',
	'faq',
	'tools',
	'devices',
	// The tab stays so its "pair a terminal device first" screen is reachable; connecting is
	// still gated by the paired device and the Tools switch.
	'terminal'
];

const ALL_IDS = Object.keys(FEATURE_ACCESS);

function normalize(ids: readonly string[]): string[] {
	return [...new Set(ids)].sort();
}

/**
 * Defaults per surface; always-enabled navigation stays in the set.
 *
 * The terminal tab is present by default so the screen that explains "pair a terminal device
 * first" is discoverable. Connecting stays gated by the paired device and the Tools switch.
 */
export function defaultEnabled(surface: Surface): string[] {
	const ids = ALL_IDS.filter((id) => surface !== 'cloud' || FEATURE_ACCESS[id] !== 'local-runtime');
	return normalize([...ids, ...ALWAYS_ENABLED]);
}

/** Validated stored selection: unknown ids dropped, required ids unioned, deterministic order. */
export function resolveEnabled(stored: unknown, surface: Surface): string[] {
	if (!Array.isArray(stored) || !stored.every((id): id is string => typeof id === 'string')) {
		return defaultEnabled(surface);
	}
	return normalize([
		...stored.filter((id) => Object.hasOwn(FEATURE_ACCESS, id)),
		...ALWAYS_ENABLED
	]);
}

/** True when the surface, not the user, is hiding this feature. */
export function isHiddenBySurface(id: string, surface: Surface): boolean {
	return surface === 'cloud' && FEATURE_ACCESS[id] === 'local-runtime';
}

/** Short helper copy for a toggle row. */
export function accessLabel(requirement: FeatureRequirement, surface: Surface): string {
	if (requirement === 'any') return 'Works anywhere';
	return surface === 'cloud' ? 'Needs a paired device or this machine' : 'Runs on this machine';
}

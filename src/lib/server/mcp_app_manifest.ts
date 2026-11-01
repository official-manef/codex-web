// Closed allowlist for hosted MCP apps: an app appears only if the operator listed it, and the frame policy in mcp_app_host.ts is what actually contains it.

import { framePolicy } from '../mcp_app_host';

export type AppManifest = {
	id: string;
	name: string;
	origin: string;
	entry: string;
	surfaces: string[];
};

export const MAX_APPS = 20;
export const SURFACES = ['sidebar', 'panel', 'file-editor', 'form'] as const;

export function parseManifest(value: unknown): AppManifest | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}

	const candidate = value as Record<string, unknown>;

	if (typeof candidate.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,31}$/.test(candidate.id)) {
		return null;
	}

	if (typeof candidate.name !== 'string') {
		return null;
	}
	const name = candidate.name.trim();
	if (name.length < 1 || name.length > 60) {
		return null;
	}

	if (typeof candidate.origin !== 'string' || !candidate.origin) {
		return null;
	}
	try {
		framePolicy(candidate.origin);
	} catch {
		return null;
	}

	if (
		typeof candidate.entry !== 'string' ||
		candidate.entry.length < 1 ||
		candidate.entry.length > 200 ||
		!candidate.entry.startsWith('/') ||
		candidate.entry.includes('//') ||
		candidate.entry.includes('..') ||
		candidate.entry.includes('\0')
	) {
		return null;
	}

	try {
		const resolved = new URL(candidate.entry, candidate.origin);
		if (resolved.origin !== candidate.origin) {
			return null;
		}
	} catch {
		return null;
	}

	if (!Array.isArray(candidate.surfaces)) {
		return null;
	}
	if (candidate.surfaces.length < 1 || candidate.surfaces.length > 4) {
		return null;
	}

	const surfaces: string[] = [];
	const seenSurfaces = new Set<string>();
	for (const surface of candidate.surfaces) {
		if (typeof surface !== 'string') {
			return null;
		}
		if (!SURFACES.includes(surface as (typeof SURFACES)[number])) {
			return null;
		}
		if (seenSurfaces.has(surface)) {
			return null;
		}
		seenSurfaces.add(surface);
		surfaces.push(surface);
	}

	return {
		id: candidate.id,
		name,
		origin: candidate.origin,
		entry: candidate.entry,
		surfaces
	};
}

export function manifestRejection(m: AppManifest): string | null {
	if (!m || typeof m !== 'object') {
		return 'Manifest must be an object';
	}

	if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,31}$/.test(m.id)) {
		return 'Invalid app id';
	}

	if (typeof m.name !== 'string' || m.name.trim().length < 1 || m.name.trim().length > 60) {
		return 'Invalid app name';
	}

	if (typeof m.origin !== 'string' || !m.origin) {
		return 'App origin must be a non-empty string';
	}
	try {
		framePolicy(m.origin);
	} catch (err) {
		return err instanceof Error ? err.message : 'Invalid app origin';
	}

	if (typeof m.entry !== 'string') {
		return 'App entry must be a string';
	}
	if (m.entry.length < 1 || m.entry.length > 200) {
		return 'App entry must be between 1 and 200 characters';
	}
	try {
		const resolved = new URL(m.entry, m.origin);
		if (resolved.origin !== m.origin) {
			return 'App entry origin does not match app origin';
		}
	} catch {
		return 'Invalid app entry URL';
	}
	if (!m.entry.startsWith('/')) {
		return 'App entry must be a path beginning with /';
	}
	if (m.entry.includes('//')) {
		return 'App entry must not contain //';
	}
	if (m.entry.includes('..')) {
		return 'App entry must not contain ..';
	}
	if (m.entry.includes('\0')) {
		return 'App entry must not contain NUL';
	}

	if (!Array.isArray(m.surfaces)) {
		return 'App surfaces must be an array';
	}
	if (m.surfaces.length < 1 || m.surfaces.length > 4) {
		return 'App surfaces must contain between 1 and 4 surfaces';
	}

	const seenSurfaces = new Set<string>();
	for (const surface of m.surfaces) {
		if (typeof surface !== 'string' || !SURFACES.includes(surface as (typeof SURFACES)[number])) {
			return `Unknown surface: ${String(surface)}`;
		}
		if (seenSurfaces.has(surface)) {
			return `Duplicate surface: ${surface}`;
		}
		seenSurfaces.add(surface);
	}

	return null;
}

export function parseAppList(value: unknown): AppManifest[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const apps: AppManifest[] = [];
	const seenIds = new Set<string>();

	for (const item of value) {
		const manifest = parseManifest(item);
		if (!manifest) continue;
		if (seenIds.has(manifest.id)) continue;
		seenIds.add(manifest.id);
		apps.push(manifest);
		if (apps.length >= MAX_APPS) break;
	}

	return apps;
}

/**
 * Project membership for chats.
 *
 * Local state only. This template has no shared identity and no server-side session store, so
 * a project is a name the user assigns to a chat id and nothing more — it is never a
 * permission, never a filesystem path, and never leaves this browser.
 *
 * Storage is `localStorage`, not the session-scoped draft store: membership must survive a tab
 * close, and a chat that loses its project on reload would be worse than not having one.
 *
 * Both keys carry the shared version envelope (`{ version, value }`, see
 * `#lib/storage_version`). Every build before the envelope wrote a bare array or object, which
 * is read as version 0 and migrated once.
 */

import {
	readVersioned,
	writeVersioned,
	type StorageLike,
	type VersionedSpec,
	type VersionedRead
} from '#lib/storage_version.js';

export type Project = { id: string; name: string; createdAt: number };

/** Which project a chat belongs to. Absent means "no project". */
export type Membership = Record<string, string>;

export type ProjectStorageStatus = {
	/** True when storage holds a version this build cannot read; nothing is written in that case. */
	newer: boolean;
	quarantined: string[];
	dropped: number;
};

export type ProjectStore = {
	projects: () => Project[];
	membership: () => Membership;
	create: (name: string) => Project | null;
	rename: (id: string, name: string) => boolean;
	remove: (id: string) => boolean;
	assign: (sessionId: string, projectId: string | null) => boolean;
	projectOf: (sessionId: string) => Project | null;
	sessionsIn: (projectId: string) => string[];
	status: () => ProjectStorageStatus;
};

const PROJECTS_KEY = 'codex-web:projects:v1';
const MEMBERSHIP_KEY = 'codex-web:project-members:v1';

export const MAX_PROJECTS = 50;
export const MAX_NAME_CHARS = 60;

/** A name a person can read back: trimmed, bounded, never empty. */
export function cleanName(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const name = value.trim().replace(/\s+/g, ' ');
	if (!name || name.length > MAX_NAME_CHARS) return null;
	return name;
}

function storage(): StorageLike | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		// Private mode and blocked storage both throw on access.
		return undefined;
	}
}

function newId(): string {
	return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Shape validation on read. Storage is user-writable and may be stale from an older version,
 * so anything that does not match is left out of the view rather than trusted — and counted,
 * so the shared reader can copy the original payload aside before it is ever rewritten.
 */
export function parseProjects(value: unknown): { value: Project[]; dropped: number } | null {
	if (!Array.isArray(value)) return null;
	const seen = new Set<string>();
	const out: Project[] = [];
	let dropped = 0;
	for (const row of value) {
		const fields = row && typeof row === 'object' ? (row as Partial<Project>) : null;
		const clean = fields ? cleanName(fields.name) : null;
		if (!fields || typeof fields.id !== 'string' || !fields.id || seen.has(fields.id) || !clean) {
			dropped += 1;
			continue;
		}
		seen.add(fields.id);
		out.push({
			id: fields.id,
			name: clean,
			createdAt: typeof fields.createdAt === 'number' ? fields.createdAt : 0
		});
		// Past the cap the surplus rows are still valid projects, not corruption.
		if (out.length === MAX_PROJECTS) break;
	}
	return { value: out, dropped };
}

/**
 * A membership whose project is gone is a leak, not corruption: it is filtered here but is not
 * counted as damage, because removing a project deliberately rewrites the map without it.
 */
export function parseMembership(
	value: unknown,
	projects: Project[]
): { value: Membership; dropped: number } | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const known = new Set(projects.map((project) => project.id));
	const out: Membership = {};
	for (const [sessionId, projectId] of Object.entries(value as Record<string, unknown>)) {
		if (typeof projectId === 'string' && projectId && known.has(projectId) && sessionId)
			out[sessionId] = projectId;
	}
	return { value: out, dropped: 0 };
}

const PROJECTS_SPEC: VersionedSpec<Project[]> = {
	key: PROJECTS_KEY,
	current: 1,
	maxChars: 200_000,
	fromLegacy: (parsed) => (Array.isArray(parsed) ? parsed : null),
	validate: parseProjects
};

/** The membership spec needs the project list, so it is built per store instance. */
function membershipSpec(projects: Project[]): VersionedSpec<Membership> {
	return {
		key: MEMBERSHIP_KEY,
		current: 1,
		maxChars: 200_000,
		fromLegacy: (parsed) =>
			parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null,
		validate: (value) => parseMembership(value, projects)
	};
}

export function createProjectStore(
	options: { storage?: () => StorageLike | undefined } = {}
): ProjectStore {
	const store = options.storage ?? storage;
	const status: ProjectStorageStatus = { newer: false, quarantined: [], dropped: 0 };

	function record(result: VersionedRead<unknown>): void {
		status.newer = status.newer || result.status === 'newer';
		if (result.quarantineKey) status.quarantined = [...status.quarantined, result.quarantineKey];
		status.dropped += result.dropped;
	}

	function projects(): Project[] {
		const result = readVersioned(PROJECTS_SPEC, store);
		record(result);
		return result.value ?? [];
	}

	function membership(rows: Project[] = projects()): Membership {
		// Reading the project list first is what lets a membership row be judged; a membership
		// that cannot be read on its own is still preserved by the shared reader.
		const result = readVersioned(membershipSpec(rows), store);
		record(result);
		return result.value ?? {};
	}

	return {
		projects,
		membership,
		status: () => ({ ...status, quarantined: [...status.quarantined] }),
		projectOf(sessionId) {
			const rows = projects();
			const id = membership(rows)[sessionId];
			return id ? (rows.find((project) => project.id === id) ?? null) : null;
		},
		sessionsIn(projectId) {
			return Object.entries(membership())
				.filter(([, id]) => id === projectId)
				.map(([sessionId]) => sessionId);
		},
		create(name) {
			const clean = cleanName(name);
			if (!clean) return null;
			const rows = projects();
			if (status.newer) return null;
			if (rows.length >= MAX_PROJECTS) return null;
			// Same name twice is allowed; the id is what identifies a project.
			const project: Project = { id: newId(), name: clean, createdAt: Date.now() };
			return writeVersioned(PROJECTS_SPEC, [...rows, project], store) ? project : null;
		},
		rename(id, name) {
			const clean = cleanName(name);
			if (!clean) return false;
			const rows = projects();
			if (status.newer) return false;
			if (!rows.some((project) => project.id === id)) return false;
			return writeVersioned(
				PROJECTS_SPEC,
				rows.map((project) => (project.id === id ? { ...project, name: clean } : project)),
				store
			);
		},
		remove(id) {
			const rows = projects();
			if (status.newer) return false;
			if (!rows.some((project) => project.id === id)) return false;
			const remaining = rows.filter((project) => project.id !== id);
			// Drop the memberships first: an orphaned one would be filtered on read anyway, but
			// leaving it in storage would resurrect the chat if the id were ever reused.
			const next = membership(rows);
			for (const [sessionId, projectId] of Object.entries(next))
				if (projectId === id) delete next[sessionId];
			return (
				writeVersioned(PROJECTS_SPEC, remaining, store) &&
				writeVersioned(membershipSpec(remaining), next, store)
			);
		},
		assign(sessionId, projectId) {
			if (!sessionId) return false;
			const rows = projects();
			if (status.newer) return false;
			const next = membership(rows);
			if (projectId === null) delete next[sessionId];
			else {
				if (!rows.some((project) => project.id === projectId)) return false;
				next[sessionId] = projectId;
			}
			return writeVersioned(membershipSpec(rows), next, store);
		}
	};
}

export const projectStore = createProjectStore();

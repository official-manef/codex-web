/**
 * Project membership for chats.
 *
 * Local state only. This template has no shared identity and no server-side session store, so
 * a project is a name the user assigns to a chat id and nothing more — it is never a
 * permission, never a filesystem path, and never leaves this browser.
 *
 * Storage is `localStorage`, not the session-scoped draft store: membership must survive a tab
 * close, and a chat that loses its project on reload would be worse than not having one.
 */

export type Project = { id: string; name: string; createdAt: number };

/** Which project a chat belongs to. Absent means "no project". */
export type Membership = Record<string, string>;

export type ProjectStore = {
	projects: () => Project[];
	membership: () => Membership;
	create: (name: string) => Project | null;
	rename: (id: string, name: string) => boolean;
	remove: (id: string) => boolean;
	assign: (sessionId: string, projectId: string | null) => boolean;
	projectOf: (sessionId: string) => Project | null;
	sessionsIn: (projectId: string) => string[];
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

function storage(): Storage | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		// Private mode and blocked storage both throw on access.
		return undefined;
	}
}

function readJson<T>(key: string, fallback: T): T {
	try {
		const raw = storage()?.getItem(key);
		if (!raw || raw.length > 200_000) return fallback;
		const parsed: unknown = JSON.parse(raw);
		return parsed === null ? fallback : (parsed as T);
	} catch {
		return fallback;
	}
}

function writeJson(key: string, value: unknown): boolean {
	try {
		const target = storage();
		if (!target) return false;
		target.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		// Quota exhausted: the caller learns from the return value, nothing throws.
		return false;
	}
}

function newId(): string {
	return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Shape validation on read. Storage is user-writable and may be stale from an older version,
 * so anything that does not match is dropped rather than trusted.
 */
function parseProjects(value: unknown): Project[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const out: Project[] = [];
	for (const row of value) {
		if (!row || typeof row !== 'object') continue;
		const { id, name, createdAt } = row as Partial<Project>;
		if (typeof id !== 'string' || !id || seen.has(id)) continue;
		const clean = cleanName(name);
		if (!clean) continue;
		seen.add(id);
		out.push({ id, name: clean, createdAt: typeof createdAt === 'number' ? createdAt : 0 });
		if (out.length >= MAX_PROJECTS) break;
	}
	return out;
}

function parseMembership(value: unknown, projects: Project[]): Membership {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const known = new Set(projects.map((project) => project.id));
	const out: Membership = {};
	for (const [sessionId, projectId] of Object.entries(value as Record<string, unknown>)) {
		// A membership pointing at a deleted project is a leak, not a feature.
		if (typeof projectId === 'string' && known.has(projectId) && sessionId)
			out[sessionId] = projectId;
	}
	return out;
}

export function createProjectStore(): ProjectStore {
	function projects(): Project[] {
		return parseProjects(readJson<unknown>(PROJECTS_KEY, []));
	}
	function membership(): Membership {
		const rows = projects();
		return parseMembership(readJson<unknown>(MEMBERSHIP_KEY, {}), rows);
	}

	return {
		projects,
		membership,
		projectOf(sessionId) {
			const id = membership()[sessionId];
			return id ? (projects().find((project) => project.id === id) ?? null) : null;
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
			if (rows.length >= MAX_PROJECTS) return null;
			// Same name twice is allowed; the id is what identifies a project.
			const project: Project = { id: newId(), name: clean, createdAt: Date.now() };
			return writeJson(PROJECTS_KEY, [...rows, project]) ? project : null;
		},
		rename(id, name) {
			const clean = cleanName(name);
			if (!clean) return false;
			const rows = projects();
			if (!rows.some((project) => project.id === id)) return false;
			return writeJson(
				PROJECTS_KEY,
				rows.map((project) => (project.id === id ? { ...project, name: clean } : project))
			);
		},
		remove(id) {
			const rows = projects();
			if (!rows.some((project) => project.id === id)) return false;
			const remaining = rows.filter((project) => project.id !== id);
			// Drop the memberships first: an orphaned one would be filtered on read anyway, but
			// leaving it in storage would resurrect the chat if the id were ever reused.
			const next = membership();
			for (const [sessionId, projectId] of Object.entries(next))
				if (projectId === id) delete next[sessionId];
			return writeJson(PROJECTS_KEY, remaining) && writeJson(MEMBERSHIP_KEY, next);
		},
		assign(sessionId, projectId) {
			if (!sessionId) return false;
			const next = membership();
			if (projectId === null) delete next[sessionId];
			else {
				if (!projects().some((project) => project.id === projectId)) return false;
				next[sessionId] = projectId;
			}
			return writeJson(MEMBERSHIP_KEY, next);
		}
	};
}

export const projectStore = createProjectStore();

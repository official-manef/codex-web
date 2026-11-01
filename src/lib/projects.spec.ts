import { beforeEach, expect, test } from 'vitest';
import { MAX_NAME_CHARS, MAX_PROJECTS, cleanName, createProjectStore } from './projects';
import type { DraftStorage } from './draft_storage';

/**
 * Project membership is user-writable storage, so every read is a validation boundary. These
 * tests exist because the failure mode is silent: a stale or hand-edited value that is trusted
 * shows a chat inside a project that no longer exists, which reads as data loss.
 */

class Memory implements DraftStorage {
	private rows = new Map<string, string>();
	getItem(key: string) {
		return this.rows.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.rows.set(key, value);
	}
	removeItem(key: string) {
		this.rows.delete(key);
	}
	/** Direct handle for writing values the module itself would never write. */
	seed(key: string, value: string) {
		this.rows.set(key, value);
	}
}

let store: Memory;

beforeEach(() => {
	store = new Memory();
	Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
});

const PROJECTS_KEY = 'codex-web:projects:v1';
const MEMBERSHIP_KEY = 'codex-web:project-members:v1';

test('a created project is listed, and starts with no members', () => {
	const projects = createProjectStore();
	const created = projects.create('  Refund    flow  ');
	expect(created?.name).toBe('Refund flow');
	expect(projects.projects().map((project) => project.name)).toEqual(['Refund flow']);
	expect(projects.sessionsIn(created!.id)).toEqual([]);
});

test('names are trimmed, collapsed and bounded; junk is refused', () => {
	expect(cleanName('  a   b  ')).toBe('a b');
	expect(cleanName('')).toBeNull();
	expect(cleanName('   ')).toBeNull();
	expect(cleanName('x'.repeat(MAX_NAME_CHARS + 1))).toBeNull();
	expect(cleanName(42)).toBeNull();
	expect(cleanName(null)).toBeNull();
	expect(createProjectStore().create('')).toBeNull();
});

test('assign, reassign and unassign a chat', () => {
	const projects = createProjectStore();
	const a = projects.create('A')!;
	const b = projects.create('B')!;

	expect(projects.assign('session-1', a.id)).toBe(true);
	expect(projects.projectOf('session-1')?.name).toBe('A');
	expect(projects.sessionsIn(a.id)).toEqual(['session-1']);

	expect(projects.assign('session-1', b.id)).toBe(true);
	expect(projects.projectOf('session-1')?.name).toBe('B');
	expect(projects.sessionsIn(a.id)).toEqual([]);

	expect(projects.assign('session-1', null)).toBe(true);
	expect(projects.projectOf('session-1')).toBeNull();
});

test('assigning to a project that does not exist is refused, not silently stored', () => {
	const projects = createProjectStore();
	projects.create('A');
	expect(projects.assign('session-1', 'project-ghost')).toBe(false);
	expect(projects.projectOf('session-1')).toBeNull();
	expect(projects.assign('', 'project-ghost')).toBe(false);
});

test('removing a project drops its memberships instead of orphaning them', () => {
	const projects = createProjectStore();
	const a = projects.create('A')!;
	const b = projects.create('B')!;
	projects.assign('s1', a.id);
	projects.assign('s2', a.id);
	projects.assign('s3', b.id);

	expect(projects.remove(a.id)).toBe(true);
	expect(projects.projects().map((project) => project.name)).toEqual(['B']);
	expect(projects.projectOf('s1')).toBeNull();
	expect(projects.projectOf('s2')).toBeNull();
	expect(projects.projectOf('s3')?.name).toBe('B');
	// Re-adding a project with a fresh id must not resurrect the old chats.
	expect(projects.sessionsIn(a.id)).toEqual([]);
});

test('corrupt or hostile storage is dropped, not trusted', () => {
	store.seed(PROJECTS_KEY, 'not json at all');
	expect(createProjectStore().projects()).toEqual([]);

	store.seed(
		PROJECTS_KEY,
		JSON.stringify([
			{ id: 'ok', name: 'Good', createdAt: 1 },
			{ id: 'ok', name: 'Duplicate id', createdAt: 2 },
			{ id: '', name: 'No id', createdAt: 3 },
			{ id: 'blank', name: '   ', createdAt: 4 },
			{ id: 'huge', name: 'x'.repeat(MAX_NAME_CHARS + 1), createdAt: 5 },
			'not an object',
			null
		])
	);
	expect(createProjectStore().projects()).toEqual([{ id: 'ok', name: 'Good', createdAt: 1 }]);

	// A membership pointing at a project that is not in the list.
	store.seed(MEMBERSHIP_KEY, JSON.stringify({ s1: 'ok', s2: 'missing' }));
	const projects = createProjectStore();
	expect(projects.projectOf('s1')?.name).toBe('Good');
	expect(projects.projectOf('s2')).toBeNull();
});

test('a deleted project id in storage cannot leak back into the sidebar', () => {
	store.seed(PROJECTS_KEY, JSON.stringify([]));
	store.seed(MEMBERSHIP_KEY, JSON.stringify({ s1: 'project-deleted' }));
	expect(createProjectStore().membership()).toEqual({});
});

test('the project cap is enforced without dropping existing rows', () => {
	const projects = createProjectStore();
	for (let index = 0; index < MAX_PROJECTS; index += 1) {
		expect(projects.create(`P${index}`)).not.toBeNull();
	}
	expect(projects.create('one too many')).toBeNull();
	expect(projects.projects()).toHaveLength(MAX_PROJECTS);
});

test('storage that throws on write reports failure instead of exploding', () => {
	Object.defineProperty(globalThis, 'localStorage', {
		value: {
			getItem: () => null,
			setItem: () => {
				throw new Error('QuotaExceededError');
			},
			removeItem: () => {}
		},
		configurable: true
	});
	expect(createProjectStore().create('A')).toBeNull();
});

test('rename keeps membership intact and refuses a blank name', () => {
	const projects = createProjectStore();
	const a = projects.create('A')!;
	projects.assign('s1', a.id);
	expect(projects.rename(a.id, 'Renamed')).toBe(true);
	expect(projects.projectOf('s1')?.name).toBe('Renamed');
	expect(projects.rename(a.id, '   ')).toBe(false);
	expect(projects.rename('project-ghost', 'X')).toBe(false);
	expect(projects.projectOf('s1')?.name).toBe('Renamed');
});

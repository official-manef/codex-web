import type { Component } from 'svelte';

/** A lazily imported screen. `loadScreen` is what makes an entry navigable at all. */
export type ScreenLoader = () => Promise<{ default: Component<Record<string, unknown>> }>;

/**
 * Navigation and feature catalogue.
 *
 * Structure mirrors `rahmanef63/laya-npu`'s registry so the shell's own navigation behaves
 * identically; identity and outbound links are the template's. Every `loadScreen` points at
 * a lazily imported view, so the initial payload only carries the shell.
 *
 * Metadata only: registering a feature never grants authority, and the backend (when a
 * product adds one) enforces capability and approval independently.
 */

export type Backend = {
	id: string;
	device: string;
	label: string;
	kind: 'local' | 'byok';
	present: boolean;
	ready: boolean;
	reason: string | null;
	latency_ms: number | null;
	compile_s: number | null;
	description: string;
	url?: string | null;
	model?: string | null;
};

export const PROJECT = {
	name: 'workspace-template',
	displayName: 'Workspace Template',
	tagline: 'A configurable local workspace shell.',
	description: 'Svelte workspace shell with a consumer-owned chat surface and lazy views.',
	portal: '',
	author: '',
	repo: 'https://github.com/rahmanef63/codex-clone-placeholder',
	collaborators: ['rahmanef63']
} as const;

export const SECTIONS = [
	{ id: 'chat', label: 'Chat', icon: 'message', group: 'Workspace' },
	{
		id: 'manef',
		label: 'MANEF AI',
		icon: 'layers',
		group: 'Workspace',
		loadScreen: () => import('#lib/views/Manef.svelte')
	},
	{
		id: 'apps',
		label: 'Automation',
		icon: 'workflow',
		group: 'Workspace',
		loadScreen: () => import('#lib/views/Apps.svelte')
	},
	{
		id: 'transcribe',
		label: 'Transcribe',
		icon: 'mic',
		group: 'Workspace',
		loadScreen: () => import('#lib/views/Transcribe.svelte')
	},
	{
		id: 'models',
		label: 'Models & downloads',
		icon: 'layers',
		group: 'Workspace',
		placement: 'settings',
		loadScreen: () => import('#lib/views/Models.svelte')
	},
	{
		id: 'overview',
		label: 'Start here',
		icon: 'sparkles',
		group: 'Explore',
		navigationRole: 'explore',
		loadScreen: () => import('#lib/views/Overview.svelte')
	},
	{
		id: 'voice',
		label: 'Voice to action',
		icon: 'mic',
		group: 'Explore',
		navigationRole: 'explore',
		loadScreen: () => import('#lib/views/Voice.svelte')
	},
	{
		id: 'playground',
		label: 'Decision simulation',
		icon: 'play',
		group: 'Explore',
		navigationRole: 'explore',
		loadScreen: () => import('#lib/views/Playground.svelte')
	},
	{
		id: 'snake',
		label: 'Snake demo',
		icon: 'grid',
		group: 'Explore',
		navigationRole: 'explore',
		loadScreen: () => import('#lib/views/Snake.svelte')
	},
	{
		id: 'embeddings',
		label: 'Embedding search',
		icon: 'search',
		group: 'Explore',
		navigationRole: 'explore',
		loadScreen: () => import('#lib/views/Embeddings.svelte')
	},
	{
		id: 'setup',
		label: 'Setup check',
		icon: 'check',
		group: 'Settings & help',
		navigationRole: 'settings',
		loadScreen: () => import('#lib/views/Setup.svelte')
	},
	{
		id: 'backends',
		label: 'Compute & devices',
		icon: 'cpu',
		group: 'Settings & help',
		navigationRole: 'settings',
		loadScreen: () => import('#lib/views/Compute.svelte')
	},
	{
		id: 'providers',
		label: 'Providers',
		icon: 'server',
		group: 'Settings & help',
		navigationRole: 'settings',
		loadScreen: () => import('#lib/views/Providers.svelte')
	},
	{
		id: 'pricing',
		label: 'Costs',
		icon: 'tag',
		group: 'Settings & help',
		navigationRole: 'settings',
		loadScreen: () => import('#lib/views/Pricing.svelte')
	},
	{
		id: 'keys',
		label: 'Model keys',
		icon: 'shield',
		group: 'Settings & help',
		navigationRole: 'settings',
		// BYOK: the template's own surface, not a vendored Laya view. The view reads the Convex
		// session itself; the shell's fixed `screenProps` never carries `signedIn`.
		loadScreen: () => import('#lib/views/ModelKeys.svelte')
	},
	{
		id: 'faq',
		label: 'Help & limits',
		icon: 'help',
		group: 'Settings & help',
		navigationRole: 'settings',
		loadScreen: () => import('#lib/views/Faq.svelte')
	},
	{
		id: 'tools',
		label: 'Tools',
		icon: 'sliders',
		group: 'Settings & help',
		navigationRole: 'settings',
		loadScreen: () => import('#lib/views/ToolsSettings.svelte')
	},
	{
		id: 'devices',
		label: 'Devices & compute',
		icon: 'cpu',
		group: 'Settings & help',
		navigationRole: 'settings',
		loadScreen: () => import('#lib/views/Devices.svelte')
	}
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];
export const GROUPS = [...new Set(SECTIONS.map((section) => section.group))];

/** Display preferences only: capability and action authority remain server-side. */
export const LAUNCHER_CONFIG = {
	quick: ['files', 'browser'],
	suggested: ['apps', 'transcribe', 'files', 'browser'],
	recentLabel: 'Local workspace'
} as const;

/** Primary shortcuts; all remaining registered views stay available through menus. */
export const RAIL_VIEWS = ['chat', 'manef', 'apps', 'transcribe', 'files', 'browser'] as const;

export const CHAT_OUTPUTS = [
	{ id: 'chat-tools', label: 'Integrations', icon: 'workflow', placement: 'settings' },
	{ id: 'chat-settings', label: 'Chat settings', icon: 'sliders', placement: 'settings' },
	{ id: 'chat-session', label: 'Session', icon: 'message', placement: 'settings' },
	{ id: 'workspace-home', label: 'Tool launcher', icon: 'grid', placement: 'canvas' },
	{
		id: 'files',
		label: 'Files',
		icon: 'folder',
		placement: 'canvas',
		loadScreen: () => import('#lib/views/FileCanvas.svelte')
	},
	{
		id: 'browser',
		label: 'Browser',
		icon: 'globe',
		placement: 'canvas',
		loadScreen: () => import('#lib/views/BrowserCanvas.svelte')
	},
	{
		id: 'terminal',
		label: 'Terminal',
		icon: 'code',
		placement: 'canvas',
		loadScreen: () => import('#lib/views/Terminal.svelte')
	}
] as const;

export const WORKSPACE_VIEWS = [...SECTIONS, ...CHAT_OUTPUTS];

/** Every id the shell can navigate to. One list; nothing may hardcode a destination beside it. */
export const WORKSPACE_VIEW_IDS: ReadonlySet<string> = new Set(WORKSPACE_VIEWS.map((v) => v.id));

/**
 * `hasFeatureScreen`/`loadFeatureScreen` used to live here and were dead: the shell re-derives
 * both from the `sections`/`auxiliaryViews` props so it stays reusable by another consumer.
 * Kept as one predicate so a caller can ask the question without importing a component type.
 */
export function isWorkspaceView(id: string): boolean {
	return WORKSPACE_VIEW_IDS.has(id);
}

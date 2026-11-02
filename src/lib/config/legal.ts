// Public legal-identity constants. One place, so the three legal pages cannot disagree with
// each other or with the OAuth consent screen. Nothing secret belongs here.

export const legal = {
	/** The name a user sees on the consent screen and on every legal page. */
	appName: 'OS-AI-MANEF',
	/** What the product is, in one clause. Used in the first sentence of each policy. */
	tagline: 'open-source AI workspace from Manef',
	operator: 'Manef (official-manef)',
	/** Legal contact. Must be a mailbox that is actually read: Google verifies reachability. */
	contactEmail: 'official.manef@gmail.com',
	/** Public source, so "open source" in the name is checkable rather than a claim. */
	sourceUrl: 'https://github.com/official-manef/codex-web',
	appUrl: 'https://ai.manef.dev',
	jurisdiction: 'Republic of Indonesia',
	/** Shown on every page. A version bump is the honest signal that the text changed. */
	effectiveDate: '2026-11-02',
	license: 'MIT'
} as const;

export const routes = {
	privacy: '/privacy',
	terms: '/terms',
	home: '/'
} as const;

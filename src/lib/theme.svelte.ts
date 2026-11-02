/**
 * The theme the root element carries.
 *
 * `+layout.svelte` used to hardcode `class="dark"`, so the light palette in `layout.css` and the
 * `.dark` gate were both unreachable: "dark" was not a decision anyone had made, it was the only
 * state the markup allowed. Both palettes exist now, so the choice lives in module state that the
 * root and the View menu both read.
 *
 * `localStorage` because a theme is a preference, not a credential: it should survive a reload,
 * and it is the one thing here that safely may. Nothing touches storage at import time, so this
 * module is safe on the server; `syncTheme()` is what reads it, from the client only.
 */
const THEME_KEY = 'codex-web:theme';

export type Theme = 'light' | 'dark';

let theme = $state<Theme>('dark');

/** The stored preference, or the OS preference when nothing is stored or storage is blocked. */
function preferred(): Theme {
	try {
		const stored = localStorage.getItem(THEME_KEY);
		if (stored === 'light' || stored === 'dark') return stored;
	} catch {
		// Private mode: fall through to the OS preference.
	}
	try {
		return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
	} catch {
		return 'dark';
	}
}

/** Read the stored preference once the client is live. Callers guard on `browser`. */
export function syncTheme(): void {
	theme = preferred();
}

export function setTheme(next: Theme): void {
	theme = next;
	try {
		localStorage.setItem(THEME_KEY, next);
	} catch {
		// The class still changes; it just will not persist.
	}
}

export function toggleTheme(): void {
	setTheme(theme === 'dark' ? 'light' : 'dark');
}

export function currentTheme(): Theme {
	return theme;
}

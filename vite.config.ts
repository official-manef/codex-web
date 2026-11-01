import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { readLocalDeployment } from './scripts/convex-local.mjs';

// Convex ports are per project, so the port this checkout owns is read from its own
// `.convex/local/default/config.json` once, here, instead of being hardcoded in the spec. A
// literal like 3210 is not merely fragile: on a machine running a second Convex project it is
// that project's backend, and the auth spec would then be measuring a stranger's boundary.
// An explicit `CONVEX_URL` in the environment still wins.
const local = readLocalDeployment();
if (local && !process.env.CONVEX_URL) process.env.CONVEX_URL = local.url;

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// SvelteKit merges its own allowlist; root feature slices also need client dev access.
	server: { fs: { allow: ['slices', 'shared'] } },
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					// The typed-ESLint specs boot a full project service; 5s is not enough once
					// `slices/**` grew. 30s keeps the suite honest without hiding hangs.
					testTimeout: 30_000,
					include: ['src/**/*.{test,spec}.{js,ts}', 'slices/**/*.{test,spec}.{js,ts}'],
					exclude: ['**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});

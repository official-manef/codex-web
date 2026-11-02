import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4197);
const baseURL = `http://127.0.0.1:${port}`;
export const devServerCommand = `bun run dev -- --host 127.0.0.1 --port ${port} --strictPort`;

/**
 * Bounded on purpose, and bounded HERE rather than on a command line, so `bin/gate` and
 * `.github/workflows/ci.yml` run the same count without either of them remembering a flag.
 *
 * Unbounded, `playwright test` uses one worker per CPU. Measured 2026-11-02 on a 16-core host:
 * the default count tears down `webServer` while other workers are still navigating and 77
 * tests fail with `net::ERR_CONNECTION_REFUSED` against a server that was already stopped —
 * a green suite reported as red. Two workers passed; one passed and was slower.
 *
 * The CI runner is not that host, but it is the same class of problem: the count silently
 * follows whatever CPU count the runner happens to have, so a suite that passes on a 2-core
 * runner and fails on a 4-core one looks like a code change. Pinning it makes the number a
 * property of the repo instead of a property of the machine.
 */
const workers = Number(process.env.PLAYWRIGHT_WORKERS ?? 2);

export default defineConfig({
	workers,
	testMatch: '**/*.e2e.{ts,js}',
	webServer: {
		env: {
			AUTH_ENABLED: 'false',
			AI_ENABLED: 'false',
			MCP_CLIENT_ENABLED: 'false',
			MCP_SERVER_ENABLED: 'false',
			PUBLIC_CONVEX_URL: '',
			PUBLIC_SITE_URL: 'https://starter.example',
			PUBLIC_SEO_INDEXABLE: 'true',
			PUBLIC_GOOGLE_SITE_VERIFICATION: 'google-test-token',
			PUBLIC_BING_SITE_VERIFICATION: 'BING_TEST_TOKEN',
			PUBLIC_TWITTER_SITE: '@starter'
		},
		command: `bun run build && bun run preview -- --host 127.0.0.1 --port ${port}`,
		url: baseURL,
		// A cold `vite build` on this repo takes over a minute; the 60s default made the whole
		// suite fail with "Timed out waiting from config.webServer" instead of running. A CI
		// runner is slower than this host and starts with a cold filesystem, so the ceiling is
		// generous and overridable rather than tuned to the laptop that measured it.
		timeout: Number(process.env.PLAYWRIGHT_WEBSERVER_TIMEOUT ?? 300_000),
		reuseExistingServer: false
	},
	use: {
		baseURL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		launchOptions: process.env.PLAYWRIGHT_CHROME_PATH
			? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
			: undefined
	},
	projects: [
		{ name: 'narrow-mobile', use: { ...devices['iPhone SE'], browserName: 'chromium' } },
		{ name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
		{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }
	]
});

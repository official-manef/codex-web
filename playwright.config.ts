import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4197);
const baseURL = `http://127.0.0.1:${port}`;
export const devServerCommand = `bun run dev -- --host 127.0.0.1 --port ${port} --strictPort`;

export default defineConfig({
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
		timeout: 180_000,
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

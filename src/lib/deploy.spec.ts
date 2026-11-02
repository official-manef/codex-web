import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('deployment checks reject wrong keys before any command runs', () => {
	for (const [environment, key, allowed] of [
		['preview', 'prod:example', false],
		['preview', 'dev:example', false],
		['preview', 'preview:example', true],
		['production', 'preview:example', false],
		['production', 'prod:example', true],
		['production', '', false]
	] as const) {
		const result = spawnSync(process.execPath, ['scripts/deploy.mjs', '--dry-run'], {
			encoding: 'utf8',
			env: { ...process.env, VERCEL_ENV: environment, CONVEX_DEPLOY_KEY: key }
		});
		expect(result.status === 0).toBe(allowed);
		if (allowed) {
			expect(result.stdout.split('\n')[0]).toBe('bash bin/gate');
			expect(result.stdout).toContain('--cmd-url-env-var-name PUBLIC_CONVEX_URL');
		} else expect(result.stdout).toBe('');
		expect(result.stdout + result.stderr).not.toContain('example');
	}
});

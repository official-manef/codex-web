import { beforeEach, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { GET as callback } from '../../../routes/auth/callback/+server';
import { authConfiguration, saveTransaction } from './session';

const { privateEnv, publicEnv } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' }
}));
vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));

beforeEach(() => {
	Object.assign(privateEnv, {
		AUTH_ENABLED: 'true',
		AUTH_CLIENT_ID: 'test-client',
		AUTH_CLIENT_SECRET: 'test-secret',
		AUTH_SESSION_SECRET: Buffer.alloc(32, 7).toString('base64url')
	});
});

test('a cross-origin callback does not consume the pending transaction', async () => {
	const values = new Map<string, string>();
	const event = {
		url: new URL('https://attacker.example/auth/callback?code=x&state=y'),
		request: new Request('https://attacker.example/auth/callback'),
		setHeaders: vi.fn(),
		cookies: {
			get: (n: string) => values.get(n),
			set: (n: string, v: string) => values.set(n, v),
			delete: (n: string) => void values.delete(n)
		}
	} as unknown as RequestEvent<Record<string, never>, '/auth/callback'>;
	const config = authConfiguration();
	if (!config.enabled) throw new Error('disabled');
	await saveTransaction(event, config, {
		verifier: 'v'.repeat(43),
		state: 's'.repeat(32),
		nonce: 'n'.repeat(32)
	});
	expect(values.has('__Host-starter-transaction')).toBe(true);
	await expect(callback(event)).rejects.toMatchObject({ status: 400 });
	expect(values.has('__Host-starter-transaction')).toBe(true);
});

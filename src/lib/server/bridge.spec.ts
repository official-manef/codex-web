import { describe, expect, test, vi } from 'vitest';
import { bridgeAvailable, createBridgeClient, type BridgeEnv } from './bridge';

describe('bridgeAvailable', () => {
	test('accepts http loopback and lan endpoints with valid tokens', () => {
		expect(
			bridgeAvailable({ BRIDGE_URL: 'http://127.0.0.1:8649', BRIDGE_TOKEN: 'secret-token' })
		).toBe(true);
		expect(
			bridgeAvailable({ BRIDGE_URL: 'http://localhost:8649', BRIDGE_TOKEN: 'secret-token' })
		).toBe(true);
		expect(
			bridgeAvailable({ BRIDGE_URL: 'http://192.168.1.10:8649', BRIDGE_TOKEN: 'secret-token' })
		).toBe(true);
	});

	test('refuses plain http on public endpoints', () => {
		expect(
			bridgeAvailable({ BRIDGE_URL: 'http://example.com:8649', BRIDGE_TOKEN: 'secret-token' })
		).toBe(false);
	});

	test('accepts https endpoints', () => {
		expect(
			bridgeAvailable({ BRIDGE_URL: 'https://example.com:8649', BRIDGE_TOKEN: 'secret-token' })
		).toBe(true);
		expect(
			bridgeAvailable({ BRIDGE_URL: 'https://127.0.0.1:8649', BRIDGE_TOKEN: 'secret-token' })
		).toBe(true);
	});

	test('refuses endpoints with credentials', () => {
		expect(
			bridgeAvailable({
				BRIDGE_URL: 'http://user:pass@127.0.0.1:8649',
				BRIDGE_TOKEN: 'secret-token'
			})
		).toBe(false);
		expect(
			bridgeAvailable({
				BRIDGE_URL: 'https://user:pass@example.com',
				BRIDGE_TOKEN: 'secret-token'
			})
		).toBe(false);
	});

	test('refuses endpoints with query strings', () => {
		expect(
			bridgeAvailable({
				BRIDGE_URL: 'http://127.0.0.1:8649?token=leak',
				BRIDGE_TOKEN: 'secret-token'
			})
		).toBe(false);
		expect(
			bridgeAvailable({
				BRIDGE_URL: 'https://example.com/v1?token=leak',
				BRIDGE_TOKEN: 'secret-token'
			})
		).toBe(false);
	});

	test('refuses missing or empty environment values', () => {
		expect(bridgeAvailable({})).toBe(false);
		expect(bridgeAvailable({ BRIDGE_URL: 'http://127.0.0.1:8649' })).toBe(false);
		expect(bridgeAvailable({ BRIDGE_TOKEN: 'secret-token' })).toBe(false);
		expect(bridgeAvailable({ BRIDGE_URL: '', BRIDGE_TOKEN: 'secret-token' })).toBe(false);
		expect(bridgeAvailable({ BRIDGE_URL: 'http://127.0.0.1:8649', BRIDGE_TOKEN: '' })).toBe(false);
		expect(bridgeAvailable({ BRIDGE_URL: 'http://127.0.0.1:8649', BRIDGE_TOKEN: '   ' })).toBe(
			false
		);
	});
});

describe('createBridgeClient', () => {
	const validEnv: BridgeEnv = {
		BRIDGE_URL: 'http://127.0.0.1:8649',
		BRIDGE_TOKEN: 'super-secret-pairing-token-xyz'
	};

	test('throws at construction on invalid environment', () => {
		expect(() => createBridgeClient({})).toThrow('bridge environment invalid');
		expect(() =>
			createBridgeClient({ BRIDGE_URL: 'http://example.com', BRIDGE_TOKEN: 'token' })
		).toThrow('bridge environment invalid');
	});

	test('sends Authorization header equaling Bearer <token>', async () => {
		let capturedHeaders: HeadersInit | undefined;
		const fakeFetcher: typeof fetch = vi.fn().mockImplementation(async (_url, init) => {
			capturedHeaders = init?.headers;
			return new Response(JSON.stringify({ code: 0, stdout: 'ok' }), { status: 200 });
		});

		const client = createBridgeClient(validEnv, fakeFetcher);
		await client.exec(['whoami']);

		const auth =
			capturedHeaders instanceof Headers
				? capturedHeaders.get('Authorization')
				: (capturedHeaders as Record<string, string>)?.['Authorization'];

		expect(auth).toBe('Bearer super-secret-pairing-token-xyz');
	});

	test('never leaks the token in a thrown error message', async () => {
		const token = 'leakable-secret-token-12345';
		const env: BridgeEnv = {
			BRIDGE_URL: 'http://127.0.0.1:8649',
			BRIDGE_TOKEN: token
		};

		// 1. 500 response
		const fail500Fetcher: typeof fetch = vi
			.fn()
			.mockResolvedValue(new Response(`internal failure with token ${token}`, { status: 500 }));
		const client500 = createBridgeClient(env, fail500Fetcher);
		await expect(client500.exec(['ls'])).rejects.toSatisfy((err: Error) => {
			return !err.message.includes(token);
		});

		// 2. Fetch throwing error containing token
		const throwTokenFetcher: typeof fetch = vi
			.fn()
			.mockRejectedValue(new Error(`Connection failed to ${token}@127.0.0.1:8649`));
		const clientThrow = createBridgeClient(env, throwTokenFetcher);
		await expect(clientThrow.readFile('/test')).rejects.toSatisfy((err: Error) => {
			return !err.message.includes(token);
		});

		// 3. Oversized response
		const bigBodyFetcher: typeof fetch = vi
			.fn()
			.mockResolvedValue(new Response('a'.repeat(1_000_001), { status: 200 }));
		const clientBig = createBridgeClient(env, bigBodyFetcher);
		await expect(clientBig.readFile('/big')).rejects.toSatisfy((err: Error) => {
			return !err.message.includes(token);
		});

		// 4. Invalid argv
		await expect(client500.exec([])).rejects.toSatisfy((err: Error) => {
			return !err.message.includes(token);
		});
	});

	test('throws the fixed string on non-2xx responses', async () => {
		const error500Fetcher: typeof fetch = vi
			.fn()
			.mockResolvedValue(new Response('Server Error', { status: 500 }));
		const client = createBridgeClient(validEnv, error500Fetcher);

		await expect(client.exec(['ls'])).rejects.toThrow('bridge exec failed');
		await expect(client.readFile('/etc/hosts')).rejects.toThrow('bridge read failed');
		await expect(client.writeFile('/tmp/foo', 'data')).rejects.toThrow('bridge write failed');
	});

	test('refuses an oversized response body', async () => {
		// via content-length
		const oversizedHeaderFetcher: typeof fetch = vi.fn().mockResolvedValue(
			new Response('small', {
				status: 200,
				headers: { 'content-length': '1000001' }
			})
		);
		const client1 = createBridgeClient(validEnv, oversizedHeaderFetcher);
		await expect(client1.readFile('/path')).rejects.toThrow('bridge response too large');

		// via body text size
		const oversizedBodyFetcher: typeof fetch = vi
			.fn()
			.mockResolvedValue(new Response('b'.repeat(1_000_001), { status: 200 }));
		const client2 = createBridgeClient(validEnv, oversizedBodyFetcher);
		await expect(client2.readFile('/path')).rejects.toThrow('bridge response too large');
	});

	test('refuses invalid argv before fetch is called', async () => {
		const fakeFetcher: typeof fetch = vi.fn();
		const client = createBridgeClient(validEnv, fakeFetcher);

		// empty array
		await expect(client.exec([])).rejects.toThrow();
		// more than 32 entries
		await expect(client.exec(Array.from({ length: 33 }, (_, i) => `arg${i}`))).rejects.toThrow();
		// entry > 200 chars
		await expect(client.exec(['a'.repeat(201)])).rejects.toThrow();
		// entry with NUL
		await expect(client.exec(['arg\0bad'])).rejects.toThrow();

		expect(fakeFetcher).not.toHaveBeenCalled();
	});

	test('refuses invalid path before fetch is called', async () => {
		const fakeFetcher: typeof fetch = vi.fn();
		const client = createBridgeClient(validEnv, fakeFetcher);

		// empty path
		await expect(client.readFile('')).rejects.toThrow();
		await expect(client.writeFile('', 'content')).rejects.toThrow();
		// path > 500 chars
		await expect(client.readFile('a'.repeat(501))).rejects.toThrow();
		await expect(client.writeFile('a'.repeat(501), 'content')).rejects.toThrow();
		// path with NUL
		await expect(client.readFile('/home/\0/file')).rejects.toThrow();
		await expect(client.writeFile('/home/\0/file', 'content')).rejects.toThrow();

		expect(fakeFetcher).not.toHaveBeenCalled();
	});

	test('refuses oversized writeFile text before fetch is called', async () => {
		const fakeFetcher: typeof fetch = vi.fn();
		const client = createBridgeClient(validEnv, fakeFetcher);

		await expect(client.writeFile('/tmp/ok.txt', 'x'.repeat(200_001))).rejects.toThrow();
		expect(fakeFetcher).not.toHaveBeenCalled();
	});

	test('timeout uses an abort signal and redirect is error', async () => {
		let capturedInit: RequestInit | undefined;
		const fakeFetcher: typeof fetch = vi.fn().mockImplementation(async (_url, init) => {
			capturedInit = init;
			return new Response(JSON.stringify({ code: 0, stdout: 'ok' }), { status: 200 });
		});

		const client = createBridgeClient(validEnv, fakeFetcher);
		await client.exec(['git', 'status']);

		expect(capturedInit?.signal).toBeDefined();
		expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
		expect(capturedInit?.redirect).toBe('error');
	});

	test('writeFile sends {path, text} and nothing else', async () => {
		let capturedBody: string | undefined;
		const fakeFetcher: typeof fetch = vi.fn().mockImplementation(async (_url, init) => {
			capturedBody = init?.body as string;
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		});

		const client = createBridgeClient(validEnv, fakeFetcher);
		await client.writeFile('/var/log/app.log', 'line 1\nline 2');

		expect(capturedBody).toBeDefined();
		const parsed = JSON.parse(capturedBody!);
		expect(parsed).toEqual({ path: '/var/log/app.log', text: 'line 1\nline 2' });
		expect(Object.keys(parsed)).toEqual(['path', 'text']);
	});

	test('exec and readFile parse valid responses properly', async () => {
		const fakeFetcher: typeof fetch = vi.fn().mockImplementation(async (url) => {
			if (String(url).endsWith('/v1/exec')) {
				return new Response(JSON.stringify({ code: 0, stdout: 'hello from bridge' }), {
					status: 200
				});
			}
			if (String(url).endsWith('/v1/fs/read')) {
				return new Response(JSON.stringify({ text: 'contents of file' }), { status: 200 });
			}
			return new Response('Not found', { status: 404 });
		});

		const client = createBridgeClient(validEnv, fakeFetcher);
		const execRes = await client.exec(['echo', 'hello']);
		expect(execRes).toEqual({ code: 0, stdout: 'hello from bridge' });

		const readRes = await client.readFile('/etc/issue');
		expect(readRes).toBe('contents of file');
	});
});

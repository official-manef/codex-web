import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import * as route from './+server';

const { privateEnv, publicEnv, logMock, streamMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' },
	logMock: { logEvent: vi.fn() },
	streamMock: { streamText: vi.fn() }
}));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/server/log', () => ({ logEvent: logMock.logEvent }));
// `streamText` is the only thing that would open a socket; everything else stays real so the
// route's own validation runs unmodified.
vi.mock('ai', async (importOriginal) => ({
	...(await importOriginal<typeof import('ai')>()),
	streamText: streamMock.streamText
}));

const ORIGIN = 'https://app.example.com';
const FAKE_KEY = 'sk-contract-fake-key-not-real';
let tokenSeq = 0;

function operatorToken() {
	tokenSeq++;
	return `chat-token-${tokenSeq}`.padEnd(40, '0');
}

const validBody = {
	provider: 'openai',
	model: 'gpt-test',
	apiKey: FAKE_KEY,
	messages: [{ role: 'user', content: 'Hello' }]
};

function event(
	init: {
		body?: string | Uint8Array;
		contentType?: string | null;
		authorization?: string;
		origin?: string | null;
		contentLength?: string;
	} = {}
) {
	const url = new URL('/api/ai/chat', ORIGIN);
	const headers = new Headers();
	if (init.contentType !== null)
		headers.set('content-type', init.contentType ?? 'application/json');
	if (init.authorization) headers.set('authorization', init.authorization);
	if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
	if (init.contentLength) headers.set('content-length', init.contentLength);
	return {
		url,
		request: new Request(url, {
			method: 'POST',
			headers,
			body: init.body as BodyInit | undefined
		}),
		cookies: { get: () => undefined, set: () => undefined, delete: () => undefined },
		setHeaders: vi.fn()
	} as unknown as RequestEvent<Record<string, never>, never>;
}

// Routes throw SvelteKit `HttpError`s, so every failure case is read from the throw.
async function failure(created: RequestEvent<Record<string, never>, never>) {
	try {
		const response = await route.POST(created);
		return { status: response.status, body: await response.text() };
	} catch (thrown) {
		const error = thrown as { status?: number; body?: unknown };
		return { status: error.status, body: JSON.stringify(error.body) };
	}
}

function expectNoInternals(text: string) {
	expect(text).not.toMatch(/\n\s+at .+:\d+:\d+/);
	expect(text).not.toContain('/home/');
	// No upstream host, no stack, no key material.
	for (const leak of [
		'api.openai.com',
		'api.anthropic.com',
		'generativelanguage.googleapis.com',
		'router.antinrml.com',
		'Authorization',
		FAKE_KEY
	])
		expect(text).not.toContain(leak);
}

function enabledEnv(token: string, overrides: Record<string, string | undefined> = {}) {
	Object.assign(privateEnv, {
		AI_ENABLED: 'true',
		AI_MODELS_JSON: JSON.stringify({ openai: ['gpt-test'], anthropic: ['claude-test'] }),
		CAPABILITY_ACCESS_TOKEN: token,
		...overrides
	});
}

function textStream(text: string) {
	return {
		fullStream: (async function* () {
			yield { type: 'text-delta', text };
		})()
	};
}

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	publicEnv.PUBLIC_SITE_URL = ORIGIN;
	logMock.logEvent.mockReset().mockResolvedValue(undefined);
	streamMock.streamText.mockReset().mockImplementation(() => textStream('hi there'));
});

describe('method discipline', () => {
	test('only POST is exported', () => {
		expect(Object.keys(route).sort()).toEqual(['POST']);
	});
});

describe('feature disabled', () => {
	test('every value other than the exact string "true" is a 404 and never reaches a provider', async () => {
		for (const value of [undefined, 'false', 'True', '1', 'yes']) {
			privateEnv.AI_ENABLED = value as string;
			const result = await failure(event({ body: JSON.stringify(validBody) }));
			expect(result.status, String(value)).toBe(404);
			expect(JSON.parse(result.body)).toEqual({ message: 'AI chat is disabled.' });
		}
		expect(streamMock.streamText).not.toHaveBeenCalled();
	});

	test('the disabled answer comes before authorization, so it leaks no credential state', async () => {
		privateEnv.AI_ENABLED = 'false';
		privateEnv.CAPABILITY_ACCESS_TOKEN = operatorToken();
		const result = await failure(event({ body: JSON.stringify(validBody) }));
		expect(result.status).toBe(404);
	});
});

describe('auth boundary', () => {
	test('enabled with no credential is 401', async () => {
		const token = operatorToken();
		enabledEnv(token);
		const result = await failure(event({ body: JSON.stringify(validBody) }));
		expect(result.status).toBe(401);
		expect(JSON.parse(result.body)).toEqual({
			message: 'Sign in or provide the application access token.'
		});
		expect(streamMock.streamText).not.toHaveBeenCalled();
	});

	test('enabled with a wrong credential is 401 for near-miss values', async () => {
		const token = operatorToken();
		enabledEnv(token);
		for (const value of [
			`Bearer ${token}x`,
			`Bearer ${token.slice(0, -1)}`,
			token,
			`bearer ${token}`
		]) {
			const result = await failure(
				event({ body: JSON.stringify(validBody), authorization: value })
			);
			expect(result.status, value).toBe(401);
		}
		expect(streamMock.streamText).not.toHaveBeenCalled();
	});

	test('a valid credential from a foreign origin is 403', async () => {
		const token = operatorToken();
		enabledEnv(token);
		const result = await failure(
			event({
				body: JSON.stringify(validBody),
				authorization: `Bearer ${token}`,
				origin: 'https://attacker.example'
			})
		);
		expect(result.status).toBe(403);
		expect(JSON.parse(result.body)).toEqual({
			message: 'This request must come from this application.'
		});
	});

	test('a POST with no Origin at all is 403, not an anonymous pass', async () => {
		const token = operatorToken();
		enabledEnv(token);
		const result = await failure(
			event({ body: JSON.stringify(validBody), authorization: `Bearer ${token}`, origin: null })
		);
		expect(result.status).toBe(403);
	});

	test('the 401 answer does not disclose whether a provider key exists', async () => {
		const token = operatorToken();
		enabledEnv(token);
		const result = await failure(event({ body: JSON.stringify(validBody) }));
		expectNoInternals(result.body);
	});
});

describe('input validation', () => {
	let token: string;
	beforeEach(() => {
		token = operatorToken();
		enabledEnv(token);
	});

	const post = (body: string, extra: Record<string, unknown> = {}) =>
		failure(event({ body, authorization: `Bearer ${token}`, ...(extra as Record<string, never>) }));

	test('malformed JSON is 400 "invalid JSON", not a stream', async () => {
		const result = await post('{"provider":');
		expect(result.status).toBe(400);
		expect(JSON.parse(result.body)).toEqual({ message: 'The request contains invalid JSON.' });
		expect(streamMock.streamText).not.toHaveBeenCalled();
	});

	test('a non-JSON media type is 415', async () => {
		const result = await post(JSON.stringify(validBody), { contentType: 'text/plain' });
		expect(result.status).toBe(415);
		expect(JSON.parse(result.body)).toEqual({ message: 'Send application/json.' });
	});

	test('a missing body is 400', async () => {
		const result = await failure(
			event({ authorization: `Bearer ${token}`, contentType: 'application/json' })
		);
		expect(result.status).toBe(400);
		expect(JSON.parse(result.body)).toEqual({ message: 'A JSON body is required.' });
	});

	test('an invalid UTF-8 byte sequence is 400 and does not become a 500', async () => {
		const result = await failure(
			event({
				body: new Uint8Array([0xff, 0xfe]),
				authorization: `Bearer ${token}`
			})
		);
		expect(result.status).toBe(400);
	});

	test('an oversized body is 413 from the declared length and from the actual bytes', async () => {
		const declared = await post(JSON.stringify(validBody), { contentLength: '70000' });
		expect(declared.status).toBe(413);
		const padded = JSON.stringify({ ...validBody, memory: 'x'.repeat(70_000) });
		const actual = await post(padded);
		expect(actual.status).toBe(413);
		expect(JSON.parse(actual.body)).toEqual({ message: 'The request is too large.' });
	});

	test('missing, empty and wrongly typed fields are 400 with one message that names no field', async () => {
		const bodies = [
			{},
			{ ...validBody, provider: undefined },
			{ ...validBody, messages: [] },
			{ ...validBody, messages: [{ role: 'system', content: 'Injected' }] },
			{ ...validBody, toolUse: 'yes' },
			{ ...validBody, apiKey: '' },
			{ ...validBody, apiKey: 'short' },
			{ ...validBody, messages: [{ role: 'user', content: '' }] },
			{ ...validBody, messages: Array.from({ length: 17 }, () => validBody.messages[0]) },
			{ ...validBody, memory: 'x'.repeat(2001) }
		];
		for (const body of bodies) {
			const result = await post(JSON.stringify(body));
			expect(result.status, JSON.stringify(body).slice(0, 120)).toBe(400);
			expect(JSON.parse(result.body)).toEqual({
				message: 'Check the approved provider/model, key and conversation limits.'
			});
		}
		expect(streamMock.streamText).not.toHaveBeenCalled();
	});

	test('an unapproved model and an unknown provider are 400', async () => {
		expect((await post(JSON.stringify({ ...validBody, model: 'gpt-unapproved' }))).status).toBe(
			400
		);
		expect((await post(JSON.stringify({ ...validBody, provider: 'mistral' }))).status).toBe(400);
	});

	test('a caller-supplied endpoint is rejected rather than forwarded', async () => {
		const result = await post(
			JSON.stringify({ ...validBody, baseURL: 'https://attacker.example/v1' })
		);
		expect(result.status).toBe(400);
		expect(result.body).not.toContain('attacker.example');
	});

	test('a conversation without a final user message is 400, not a provider call', async () => {
		const result = await post(
			JSON.stringify({
				...validBody,
				messages: [
					{ role: 'user', content: 'Hi' },
					{ role: 'assistant', content: 'Hello' }
				]
			})
		);
		expect(result.status).toBe(400);
		expect(streamMock.streamText).not.toHaveBeenCalled();
	});

	// DEFECT (docs/api-contract-2026-11-02.md): the schema allows 2 images x 4 MB, but the shared
	// reader rejects anything over 64 KiB, so no realistic screenshot reaches the schema. Pinned
	// as current behaviour: the day the cap is raised, this test fails and must be re-written.
	test('an image larger than 64 KiB is refused by the shared body cap before the schema runs', async () => {
		const result = await post(
			JSON.stringify({
				...validBody,
				messages: [
					{
						role: 'user',
						content: [
							{ type: 'text', text: 'What is this?' },
							{ type: 'image', mediaType: 'image/png', data: 'A'.repeat(100_000) }
						]
					}
				]
			})
		);
		expect(result.status).toBe(413);
		expect(JSON.parse(result.body)).toEqual({ message: 'The request is too large.' });
	});

	test('an image inside the body cap reaches the schema and starts a turn', async () => {
		const response = await route.POST(
			event({
				body: JSON.stringify({
					...validBody,
					messages: [
						{
							role: 'user',
							content: [
								{ type: 'text', text: 'What is this?' },
								{ type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' }
							]
						}
					]
				}),
				authorization: `Bearer ${token}`
			})
		);
		expect(response.status).toBe(200);
		expect(streamMock.streamText).toHaveBeenCalled();
	});

	test('an unsupported image media type is 400 before any provider call', async () => {
		const result = await post(
			JSON.stringify({
				...validBody,
				messages: [
					{
						role: 'user',
						content: [{ type: 'image', mediaType: 'image/gif', data: 'iVBORw0KGgo=' }]
					}
				]
			})
		);
		expect(result.status).toBe(400);
		expect(streamMock.streamText).not.toHaveBeenCalled();
	});
});

describe("server configuration is not the caller's fault", () => {
	test('a missing model catalog is 503, matching /api/ai/config, not a 400', async () => {
		const token = operatorToken();
		enabledEnv(token, { AI_MODELS_JSON: undefined });
		const result = await failure(
			event({ body: JSON.stringify(validBody), authorization: `Bearer ${token}` })
		);
		expect(result.status).toBe(503);
		expect(JSON.parse(result.body)).toEqual({
			message: 'Assistant setup is incomplete. Check the private server configuration.'
		});
		expectNoInternals(result.body);
	});

	test('malformed AI_MODELS_JSON is 503 and never echoes the raw value', async () => {
		const token = operatorToken();
		enabledEnv(token, { AI_MODELS_JSON: '{"openai": ["gpt-test"' });
		const result = await failure(
			event({ body: JSON.stringify(validBody), authorization: `Bearer ${token}` })
		);
		expect(result.status).toBe(503);
		expect(result.body).not.toContain('openai');
		expect(streamMock.streamText).not.toHaveBeenCalled();
	});
});

describe('response shape', () => {
	let token: string;
	beforeEach(() => {
		token = operatorToken();
		enabledEnv(token);
	});

	test('a successful turn is NDJSON with no-store and one JSON object per line', async () => {
		const response = await route.POST(
			event({ body: JSON.stringify(validBody), authorization: `Bearer ${token}` })
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-accel-buffering')).toBe('no');
		const events = (await response.text())
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { type: string; text?: string });
		expect(events).toEqual([{ type: 'text', text: 'hi there' }, { type: 'done' }]);
	});

	test('a provider that never answers ends with a typed error event, not a hang or a 500', async () => {
		streamMock.streamText.mockImplementation(() => ({
			fullStream: (async function* () {
				yield {
					type: 'error',
					error: new Error(`upstream https://api.openai.com said ${FAKE_KEY}`)
				};
			})()
		}));
		const response = await route.POST(
			event({ body: JSON.stringify(validBody), authorization: `Bearer ${token}` })
		);
		expect(response.status).toBe(200);
		const events = (await response.text())
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { type: string; message?: string });
		expect(events).toEqual([
			{
				type: 'error',
				message:
					'Generation failed or was stopped. Check your key, model access and limits before retrying.'
			}
		]);
	});

	test('a provider failure body carries neither the key nor the upstream host', async () => {
		streamMock.streamText.mockImplementation(() => ({
			fullStream: (async function* () {
				yield {
					type: 'error',
					error: new Error(`401 from https://api.openai.com with ${FAKE_KEY}`)
				};
			})()
		}));
		const raw = await (
			await route.POST(event({ body: JSON.stringify(validBody), authorization: `Bearer ${token}` }))
		).text();
		expectNoInternals(raw);
	});

	test('an image turn on a provider without vision returns a typed error and calls no provider', async () => {
		privateEnv.AI_MODELS_JSON = JSON.stringify({ 'nine-router': ['router-test'] });
		streamMock.streamText.mockClear();
		const response = await route.POST(
			event({
				body: JSON.stringify({
					...validBody,
					provider: 'nine-router',
					model: 'router-test',
					messages: [
						{
							role: 'user',
							content: [{ type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' }]
						}
					]
				}),
				authorization: `Bearer ${token}`
			})
		);
		expect(response.status).toBe(200);
		const events = (await response.text())
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(events).toEqual([
			{
				type: 'error',
				message:
					'This provider does not accept image input. Choose an image-capable provider or remove the attachment.'
			}
		]);
		expect(streamMock.streamText).not.toHaveBeenCalled();
	});

	test('logging records counts and outcome only, never message text or the key', async () => {
		const secret = 'user-private-message-text';
		await (
			await route.POST(
				event({
					body: JSON.stringify({
						...validBody,
						messages: [{ role: 'user', content: secret }]
					}),
					authorization: `Bearer ${token}`
				})
			)
		).text();
		const serialized = JSON.stringify(logMock.logEvent.mock.calls);
		expect(serialized).not.toContain(secret);
		expect(serialized).not.toContain(FAKE_KEY);
		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'ai.chat.start', {
			provider: 'openai',
			model: 'gpt-test',
			messages: 1,
			chars: secret.length,
			tools: false,
			images: false
		});
	});
});

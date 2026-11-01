import { beforeEach, describe, expect, test, vi } from 'vitest';
import { POST } from './+server';

const { privateEnv, publicEnv, logMock, chatMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string>,
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' },
	logMock: { logEvent: vi.fn() },
	chatMock: { chatResponse: vi.fn() }
}));

type Ev = Parameters<typeof POST>[0];

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$lib/server/log', () => ({ logEvent: logMock.logEvent }));
vi.mock('$lib/server/ai/chat', () => ({ chatResponse: chatMock.chatResponse }));

const token = 'z'.repeat(32);

function makeEvent(
	body: unknown,
	{ authorization = token, origin = 'https://app.example.com' } = {}
): Ev {
	const url = new URL('https://app.example.com/api/ai/chat');
	const headers = new Headers({ 'content-type': 'application/json' });
	if (authorization) headers.set('authorization', `Bearer ${authorization}`);
	if (origin) headers.set('origin', origin);
	return {
		url,
		request: new Request(url, {
			method: 'POST',
			headers,
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		cookies: { get: () => undefined }
	} as unknown as Ev;
}

const validBody = {
	provider: 'openai',
	model: 'gpt-a',
	apiKey: 'secret-key-123456',
	messages: [{ role: 'user', content: 'Hello' }],
	toolUse: false
};

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	Object.assign(privateEnv, {
		AI_ENABLED: 'true',
		AI_MODELS_JSON: '{"openai":["gpt-a"],"nine-router":["r1"]}',
		CAPABILITY_ACCESS_TOKEN: token
	});
	logMock.logEvent.mockReset().mockResolvedValue(undefined);
	chatMock.chatResponse.mockReset().mockReturnValue(new Response('stream', { status: 200 }));
});

describe('/api/ai/chat POST', () => {
	test('404 when AI is not enabled, before the body is read', async () => {
		privateEnv.AI_ENABLED = 'false';
		await expect(POST(makeEvent(validBody))).rejects.toMatchObject({ status: 404 });
		expect(chatMock.chatResponse).not.toHaveBeenCalled();
	});

	test('401 without a token and 403 for a foreign origin', async () => {
		await expect(POST(makeEvent(validBody, { authorization: '' }))).rejects.toMatchObject({
			status: 401
		});
		await expect(
			POST(makeEvent(validBody, { origin: 'https://elsewhere.example' }))
		).rejects.toMatchObject({ status: 403 });
	});

	test('400 and a warn record when the model is not approved', async () => {
		await expect(POST(makeEvent({ ...validBody, model: 'gpt-b' }))).rejects.toMatchObject({
			status: 400
		});
		expect(logMock.logEvent).toHaveBeenCalledWith('warn', 'ai.chat', {
			outcome: 'invalid-request'
		});
		expect(chatMock.chatResponse).not.toHaveBeenCalled();
	});

	test('400 for an unexpected extra field instead of silently ignoring it', async () => {
		await expect(
			POST(makeEvent({ ...validBody, baseURL: 'https://evil.example' }))
		).rejects.toMatchObject({ status: 400 });
	});

	test('the request log carries counts and no prompt text or key', async () => {
		await POST(makeEvent(validBody));
		const [level, event, fields] = logMock.logEvent.mock.calls[0];
		expect([level, event]).toEqual(['info', 'ai.chat.start']);
		expect(fields).toEqual({
			provider: 'openai',
			model: 'gpt-a',
			messages: 1,
			chars: 5,
			tools: false,
			images: 0
		});
		expect(JSON.stringify(logMock.logEvent.mock.calls)).not.toContain('secret-key-123456');
		expect(JSON.stringify(logMock.logEvent.mock.calls)).not.toContain('Hello');
	});

	test('tool use is only reported enabled when both AI_TOOLS_ENABLED and the request agree', async () => {
		await POST(makeEvent({ ...validBody, toolUse: true }));
		expect(logMock.logEvent.mock.calls[0][2].tools).toBe(false);
		logMock.logEvent.mockClear();
		privateEnv.AI_TOOLS_ENABLED = 'true';
		await POST(makeEvent({ ...validBody, toolUse: true }));
		expect(logMock.logEvent.mock.calls[0][2].tools).toBe(true);
	});

	test('image messages are counted in the log, without their payload', async () => {
		// A real 1x1 PNG. The intake sniffs magic bytes now, so a fabricated string is refused
		// by `acceptImage` and never reaches the log — which is the point of the intake.
		const png =
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
		await POST(
			makeEvent({
				...validBody,
				messages: [
					{
						role: 'user',
						content: [{ type: 'image', mediaType: 'image/png', data: png }]
					}
				]
			})
		);
		const fields = logMock.logEvent.mock.calls[0][2];
		expect(fields.images).toBe(1);
		expect(fields.chars).toBe(0);
		expect(JSON.stringify(logMock.logEvent.mock.calls)).not.toContain(png);
	});

	test('no tools dependency is passed, so every tool is refused by policy alone', async () => {
		await POST(makeEvent(validBody));
		const deps = chatMock.chatResponse.mock.calls[0][3];
		expect(deps).toHaveProperty('policy');
		expect(deps).not.toHaveProperty('tools');
		for (const decision of Object.values(deps.policy)) expect(decision).toBe('deny');
	});

	test('AI_POLICY_JSON widens only the verbs named in it', async () => {
		privateEnv.AI_POLICY_JSON = JSON.stringify({ read_file: 'allow', exec: 'bogus' });
		await POST(makeEvent(validBody));
		const { policy } = chatMock.chatResponse.mock.calls[0][3];
		expect(policy.read_file).toBe('allow');
		expect(policy.exec).toBe('deny');
		expect(policy.write_file).toBe('deny');
	});

	test('malformed AI_POLICY_JSON falls back to deny-all rather than 500', async () => {
		privateEnv.AI_POLICY_JSON = '{oops';
		await POST(makeEvent(validBody));
		const { policy } = chatMock.chatResponse.mock.calls[0][3];
		expect(Object.values(policy).every((decision) => decision === 'deny')).toBe(true);
	});

	test('a non-fatal end outcome is logged after the stream settles, and logging failure is swallowed', async () => {
		await POST(makeEvent(validBody));
		const onOutcome = chatMock.chatResponse.mock.calls[0][2];
		logMock.logEvent.mockRejectedValueOnce(new Error('disk full'));
		expect(() => onOutcome('error')).not.toThrow();
		await Promise.resolve();
		expect(logMock.logEvent).toHaveBeenCalledWith('warn', 'ai.chat.end', {
			provider: 'openai',
			model: 'gpt-a',
			outcome: 'error'
		});
	});
});

describe('/api/ai/chat outcome reporting', () => {
	test('a successful stream reports level info, a failure reports warn', async () => {
		await POST(makeEvent(validBody));
		const onOutcome = chatMock.chatResponse.mock.calls[0][2];
		onOutcome('ok');
		await Promise.resolve();
		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'ai.chat.end', {
			provider: 'openai',
			model: 'gpt-a',
			outcome: 'ok'
		});
		logMock.logEvent.mockClear();
		onOutcome('error');
		await Promise.resolve();
		expect(logMock.logEvent).toHaveBeenCalledWith('warn', 'ai.chat.end', {
			provider: 'openai',
			model: 'gpt-a',
			outcome: 'error'
		});
	});
});

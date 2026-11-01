import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { POLICY_VERBS } from '$lib/server/policy';
import { POST } from './+server';

const { privateEnv, accessMock, chatMock, bridgeMock, logMock } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	accessMock: {
		requireCapabilityAccess: vi.fn(),
		readJsonBody: vi.fn()
	},
	chatMock: {
		chatResponse: vi.fn()
	},
	bridgeMock: {
		bridgeAvailable: vi.fn(),
		createBridgeClient: vi.fn()
	},
	logMock: {
		logEvent: vi.fn()
	}
}));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$lib/server/access', () => accessMock);
vi.mock('$lib/server/ai/chat', () => chatMock);
vi.mock('$lib/server/bridge', () => bridgeMock);
vi.mock('$lib/server/log', () => logMock);

function makeEvent(): RequestEvent<Record<string, never>, '/api/ai/chat'> {
	const url = new URL('https://app.example.com/api/ai/chat');
	const request = new Request(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		}
	});
	return {
		url,
		request,
		cookies: {
			get: () => undefined
		}
	} as unknown as RequestEvent<Record<string, never>, '/api/ai/chat'>;
}

const defaultFixture = {
	provider: 'openai',
	model: 'gpt-4o',
	apiKey: 'sk-test-key-12345',
	messages: [{ role: 'user', content: 'hello' }],
	toolUse: true
};

describe('/api/ai/chat POST', () => {
	beforeEach(() => {
		for (const key of Object.keys(privateEnv)) {
			delete privateEnv[key];
		}
		Object.assign(privateEnv, {
			AI_ENABLED: 'true',
			AI_MODELS_JSON: JSON.stringify({ openai: ['gpt-4o'] })
		});

		accessMock.requireCapabilityAccess.mockReset().mockResolvedValue(undefined);
		accessMock.readJsonBody.mockReset().mockResolvedValue(defaultFixture);

		chatMock.chatResponse.mockReset().mockReturnValue(
			new Response('{"type":"step"}\n', {
				status: 200,
				headers: { 'content-type': 'application/x-ndjson' }
			})
		);

		bridgeMock.bridgeAvailable.mockReset().mockReturnValue(false);
		bridgeMock.createBridgeClient.mockReset();

		logMock.logEvent.mockReset().mockResolvedValue(undefined);
	});

	test('AI disabled → 404', async () => {
		privateEnv.AI_ENABLED = 'false';
		await expect(POST(makeEvent())).rejects.toMatchObject({
			status: 404
		});
		expect(accessMock.requireCapabilityAccess).not.toHaveBeenCalled();
	});

	test('malformed body → 400', async () => {
		accessMock.readJsonBody.mockResolvedValueOnce({ invalid: 'payload' });
		await expect(POST(makeEvent())).rejects.toMatchObject({
			status: 400
		});
		expect(logMock.logEvent).toHaveBeenCalledWith('warn', 'ai.chat', {
			outcome: 'invalid-request'
		});
	});

	test('AI_TOOLS_ENABLED unset → chatResponse called with deps that have policy and NO tools', async () => {
		delete privateEnv.AI_TOOLS_ENABLED;
		bridgeMock.bridgeAvailable.mockReturnValue(true);

		await POST(makeEvent());

		expect(chatMock.chatResponse).toHaveBeenCalledTimes(1);
		const deps = chatMock.chatResponse.mock.calls[0][3];
		expect(deps).toBeDefined();
		expect(deps.policy).toBeDefined();
		expect('tools' in deps).toBe(false);
		expect(deps.tools).toBeUndefined();

		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'ai.chat.tools', {
			bridge: true,
			toolUse: true,
			enabled: false
		});
	});

	test('AI_ENABLED=true + AI_TOOLS_ENABLED=true + bridgeAvailable false → still no tools', async () => {
		privateEnv.AI_TOOLS_ENABLED = 'true';
		bridgeMock.bridgeAvailable.mockReturnValue(false);

		await POST(makeEvent());

		expect(chatMock.chatResponse).toHaveBeenCalledTimes(1);
		const deps = chatMock.chatResponse.mock.calls[0][3];
		expect(deps).toBeDefined();
		expect(deps.policy).toBeDefined();
		expect('tools' in deps).toBe(false);
		expect(deps.tools).toBeUndefined();

		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'ai.chat.tools', {
			bridge: false,
			toolUse: true,
			enabled: true
		});
	});

	test('all three true → deps.tools has exec, readFile, writeFile and they are the bridge functions', async () => {
		privateEnv.AI_TOOLS_ENABLED = 'true';
		bridgeMock.bridgeAvailable.mockReturnValue(true);
		const bridgeClient = {
			exec: vi.fn(),
			readFile: vi.fn(),
			writeFile: vi.fn()
		};
		bridgeMock.createBridgeClient.mockReturnValue(bridgeClient);

		await POST(makeEvent());

		expect(bridgeMock.createBridgeClient).toHaveBeenCalledWith(privateEnv);
		expect(chatMock.chatResponse).toHaveBeenCalledTimes(1);
		const deps = chatMock.chatResponse.mock.calls[0][3];
		expect(deps).toBeDefined();
		expect(deps.policy).toBeDefined();
		expect(deps.tools).toBeDefined();
		expect(deps.tools.exec).toBe(bridgeClient.exec);
		expect(deps.tools.readFile).toBe(bridgeClient.readFile);
		expect(deps.tools.writeFile).toBe(bridgeClient.writeFile);

		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'ai.chat.tools', {
			bridge: true,
			toolUse: true,
			enabled: true
		});
	});

	test('request toolUse absent while the server flag is on → no tools', async () => {
		privateEnv.AI_TOOLS_ENABLED = 'true';
		bridgeMock.bridgeAvailable.mockReturnValue(true);
		accessMock.readJsonBody.mockResolvedValueOnce({
			provider: 'openai',
			model: 'gpt-4o',
			apiKey: 'sk-test-key-12345',
			messages: [{ role: 'user', content: 'hello' }]
		});

		await POST(makeEvent());

		expect(chatMock.chatResponse).toHaveBeenCalledTimes(1);
		const deps = chatMock.chatResponse.mock.calls[0][3];
		expect(deps).toBeDefined();
		expect(deps.policy).toBeDefined();
		expect('tools' in deps).toBe(false);
		expect(deps.tools).toBeUndefined();

		expect(logMock.logEvent).toHaveBeenCalledWith('info', 'ai.chat.tools', {
			bridge: true,
			toolUse: false,
			enabled: true
		});
	});

	test('AI_POLICY_JSON malformed → the policy passed to chatResponse denies every verb', async () => {
		privateEnv.AI_POLICY_JSON = '{ not valid json :';

		await POST(makeEvent());

		expect(chatMock.chatResponse).toHaveBeenCalledTimes(1);
		const deps = chatMock.chatResponse.mock.calls[0][3];
		expect(deps).toBeDefined();
		expect(deps.policy).toBeDefined();
		for (const verb of POLICY_VERBS) {
			expect(deps.policy[verb]).toBe('deny');
		}
	});

	test('the log call never receives argv, path or token (assert on the mock arguments)', async () => {
		const bridgeToken = 'secret-bridge-token-xyz-123456';
		const capToken = 'secret-capability-token-xyz-654321';
		privateEnv.AI_TOOLS_ENABLED = 'true';
		privateEnv.BRIDGE_TOKEN = bridgeToken;
		privateEnv.CAPABILITY_ACCESS_TOKEN = capToken;
		bridgeMock.bridgeAvailable.mockReturnValue(true);
		const bridgeClient = {
			exec: vi.fn(),
			readFile: vi.fn(),
			writeFile: vi.fn()
		};
		bridgeMock.createBridgeClient.mockReturnValue(bridgeClient);

		await POST(makeEvent());

		// Also exercise outcome callback
		const outcomeCallback = chatMock.chatResponse.mock.calls[0][2];
		expect(typeof outcomeCallback).toBe('function');
		outcomeCallback('ok');
		outcomeCallback('error');

		expect(logMock.logEvent).toHaveBeenCalled();
		for (const call of logMock.logEvent.mock.calls) {
			const payload = (call[2] ?? {}) as Record<string, unknown>;
			expect(payload).not.toHaveProperty('argv');
			expect(payload).not.toHaveProperty('path');
			expect(payload).not.toHaveProperty('token');
			const serialized = JSON.stringify(call);
			expect(serialized).not.toContain(bridgeToken);
			expect(serialized).not.toContain(capToken);
		}
	});
});

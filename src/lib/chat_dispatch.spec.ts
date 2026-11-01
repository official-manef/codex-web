import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveChatBackend, streamServerChat, cloudAvailable, cloudTurn } from './chat_dispatch';
import { configureCloudChat } from '$lib/cloud/chat';
import { api } from '#lib/http.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('chat backend resolution and dispatch', () => {
	afterEach(() => {
		configureCloudChat(null);
		vi.restoreAllMocks();
	});

	it('proves the chat screen uses the real Convex path and NOT the stub when Convex is configured', async () => {
		expect(cloudAvailable()).toBe(false);

		// Wire real cloud chat
		configureCloudChat(async (turn) => {
			expect(turn.ref).toBe('openai/gpt-4o');
			expect(turn.messages).toEqual([{ role: 'user', content: 'What is 2+2?' }]);
			return {
				text: '2+2 is 4.',
				provider: 'openai',
				model: 'gpt-4o'
			};
		});

		expect(cloudAvailable()).toBe(true);

		const backend = resolveChatBackend({
			cloudAvailable: cloudAvailable(),
			serverAiAvailable: false
		});
		expect(backend).toBe('convex');

		const result = await cloudTurn({
			ref: 'openai/gpt-4o',
			messages: [{ role: 'user', content: 'What is 2+2?' }]
		});

		expect(result).toEqual({
			ok: true,
			text: '2+2 is 4.',
			provider: 'openai',
			model: 'gpt-4o'
		});
		if (result.ok) {
			expect(result.text).not.toContain('stub');
			expect(result.text).not.toContain('No provider configured');
		}
	});

	it('proves Convex takes precedence when both Convex and server AI are configured', () => {
		const backend = resolveChatBackend({
			cloudAvailable: true,
			serverAiAvailable: true
		});
		expect(backend).toBe('convex');
	});

	it('proves the chat screen uses POST /api/ai/chat and NOT the stub when server AI is available', async () => {
		const backend = resolveChatBackend({
			cloudAvailable: false,
			serverAiAvailable: true
		});
		expect(backend).toBe('server');

		const streamPayload =
			[
				JSON.stringify({ type: 'text', text: 'Hello from ' }),
				JSON.stringify({ type: 'text', text: 'real streaming server!' }),
				JSON.stringify({ type: 'done' })
			].join('\n') + '\n';

		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(streamPayload));
				controller.close();
			}
		});

		const mockFetch = vi.fn().mockResolvedValue(
			new Response(stream, {
				status: 200,
				headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' }
			})
		);

		const partials: string[] = [];
		const result = await streamServerChat(
			{
				provider: 'nine-router',
				model: 'approved-model',
				apiKey: 'sk-test-secret-key-123',
				messages: [{ role: 'user', content: 'hi' }]
			},
			(partial) => partials.push(partial),
			undefined,
			mockFetch as unknown as typeof fetch
		);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [calledUrl, calledInit] = mockFetch.mock.calls[0];
		expect(calledUrl).toBe('/api/ai/chat');
		expect(JSON.parse(calledInit.body)).toMatchObject({
			provider: 'nine-router',
			model: 'approved-model',
			apiKey: 'sk-test-secret-key-123',
			messages: [{ role: 'user', content: 'hi' }]
		});

		expect(result.error).toBeNull();
		expect(result.text).toBe('Hello from real streaming server!');
		expect(partials).toEqual(['Hello from ', 'Hello from real streaming server!']);
		expect(result.text).not.toContain('stub');
	});

	it('surfaces errors from POST /api/ai/chat instead of hiding them', async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			new Response('Check the approved provider/model, key and conversation limits.', {
				status: 400
			})
		);

		const result = await streamServerChat(
			{
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: '',
				messages: [{ role: 'user', content: 'fail' }]
			},
			() => {},
			undefined,
			mockFetch as unknown as typeof fetch
		);

		expect(result.text).toBe('');
		expect(result.error).toContain('Check the approved provider/model');
	});

	it('surfaces stream errors delivered via ChatEvent', async () => {
		const streamPayload =
			[
				JSON.stringify({ type: 'text', text: 'Partial ' }),
				JSON.stringify({ type: 'error', message: 'Quota exceeded for provider' })
			].join('\n') + '\n';

		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(streamPayload));
				controller.close();
			}
		});

		const mockFetch = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
		const result = await streamServerChat(
			{
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'key',
				messages: [{ role: 'user', content: 'stream' }]
			},
			() => {},
			undefined,
			mockFetch as unknown as typeof fetch
		);

		expect(result.text).toBe('Partial ');
		expect(result.error).toBe('Quota exceeded for provider');
	});

	it('falls back to stub and returns "No provider configured" when neither backend is available', async () => {
		const backend = resolveChatBackend({
			cloudAvailable: false,
			serverAiAvailable: false
		});
		expect(backend).toBe('stub');

		// Verify the stub catalogue and reply never emit canned answers
		const status = await api.chatStatus();
		expect(status.current_model.label).toBe('No provider configured');
		expect(status.models[0].label).toBe('No provider configured');

		const created = await api.sessionCreate({});
		const started = await api.chatStart({
			session_id: created.session.id,
			content: 'Hello?'
		});

		// Let stub settle
		await new Promise((r) => setTimeout(r, 800));
		const jobResult = await api.chatJob(started.job_id);
		const replies = jobResult.result.session.turns.at(-1)?.replies ?? [];
		expect(replies.length).toBe(1);
		expect(replies[0].text).toBe('No provider configured');
		expect(replies[0].device).toBe('Not configured');
		expect(replies[0].model_label).toBe('No provider configured');

		// Must never be any of the old canned answers
		expect(replies[0].text).not.toContain('Local workspace');
		expect(replies[0].text).not.toContain('Nothing was sent anywhere');
		expect(replies[0].text).not.toContain('Wire `src/lib/http.ts`');
	});

	it('proves Chat.svelte wires resolveChatBackend, cloudAvailable and cloudTurn', () => {
		const chatSource = readFileSync(resolve(process.cwd(), 'src/lib/views/Chat.svelte'), 'utf8');
		expect(chatSource).toContain('cloudAvailable');
		expect(chatSource).toContain('cloudTurn');
		expect(chatSource).toContain('resolveChatBackend');
		expect(chatSource).toContain('sendCloudTurn');
		expect(chatSource).toContain('sendServerTurn');
		expect(chatSource).toContain('sendStubTurn');
	});
});

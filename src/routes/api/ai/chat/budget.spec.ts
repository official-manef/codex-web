import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MAX_CHAT_BODY_BYTES, MAX_IMAGE_BYTES, MAX_IMAGES_PER_TURN } from '$lib/uploads';
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
const origin = 'https://app.example.com';

// A real 1x1 PNG, used as the header of every fixture: the route sniffs magic bytes, so a
// filler string would be refused by `acceptImage` and never reach the size arithmetic.
const PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PNG_BARE = PNG_B64.slice(0, -2);

// 5 592 408 base64 characters is the wire size of a 4 MiB image. `readJsonBody` and `acceptImage`
// both derive decoded size from `floor(len * 3 / 4) - padding`, so the padding suffix alone
// decides between "exactly at the cap" and "one byte over".
const CAP_B64_LENGTH = 5_592_408;

/** Base64 whose decoded size is exactly MAX_IMAGE_BYTES, with a real PNG header. */
function imageAtCap(): string {
	const body = 'A'.repeat(CAP_B64_LENGTH - 2 - PNG_BARE.length);
	return `${PNG_BARE}${body}==`;
}

/** Base64 whose decoded size is MAX_IMAGE_BYTES + 1. */
function imageOverCap(): string {
	const body = 'A'.repeat(CAP_B64_LENGTH - 1 - PNG_BARE.length);
	return `${PNG_BARE}${body}=`;
}

function event(body: unknown, headers: Record<string, string> = {}): Ev {
	const url = new URL(`${origin}/api/ai/chat`);
	const all = new Headers({
		'content-type': 'application/json',
		authorization: `Bearer ${token}`,
		origin,
		...headers
	});
	return {
		url,
		request: new Request(url, {
			method: 'POST',
			headers: all,
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		cookies: { get: () => undefined }
	} as unknown as Ev;
}

function chatBody(images: string[]) {
	return {
		provider: 'openai',
		model: 'gpt-a',
		apiKey: 'secret-key-123456',
		toolUse: false,
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'screenshots' },
					...images.map((data) => ({ type: 'image', mediaType: 'image/png', data }))
				]
			}
		]
	};
}

async function failure(created: Ev) {
	try {
		const response = await POST(created);
		return { status: response.status, body: '' };
	} catch (thrown) {
		const error = thrown as { status?: number; body?: { message?: string } };
		return { status: error.status, body: error.body?.message ?? '' };
	}
}

beforeEach(() => {
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	Object.assign(privateEnv, {
		AI_ENABLED: 'true',
		AI_MODELS_JSON: '{"openai":["gpt-a"]}',
		CAPABILITY_ACCESS_TOKEN: token
	});
	logMock.logEvent.mockReset().mockResolvedValue(undefined);
	chatMock.chatResponse.mockReset().mockReturnValue(new Response('stream', { status: 200 }));
});

describe('the documented image budget is reachable', () => {
	test('arithmetic: two 4 MB images plus envelope fit the chat body cap', () => {
		// The ceiling is derived from the constant, not guessed, and it is larger than the wire
		// size of the documented maximum by more than the whole text budget parseChat allows.
		expect(MAX_CHAT_BODY_BYTES).toBeGreaterThan(2 * CAP_B64_LENGTH);
		expect(MAX_CHAT_BODY_BYTES - 2 * CAP_B64_LENGTH).toBeGreaterThan(32_000 + 2_000);
	});

	test(`two images at the cap (${MAX_IMAGES_PER_TURN} × 4 MB) are accepted`, async () => {
		// This is the promise in docs/parity-checklist-2026-11-02.md §3.2, end to end through the
		// real body reader. Before the cap was raised this answered 413 and the schema never ran.
		const response = await POST(event(chatBody([imageAtCap(), imageAtCap()])));
		expect(response.status).toBe(200);
		expect(chatMock.chatResponse).toHaveBeenCalledTimes(1);
		const logged = logMock.logEvent.mock.calls.find((call) => call[1] === 'ai.chat.start');
		expect(logged?.[2].images).toBe(2);
	});

	test('an image one byte over 4 MB is refused with 413 and a message naming the size', async () => {
		const result = await failure(event(chatBody([imageOverCap()])));
		expect(result.status).toBe(413);
		expect(result.body).toBe('Each image must be 4 MB or smaller.');
		expect(chatMock.chatResponse).not.toHaveBeenCalled();
	});

	test('4 MB is inclusive: an image of exactly MAX_IMAGE_BYTES is accepted', async () => {
		const response = await POST(event(chatBody([imageAtCap()])));
		expect(response.status).toBe(200);
		expect(MAX_IMAGE_BYTES).toBe(4 * 1024 * 1024);
	});

	test('the per-turn cap still holds at 2', async () => {
		// Small payloads on purpose: three images at the size cap would trip the wire limit first
		// and prove the wrong thing. This pins the count rule, which is independent of size.
		const result = await failure(event(chatBody([PNG_B64, PNG_B64, PNG_B64])));
		expect(result.status).toBe(400);
		expect(result.body).toBe('At most 2 images per turn.');
		expect(chatMock.chatResponse).not.toHaveBeenCalled();
	});
});

describe('the body cap is a wire limit, not a parse step', () => {
	test('a body over the cap is refused before JSON is decoded', async () => {
		// 50 MB of `A` is not JSON at all. If the reader parsed first this would be a 400; the
		// only way to get 413 is the byte counter firing during the read.
		const total = 50 * 1024 * 1024;
		// Small chunks keep the measurement honest: `delivered` can then only overshoot the
		// ceiling by one chunk, which is exactly what "stopped during the read" looks like.
		const chunk = new Uint8Array(64 * 1024).fill(65);
		let delivered = 0;
		let canceled = false;
		const stream = new ReadableStream<Uint8Array>({
			// One chunk per pull, so `delivered` measures what the reader actually asked for
			// instead of whatever the stream had queued ahead of time.
			pull(controller) {
				if (delivered >= total) {
					controller.close();
					return;
				}
				controller.enqueue(chunk);
				delivered += chunk.byteLength;
			},
			cancel() {
				canceled = true;
			}
		});
		const url = new URL(`${origin}/api/ai/chat`);
		const request = new Request(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${token}`,
				origin
			},
			body: stream,
			// @ts-expect-error -- required for a streaming request body in Node
			duplex: 'half'
		});
		const result = await failure({
			url,
			request,
			cookies: { get: () => undefined }
		} as unknown as Ev);

		expect(result.status).toBe(413);
		expect(result.body).toBe('The request is too large.');
		// Early abort, not "read all 50 MB then complain": the read stops around the ceiling and
		// the caller's stream is cancelled. The bound is `total / 2` rather than the exact
		// ceiling because the runtime buffers a few chunks ahead of the reader; the claim under
		// test is "stopped near 11 MB", not "stopped on this byte".
		expect(canceled).toBe(true);
		expect(delivered).toBeLessThan(total / 2);
		expect(chatMock.chatResponse).not.toHaveBeenCalled();
	});

	test('a declared content-length over the cap is refused without reading the stream', async () => {
		const url = new URL(`${origin}/api/ai/chat`);
		// The stream never produces a byte. If the route read it, the 10 s deadline would turn
		// this into a 408; only a `content-length` refusal can answer 413 immediately.
		const stream = new ReadableStream<Uint8Array>({
			pull: () => new Promise<void>(() => undefined)
		});
		const request = new Request(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${token}`,
				origin,
				'content-length': String(50 * 1024 * 1024)
			},
			body: stream,
			// @ts-expect-error -- required for a streaming request body in Node
			duplex: 'half'
		});
		const started = Date.now();
		const result = await failure({
			url,
			request,
			cookies: { get: () => undefined }
		} as unknown as Ev);
		expect(result.status).toBe(413);
		expect(result.body).toBe('The request is too large.');
		expect(Date.now() - started).toBeLessThan(1_000);
	});
});

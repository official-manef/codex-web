import { cloudAvailable, cloudTurn, type CloudTurn, type CloudResult } from '$lib/cloud/chat';
import type { AiProvider, ChatMessage, ChatEvent } from '$lib/server/ai/contracts';

export type ChatBackend = 'convex' | 'server' | 'stub';

export interface ResolveBackendOptions {
	cloudAvailable: boolean;
	serverAiAvailable: boolean;
}

/**
 * Determine which chat backend handles a turn.
 * Preference: Convex cloud action when wired -> SvelteKit BYOK streaming route -> Fallback stub.
 */
export function resolveChatBackend(options: ResolveBackendOptions): ChatBackend {
	if (options.cloudAvailable) return 'convex';
	if (options.serverAiAvailable) return 'server';
	return 'stub';
}

export interface StreamServerChatInput {
	provider: AiProvider;
	model: string;
	apiKey: string;
	messages: ChatMessage[];
	memory?: string;
	toolUse?: boolean;
}

export interface StreamServerChatResult {
	text: string;
	error: string | null;
	/** True when the caller's own signal stopped the stream; the partial text is kept. */
	aborted?: boolean;
}

/**
 * Stream a turn from POST /api/ai/chat (SvelteKit BYOK route).
 * Emits incremental text deltas and returns the complete text or error.
 *
 * Two endings are treated as failures rather than quiet successes, because both used to look
 * like a finished reply: an upstream that closes without a `done` frame (truncated text was
 * presented as complete), and a body whose last frame has no trailing newline (the frame was
 * dropped by `split('\n')` and the reply came back empty).
 */
export async function streamServerChat(
	input: StreamServerChatInput,
	onChunk: (accumulated: string) => void,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch
): Promise<StreamServerChatResult> {
	const body: Record<string, unknown> = {
		provider: input.provider,
		model: input.model,
		apiKey: input.apiKey,
		messages: input.messages
	};
	if (input.memory !== undefined) body.memory = input.memory;
	if (input.toolUse !== undefined) body.toolUse = input.toolUse;

	const response = await fetcher('/api/ai/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		signal
	}).catch((error: unknown) => {
		// Abort before the first byte is still a stated stop, not a crash with a raw
		// "signal is aborted without reason" message next to the user's message.
		if (signal?.aborted) return null;
		throw error;
	});

	if (!response) return { text: '', error: null, aborted: true };

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		return {
			text: '',
			error: text || `Server chat failed (HTTP ${response.status})`
		};
	}

	if (!response.body) {
		return {
			text: '',
			error: 'Server returned no body.'
		};
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let accumulated = '';
	let buffer = '';
	let streamError: string | null = null;
	let sawDone = false;

	function handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;
		try {
			const event = JSON.parse(trimmed) as ChatEvent;
			if (event.type === 'text') {
				accumulated += event.text;
				onChunk(accumulated);
			} else if (event.type === 'error') {
				streamError = event.message;
			} else if (event.type === 'done') {
				sawDone = true;
			}
		} catch {
			// Ignore non-JSON frames
		}
	}

	try {
		// `reader.read()` only rejects on abort if the underlying body notices the signal. A
		// body that never errors — and any fetcher that is not a real `fetch` — left the loop
		// waiting forever, with the composer disabled and no way out. The abort is therefore
		// raced against the read instead of trusted to arrive through it.
		const aborted = new Promise<'aborted'>((resolve) => {
			if (!signal) return;
			if (signal.aborted) resolve('aborted');
			else signal.addEventListener('abort', () => resolve('aborted'), { once: true });
		});

		while (true) {
			const step = await Promise.race([reader.read(), aborted]);
			if (step === 'aborted') {
				await reader.cancel().catch(() => undefined);
				return { text: accumulated, error: null, aborted: true };
			}
			if (step.done) break;
			buffer += decoder.decode(step.value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) handleLine(line);
			if (streamError || sawDone) break;
		}
	} catch (error) {
		// A caller-initiated stop is a stated outcome, not a crash: keep what arrived.
		if (signal?.aborted) return { text: accumulated, error: null, aborted: true };
		throw error;
	} finally {
		reader.releaseLock();
	}

	// The last frame often has no trailing newline; it used to be silently dropped.
	if (buffer) handleLine(buffer);

	if (streamError) return { text: accumulated, error: streamError };
	if (signal?.aborted) return { text: accumulated, error: null, aborted: true };
	if (!sawDone) {
		return {
			text: accumulated,
			error: 'The connection closed before the reply finished. Send the message again to retry.'
		};
	}

	return {
		text: accumulated,
		error: null
	};
}

export { cloudAvailable, cloudTurn };
export type { CloudTurn, CloudResult, AiProvider, ChatMessage, ChatEvent };

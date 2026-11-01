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
}

export interface StreamServerChatResult {
	text: string;
	error: string | null;
}

/**
 * Stream a turn from POST /api/ai/chat (SvelteKit BYOK route).
 * Emits incremental text deltas and returns the complete text or error.
 */
export async function streamServerChat(
	input: StreamServerChatInput,
	onChunk: (accumulated: string) => void,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch
): Promise<StreamServerChatResult> {
	const response = await fetcher('/api/ai/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
		signal
	});

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

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const event = JSON.parse(trimmed) as ChatEvent;
					if (event.type === 'text') {
						accumulated += event.text;
						onChunk(accumulated);
					} else if (event.type === 'error') {
						streamError = event.message;
						break;
					} else if (event.type === 'done') {
						break;
					}
				} catch {
					// Ignore non-JSON frames
				}
			}
			if (streamError) break;
		}
	} finally {
		reader.releaseLock();
	}

	return {
		text: accumulated,
		error: streamError
	};
}

export { cloudAvailable, cloudTurn };
export type { CloudTurn, CloudResult, AiProvider, ChatMessage, ChatEvent };

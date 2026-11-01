import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { requireCapabilityAccess, readJsonBody } from '$lib/server/access';
import { parseChat } from '$lib/server/ai/config';
import { chatResponse } from '$lib/server/ai/chat';
import { defaultPolicy, parsePolicy } from '$lib/server/policy';
import { logEvent } from '$lib/server/log';
import type { RequestHandler } from './$types';

/**
 * AI_POLICY_JSON is the server's answer to "may the model touch this machine".
 *
 * Malformed JSON falls back to `defaultPolicy()`, which denies every verb — a typo in a
 * private env var must never widen authority. Tool use is additionally gated by the request
 * (`toolUse`) and by `AI_TOOLS_ENABLED`, so three things must agree before a tool runs.
 */
function policy(source: Record<string, string | undefined>) {
	if (!source.AI_POLICY_JSON) return defaultPolicy();
	try {
		return parsePolicy(JSON.parse(source.AI_POLICY_JSON));
	} catch {
		return defaultPolicy();
	}
}

export const POST: RequestHandler = async (event) => {
	if (env.AI_ENABLED !== 'true') error(404, 'AI chat is disabled.');
	await requireCapabilityAccess(event);
	const body = await readJsonBody(event.request);
	let input: ReturnType<typeof parseChat>;
	try {
		input = parseChat(env, body);
	} catch {
		await logEvent('warn', 'ai.chat', { outcome: 'invalid-request' });
		error(400, 'Check the approved provider/model, key and conversation limits.');
	}
	const toolsEnabled = env.AI_TOOLS_ENABLED === 'true';
	await logEvent('info', 'ai.chat.start', {
		provider: input.provider,
		model: input.model,
		messages: input.messages.length,
		chars: input.messages.reduce(
			(total, message) =>
				total + (typeof message.content === 'string' ? message.content.length : 0),
			0
		),
		tools: toolsEnabled && input.toolUse,
		images: input.messages.some((message) => Array.isArray(message.content))
	});
	return chatResponse(
		input,
		event.request.signal,
		(outcome) => {
			logEvent(outcome === 'ok' ? 'info' : 'warn', 'ai.chat.end', {
				provider: input.provider,
				model: input.model,
				outcome
			}).catch(() => undefined);
		},
		// No `tools` deps are wired here on purpose: this route has no bridge connection, so a
		// tool call has nowhere to execute. Passing the policy alone keeps the refusal honest —
		// every tool returns "denied by policy" instead of pretending to run.
		{ policy: policy(env) }
	);
};

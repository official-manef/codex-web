// This decides what to tell the user, not what to send; the route and the provider adapter are where it must actually be enforced, and only openai enforces it today.

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const EFFORTS: readonly ReasoningEffort[] = [
	'none',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh'
];

export const DEFAULT_EFFORT: ReasoningEffort = 'medium';

export function parseEffort(value: unknown): ReasoningEffort | null {
	if (typeof value !== 'string') return null;
	return (EFFORTS as readonly string[]).includes(value) ? (value as ReasoningEffort) : null;
}

const PROVIDER_REFUSALS: Record<string, string> = {
	anthropic: 'Anthropic does not take a reasoning effort field from this client.',
	google: 'Google does not take a reasoning effort field from this client.',
	'nine-router': '9router does not take a reasoning effort field from this client.'
};

export function effortForProvider(
	provider: string,
	effort: ReasoningEffort
): { accepted: boolean; reason?: string } {
	void effort;
	if (provider === 'openai') {
		return { accepted: true };
	}
	const reason = PROVIDER_REFUSALS[provider];
	if (reason) {
		return { accepted: false, reason };
	}
	return { accepted: false, reason: 'Unknown provider.' };
}

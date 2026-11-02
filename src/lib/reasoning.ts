// Provider refusals below are a POLICY choice of this client, not limitations of the protocol or
// the endpoint: the 9router endpoint is OpenAI-compatible and would accept the field, but its
// approved catalog is not vetted for it, so it stays refused on purpose. Enforcing the policy
// for openai happens in the route and provider adapter.

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
	// Policy, not protocol: the endpoint is OpenAI-compatible and would accept `reasoningEffort`;
	// its approved models are simply not cleared for it here.
	'nine-router': '9router is configured without reasoning effort here (client policy).'
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

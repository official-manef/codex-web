/**
 * Closed-by-default policy table for bridge and agent tool operations.
 *
 * Why deny-by-default: An unset or unrecognised policy MUST NEVER mean "allowed".
 * Any missing entry, unexpected value, or unparsed state strictly resolves to 'deny'
 * to avoid privilege escalation or open-by-default capability execution.
 *
 * ponytail: This module is a pure policy table defining what is permitted, asked,
 * or denied per verb. It is NOT an authentication or authorization system; real authorization
 * boundaries and identity verification stay in requireCapabilityAccess / requireUser.
 */

export type PolicyVerb =
	| 'read_file'
	| 'write_file'
	| 'apply_patch'
	| 'exec'
	| 'git_diff'
	| 'git_stage'
	| 'git_commit'
	| 'git_worktree'
	| 'mcp_app';

export type PolicyDecision = 'allow' | 'ask' | 'deny';

export const POLICY_VERBS: readonly PolicyVerb[] = [
	'read_file',
	'write_file',
	'apply_patch',
	'exec',
	'git_diff',
	'git_stage',
	'git_commit',
	'git_worktree',
	'mcp_app'
] as const;

export const POLICY_DECISIONS: readonly PolicyDecision[] = ['allow', 'ask', 'deny'] as const;

const DECISION_SET = new Set<string>(POLICY_DECISIONS);

function isPolicyDecision(value: unknown): value is PolicyDecision {
	return typeof value === 'string' && DECISION_SET.has(value);
}

export function defaultPolicy(): Record<PolicyVerb, PolicyDecision> {
	const policy = {} as Record<PolicyVerb, PolicyDecision>;
	for (const verb of POLICY_VERBS) {
		policy[verb] = 'deny';
	}
	return policy;
}

export function parsePolicy(value: unknown): Record<PolicyVerb, PolicyDecision> {
	const policy = defaultPolicy();
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return policy;
	}
	const entries = value as Record<string, unknown>;
	for (const verb of POLICY_VERBS) {
		const candidate = entries[verb];
		if (isPolicyDecision(candidate)) {
			policy[verb] = candidate;
		}
	}
	return policy;
}

export function decisionFor(
	policy: Record<PolicyVerb, PolicyDecision>,
	verb: PolicyVerb
): PolicyDecision {
	if (!policy || typeof policy !== 'object') {
		return 'deny';
	}
	const decision = policy[verb];
	return isPolicyDecision(decision) ? decision : 'deny';
}

export function isAllowed(policy: Record<PolicyVerb, PolicyDecision>, verb: PolicyVerb): boolean {
	return decisionFor(policy, verb) === 'allow';
}

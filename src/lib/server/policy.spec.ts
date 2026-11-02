import { describe, expect, test } from 'vitest';
import {
	decisionFor,
	defaultPolicy,
	isAllowed,
	parsePolicy,
	POLICY_DECISIONS,
	POLICY_VERBS,
	type PolicyDecision,
	type PolicyVerb
} from './policy';

describe('policy server model', () => {
	test('default policy is all-deny for every registered verb', () => {
		const policy = defaultPolicy();
		expect(Object.keys(policy).sort()).toEqual([...POLICY_VERBS].sort());
		for (const verb of POLICY_VERBS) {
			expect(policy[verb]).toBe('deny');
		}
		expect(POLICY_DECISIONS).toEqual(['allow', 'ask', 'deny']);
	});

	test('parsePolicy honours a valid subset and fills the rest with deny', () => {
		const parsed = parsePolicy({
			read_file: 'allow',
			git_commit: 'ask'
		});

		expect(parsed.read_file).toBe('allow');
		expect(parsed.git_commit).toBe('ask');
		expect(parsed.write_file).toBe('deny');
		expect(parsed.apply_patch).toBe('deny');
		expect(parsed.exec).toBe('deny');
		expect(parsed.git_diff).toBe('deny');
		expect(parsed.git_stage).toBe('deny');
		expect(parsed.git_worktree).toBe('deny');
		expect(parsed.mcp_app).toBe('deny');
	});

	test('unknown verbs and invalid decision strings are dropped back to default', () => {
		const parsed = parsePolicy({
			read_file: 'allow',
			unknown_verb: 'allow',
			another_random_key: 'deny',
			exec: 'unsupported_decision',
			git_diff: 42,
			git_stage: null
		});

		expect(parsed.read_file).toBe('allow');
		expect(parsed.exec).toBe('deny');
		expect(parsed.git_diff).toBe('deny');
		expect(parsed.git_stage).toBe('deny');
		expect('unknown_verb' in parsed).toBe(false);
		expect('another_random_key' in parsed).toBe(false);
		expect(Object.keys(parsed).sort()).toEqual([...POLICY_VERBS].sort());
	});

	test('a decision inherited through the prototype is not a policy', () => {
		// Fuzz regression: `Object.create({ exec: 'allow' })` used to grant exec, because a
		// missing own entry must mean deny. Nothing but an own property may set a verb.
		expect(parsePolicy(Object.create({ exec: 'allow', mcp_app: 'allow' }))).toEqual(
			defaultPolicy()
		);
		expect(parsePolicy(Object.create(null))).toEqual(defaultPolicy());
	});

	test('null, undefined, array, string, and number all yield default without throwing', () => {
		const empty = defaultPolicy();
		expect(parsePolicy(null)).toEqual(empty);
		expect(parsePolicy(undefined)).toEqual(empty);
		expect(parsePolicy([])).toEqual(empty);
		expect(parsePolicy(['read_file', 'allow'])).toEqual(empty);
		expect(parsePolicy('allow')).toEqual(empty);
		expect(parsePolicy(12345)).toEqual(empty);
		expect(parsePolicy(true)).toEqual(empty);
		expect(parsePolicy(() => undefined)).toEqual(empty);
	});

	test('decisionFor with a missing key or malformed object returns deny defensively', () => {
		const partial = { read_file: 'allow' } as Record<PolicyVerb, PolicyDecision>;
		expect(decisionFor(partial, 'read_file')).toBe('allow');
		expect(decisionFor(partial, 'exec')).toBe('deny');
		expect(decisionFor({} as Record<PolicyVerb, PolicyDecision>, 'git_commit')).toBe('deny');
		expect(
			decisionFor(
				{ read_file: 'not_a_real_decision' } as unknown as Record<PolicyVerb, PolicyDecision>,
				'read_file'
			)
		).toBe('deny');
		expect(decisionFor(null as unknown as Record<PolicyVerb, PolicyDecision>, 'read_file')).toBe(
			'deny'
		);
	});

	test('isAllowed is true only for allow and explicitly false for ask or deny', () => {
		const policy = parsePolicy({
			read_file: 'allow',
			apply_patch: 'ask',
			exec: 'deny'
		});

		expect(isAllowed(policy, 'read_file')).toBe(true);
		expect(isAllowed(policy, 'apply_patch')).toBe(false);
		expect(isAllowed(policy, 'exec')).toBe(false);
		expect(isAllowed(policy, 'write_file')).toBe(false);

		const missingVerbPolicy = { read_file: 'allow' } as Record<PolicyVerb, PolicyDecision>;
		expect(isAllowed(missingVerbPolicy, 'git_worktree')).toBe(false);
	});

	test('round-trip parsePolicy(defaultPolicy()) deep-equals defaultPolicy()', () => {
		const standardDefault = defaultPolicy();
		const roundTripped = parsePolicy(standardDefault);
		expect(roundTripped).toEqual(standardDefault);
	});
});

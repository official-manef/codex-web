import { describe, expect, test } from 'vitest';
import {
	DEFAULT_EFFORT,
	EFFORTS,
	effortForProvider,
	parseEffort,
	type ReasoningEffort
} from './reasoning';

describe('reasoning efforts constants', () => {
	test('EFFORTS has six unique members in the documented order', () => {
		expect(EFFORTS).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
		expect(new Set(EFFORTS).size).toBe(6);
	});

	test('DEFAULT_EFFORT is medium', () => {
		expect(DEFAULT_EFFORT).toBe('medium');
	});
});

describe('parseEffort', () => {
	test('accepts each of the six exact efforts case-sensitively', () => {
		for (const effort of EFFORTS) {
			expect(parseEffort(effort)).toBe(effort);
		}
	});

	test('rejects case variations, empty string, non-strings, numbers and unknown values with null without throwing', () => {
		expect(parseEffort('HIGH')).toBeNull();
		expect(parseEffort('')).toBeNull();
		expect(parseEffort(null)).toBeNull();
		expect(parseEffort(42)).toBeNull();
		expect(parseEffort('ultra')).toBeNull();
		expect(parseEffort(undefined)).toBeNull();
		expect(parseEffort({})).toBeNull();
		expect(parseEffort([])).toBeNull();
		expect(parseEffort(true)).toBeNull();
	});
});

describe('effortForProvider', () => {
	test('openai accepts reasoning effort', () => {
		expect(effortForProvider('openai', 'high')).toEqual({ accepted: true });
		for (const effort of EFFORTS) {
			expect(effortForProvider('openai', effort)).toEqual({ accepted: true });
		}
	});

	test('every known other provider reports accepted: false with a non-empty reason naming the provider plainly', () => {
		const nonAcceptingProviders = ['anthropic', 'google', 'nine-router'] as const;
		for (const provider of nonAcceptingProviders) {
			for (const effort of EFFORTS) {
				const result = effortForProvider(provider, effort);
				expect(result.accepted).toBe(false);
				expect(typeof result.reason).toBe('string');
				expect(result.reason?.length).toBeGreaterThan(0);
				expect(result.reason?.toLowerCase()).toMatch(
					new RegExp(provider === 'nine-router' ? '9router|nine-router' : provider)
				);
			}
		}
	});

	test('unknown provider is refused with an unknown provider reason', () => {
		const result = effortForProvider('unknown-provider', 'medium' as ReasoningEffort);
		expect(result).toEqual({ accepted: false, reason: 'Unknown provider.' });
	});
});

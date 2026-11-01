import { describe, expect, it } from 'vitest';
import {
	INTERVALS,
	MAX_AUTOMATIONS,
	MAX_FAILURES,
	MIN_INTERVAL_MINUTES,
	MAX_PROMPT_LENGTH,
	automationTitle,
	canAddAutomation,
	isValidInterval,
	nextRunAt,
	shouldDisable
} from './automations';

describe('automations constants', () => {
	it('exports the expected scheduling constraints', () => {
		expect(INTERVALS).toEqual([15, 30, 60, 360, 1440]);
		expect(MAX_AUTOMATIONS).toBe(20);
		expect(MAX_FAILURES).toBe(3);
		expect(MIN_INTERVAL_MINUTES).toBe(15);
		expect(MAX_PROMPT_LENGTH).toBe(4000);
		for (const interval of INTERVALS) {
			expect(interval).toBeGreaterThanOrEqual(MIN_INTERVAL_MINUTES);
		}
	});
});

describe('nextRunAt', () => {
	it('computes future run times for valid intervals', () => {
		const base = 1_700_000_000_000;
		expect(nextRunAt(base, 15)).toBe(base + 15 * 60_000);
		expect(nextRunAt(base, 30)).toBe(base + 30 * 60_000);
		expect(nextRunAt(base, 60)).toBe(base + 60 * 60_000);
		expect(nextRunAt(base, 360)).toBe(base + 360 * 60_000);
		expect(nextRunAt(base, 1440)).toBe(base + 1440 * 60_000);
	});

	it('rejects intervals below MIN_INTERVAL_MINUTES', () => {
		const base = 1_700_000_000_000;
		expect(() => nextRunAt(base, 14)).toThrow(RangeError);
		expect(() => nextRunAt(base, 0)).toThrow(RangeError);
		expect(() => nextRunAt(base, -15)).toThrow(RangeError);
	});

	it('rejects non-integer intervals', () => {
		const base = 1_700_000_000_000;
		expect(() => nextRunAt(base, 15.5)).toThrow(RangeError);
		expect(() => nextRunAt(base, 30.1)).toThrow(RangeError);
	});

	it('rejects non-finite intervals', () => {
		const base = 1_700_000_000_000;
		expect(() => nextRunAt(base, Number.NaN)).toThrow(RangeError);
		expect(() => nextRunAt(base, Number.POSITIVE_INFINITY)).toThrow(RangeError);
		expect(() => nextRunAt(base, Number.NEGATIVE_INFINITY)).toThrow(RangeError);
	});

	it('rejects non-finite from timestamps', () => {
		expect(() => nextRunAt(Number.NaN, 15)).toThrow(RangeError);
		expect(() => nextRunAt(Number.POSITIVE_INFINITY, 15)).toThrow(RangeError);
		expect(() => nextRunAt(Number.NEGATIVE_INFINITY, 15)).toThrow(RangeError);
	});
});

describe('canAddAutomation', () => {
	it('allows adding when existing count is strictly under MAX_AUTOMATIONS', () => {
		expect(canAddAutomation(0)).toBe(true);
		expect(canAddAutomation(1)).toBe(true);
		expect(canAddAutomation(19)).toBe(true);
	});

	it('refuses adding when existing count reaches or exceeds MAX_AUTOMATIONS', () => {
		expect(canAddAutomation(20)).toBe(false);
		expect(canAddAutomation(21)).toBe(false);
		expect(canAddAutomation(50)).toBe(false);
	});

	it('refuses invalid counts', () => {
		expect(canAddAutomation(-1)).toBe(false);
		expect(canAddAutomation(1.5)).toBe(false);
		expect(canAddAutomation(Number.NaN)).toBe(false);
	});
});

describe('shouldDisable', () => {
	it('returns false when failure count is below threshold', () => {
		expect(shouldDisable(0)).toBe(false);
		expect(shouldDisable(1)).toBe(false);
		expect(shouldDisable(2)).toBe(false);
	});

	it('returns true when failure count reaches MAX_FAILURES or exceeds it', () => {
		expect(shouldDisable(3)).toBe(true);
		expect(shouldDisable(4)).toBe(true);
		expect(shouldDisable(10)).toBe(true);
	});
});

describe('automationTitle', () => {
	it('trims leading and trailing whitespace', () => {
		expect(automationTitle('   hello world   ')).toBe('hello world');
	});

	it('collapses internal whitespace and newlines', () => {
		expect(automationTitle('fetch   daily   metrics\n\nand\tsend   email')).toBe(
			'fetch daily metrics and send email'
		);
	});

	it('bounds the title to 60 characters', () => {
		const longPrompt = 'a'.repeat(100);
		const title = automationTitle(longPrompt);
		expect(title).toHaveLength(60);
		expect(title).toBe('a'.repeat(60));
	});

	it('handles empty or whitespace-only inputs', () => {
		expect(automationTitle('')).toBe('');
		expect(automationTitle('   \t\n  ')).toBe('');
	});
});

describe('isValidInterval', () => {
	it('accepts only supported intervals', () => {
		expect(isValidInterval(15)).toBe(true);
		expect(isValidInterval(30)).toBe(true);
		expect(isValidInterval(60)).toBe(true);
		expect(isValidInterval(360)).toBe(true);
		expect(isValidInterval(1440)).toBe(true);

		expect(isValidInterval(0)).toBe(false);
		expect(isValidInterval(10)).toBe(false);
		expect(isValidInterval(20)).toBe(false);
		expect(isValidInterval(45)).toBe(false);
		expect(isValidInterval(120)).toBe(false);
		expect(isValidInterval(Number.NaN)).toBe(false);
	});
});

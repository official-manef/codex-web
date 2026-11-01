export type Interval = 15 | 30 | 60 | 360 | 1440; // minutes

export const INTERVALS: readonly Interval[] = [15, 30, 60, 360, 1440] as const;
export const MAX_AUTOMATIONS = 20;
export const MAX_FAILURES = 3;
export const MIN_INTERVAL_MINUTES = 15;
export const MAX_PROMPT_LENGTH = 4000;

/** Next run time for a valid interval; throws on an invalid one. */
export function nextRunAt(from: number, intervalMinutes: number): number {
	if (!Number.isFinite(from)) {
		throw new RangeError('from timestamp must be a finite number');
	}
	if (
		!Number.isFinite(intervalMinutes) ||
		!Number.isInteger(intervalMinutes) ||
		intervalMinutes < MIN_INTERVAL_MINUTES
	) {
		throw new RangeError(
			`intervalMinutes must be an integer >= ${MIN_INTERVAL_MINUTES}, received: ${intervalMinutes}`
		);
	}
	return from + intervalMinutes * 60_000;
}

/** True when the owner may add another automation. */
export function canAddAutomation(existingCount: number): boolean {
	return Number.isInteger(existingCount) && existingCount >= 0 && existingCount < MAX_AUTOMATIONS;
}

/** Should this automation be disabled after this failure? */
export function shouldDisable(failureCount: number): boolean {
	return failureCount >= MAX_FAILURES;
}

/** Bounded, human label from a prompt. */
export function automationTitle(prompt: string): string {
	return prompt.trim().replace(/\s+/g, ' ').slice(0, 60);
}

/** Validate whether a given number is one of the supported intervals. */
export function isValidInterval(minutes: number): minutes is Interval {
	return (INTERVALS as readonly number[]).includes(minutes);
}

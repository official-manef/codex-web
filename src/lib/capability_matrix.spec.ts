import { describe, expect, test } from 'vitest';
import { summarise, type Row, type State } from './capability_matrix';

describe('capability_matrix summarise', () => {
	test('summarise counts present, absent, and unproven correctly', () => {
		const sample: Row[] = [
			{ id: 'a', label: 'A', state: 'present', evidence: 'found a' },
			{ id: 'b', label: 'B', state: 'present', evidence: 'found b' },
			{ id: 'c', label: 'C', state: 'absent', evidence: 'missing c' },
			{ id: 'd', label: 'D', state: 'unproven', evidence: 'unproven d' }
		];
		const result = summarise(sample);
		expect(result.present).toBe(2);
		expect(result.absent).toBe(1);
		expect(result.unproven).toBe(1);
	});

	test('zero-denominator returns percentReachable: 0', () => {
		expect(summarise([]).percentReachable).toBe(0);
		expect(
			summarise([{ id: 'u', label: 'U', state: 'unproven', evidence: 'only unproven' }])
				.percentReachable
		).toBe(0);
	});

	test('rounds percentReachable to one decimal place', () => {
		const rows2to1: Row[] = [
			{ id: '1', label: '1', state: 'present', evidence: '' },
			{ id: '2', label: '2', state: 'present', evidence: '' },
			{ id: '3', label: '3', state: 'absent', evidence: '' }
		];
		expect(summarise(rows2to1).percentReachable).toBe(66.7);

		const rows1to2: Row[] = [
			{ id: '1', label: '1', state: 'present', evidence: '' },
			{ id: '2', label: '2', state: 'absent', evidence: '' },
			{ id: '3', label: '3', state: 'absent', evidence: '' }
		];
		expect(summarise(rows1to2).percentReachable).toBe(33.3);

		const rows1to7: Row[] = [
			{ id: '1', label: '1', state: 'present', evidence: '' },
			...Array.from({ length: 7 }, (_, i) => ({
				id: `absent-${i}`,
				label: `Absent ${i}`,
				state: 'absent' as State,
				evidence: ''
			}))
		];
		expect(summarise(rows1to7).percentReachable).toBe(12.5);
	});

	test('every Row state in a sample is one of the three literals', () => {
		const allowedStates: State[] = ['present', 'absent', 'unproven'];
		const sample: Row[] = [
			{ id: 'agent-loop', label: 'Agent loop', state: 'present', evidence: 'tools: TOOL_SPECS' },
			{ id: 'images', label: 'Images', state: 'absent', evidence: 'toWireImages missing' },
			{
				id: 'automations-run',
				label: 'Automations run',
				state: 'unproven',
				evidence: 'no model call exists'
			}
		];

		for (const row of sample) {
			expect(allowedStates).toContain(row.state);
		}
	});
});

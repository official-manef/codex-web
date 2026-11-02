import { expect, test } from 'vitest';
import { flowEdges, newStep, parseWorkflow, stepDependents, type WorkflowStep } from './workflow_graph';

test('parseWorkflow accepts a minimal spec and refuses anything without unique ids', () => {
	expect(parseWorkflow('{"name":"w","steps":[{"id":"a","type":"t"}]}')).toEqual({
		name: 'w',
		steps: [{ id: 'a', type: 't' }]
	});
	for (const source of [
		'',
		'null',
		'[]',
		'{"steps":{}}',
		'{"steps":[{"id":"a"}]}',
		'{"steps":[{"id":"","type":"t"}]}',
		'{"steps":[{"id":"a","type":"t"},{"id":"a","type":"t"}]}',
		'{"steps":[1]}'
	])
		expect(parseWorkflow(source), source).toBeNull();
});

test('flowEdges reports a self-edge rather than looping on it', () => {
	// Fuzz regression (`src/lib/fuzz.spec.ts`): a self-edge is legal data, and the walk must
	// terminate. Nothing here may recurse through the graph.
	expect(flowEdges([{ id: 'a', type: 'branch', then: 'a', else: 'a' }])).toEqual([
		{ from: 'a', to: 'a', label: 'Yes' },
		{ from: 'a', to: 'a', label: 'No' }
	]);
	// A branch pointing at a missing step drops the edge; the linear chain ends at `end`.
	expect(flowEdges([{ id: 'a', type: 'branch', then: 'gone', else: 'b' }, { id: 'b', type: 't' }])).toEqual([
		{ from: 'a', to: 'b', label: 'No' },
		{ from: 'b', to: 'end', label: '' }
	]);
});

test('flowEdges stays linear in the number of steps', () => {
	// The old filter scanned `steps` once per edge, so a large pasted spec cost O(n^2) of
	// blocking work on the canvas. 20 000 steps must not take seconds.
	const steps: WorkflowStep[] = Array.from({ length: 20_000 }, (_, index) => ({
		id: `s${index}`,
		type: 'noop'
	}));
	const started = performance.now();
	const edges = flowEdges(steps);
	const elapsed = performance.now() - started;
	expect(edges).toHaveLength(20_000);
	expect(elapsed).toBeLessThan(1000);
});

test('stepDependents terminates on a cycle and on a shared subtree', () => {
	// Fuzz regression (`src/lib/fuzz.spec.ts`): an object that refers to itself used to throw
	// RangeError out of the recursive walk; a shared node was visited once per reference.
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	const shared: Record<string, unknown> = { $step: 'target' };
	const steps: WorkflowStep[] = [
		{ id: 'a', type: 'noop', cfg: cyclic },
		{ id: 'b', type: 'noop', cfg: { left: shared, right: shared } },
		{ id: 'target', type: 'noop' }
	];
	expect(() => stepDependents(steps, 'target')).not.toThrow();
	expect(stepDependents(steps, 'target')).toEqual(['b']);
	// A step is never its own dependent, even when it branches to itself.
	expect(stepDependents([{ id: 'a', type: 'branch', then: 'a', else: 'a' }], 'a')).toEqual([]);
});

test('stepDependents refuses a spec nested past the walk depth instead of overflowing', () => {
	// Fuzz regression: `parseWorkflow` accepts deeply nested JSON, and an unbounded recursive
	// scan turned that into "Maximum call stack size exceeded" on the canvas.
	let inner = '1';
	for (let i = 0; i < 6000; i++) inner = `{"a":${inner}}`;
	const spec = parseWorkflow(`{"name":"w","steps":[{"id":"s","type":"t","cfg":${inner}}]}`);
	expect(spec).not.toBeNull();
	expect(() => stepDependents(spec!.steps, 'zz')).not.toThrow();
	expect(stepDependents(spec!.steps, 'zz')).toEqual([]);
});

test('newStep allocates the first free id for its type', () => {
	expect(newStep('perceive', []).id).toBe('perceive_1');
	expect(newStep('perceive', [{ id: 'perceive_1', type: 'perceive' }]).id).toBe('perceive_2');
	expect(newStep('branch', [{ id: 'branch_2', type: 'branch' }]).id).toBe('branch_1');
	// A branch inherits the earlier perceive step, so the canvas does not start disconnected.
	const earlier = newStep('perceive', []);
	expect(newStep('branch', [earlier])).toMatchObject({
		condition: { step: earlier.id, question: 'relevant' },
		then: 'end',
		else: 'end'
	});
});

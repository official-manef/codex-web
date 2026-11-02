import { expect, test } from 'vitest';
import {
	flowEdges,
	newStep,
	parseWorkflow,
	stepDependents,
	type WorkflowStep
} from './workflow_graph';

/**
 * The canvas writes the same declarative definition a server validates, so these are graph
 * shapes rather than return values: a shape the canvas draws wrongly is a workflow that runs
 * wrongly, and a dangling `$step` is a run that fails at the first document.
 */

const step = (
	id: string,
	type = 'perceive',
	extra: Record<string, unknown> = {}
): WorkflowStep => ({
	id,
	type,
	...extra
});

test('parseWorkflow accepts only an object whose steps are unique, named and typed', () => {
	expect(parseWorkflow('{"name":"x","steps":[{"id":"a","type":"perceive"}]}')).toEqual({
		name: 'x',
		steps: [{ id: 'a', type: 'perceive' }]
	});
	// Extra keys survive: the canvas round-trips a definition it does not fully understand.
	expect(
		parseWorkflow('{"steps":[{"id":"a","type":"perceive"}],"inputs":{"q":{"type":"string"}}}')
	).toMatchObject({ inputs: { q: { type: 'string' } } });
});

test('parseWorkflow refuses every shape that is not a workflow, without throwing', () => {
	for (const text of [
		'not json',
		'',
		'[]',
		'[{"id":"a","type":"perceive"}]',
		'null',
		'42',
		'"steps"',
		'{}',
		'{"steps":{}}',
		'{"steps":[]} ' + 'x',
		'{"steps":[null]}',
		'{"steps":[[]]}',
		'{"steps":[{"type":"perceive"}]}',
		'{"steps":[{"id":"","type":"perceive"}]}',
		'{"steps":[{"id":1,"type":"perceive"}]}',
		'{"steps":[{"id":"a"}]}',
		'{"steps":[{"id":"a","type":2}]}'
	]) {
		expect(parseWorkflow(text), text).toBeNull();
	}
});

test('parseWorkflow refuses duplicate step ids, so a branch cannot point at two nodes', () => {
	expect(
		parseWorkflow('{"steps":[{"id":"a","type":"perceive"},{"id":"a","type":"branch"}]}')
	).toBeNull();
	// The same id in a later position is still ambiguous; order does not make it unique.
	expect(
		parseWorkflow(
			'{"steps":[{"id":"a","type":"perceive"},{"id":"b","type":"branch"},{"id":"a","type":"browser"}]}'
		)
	).toBeNull();
});

test('flowEdges chains a linear workflow forward and closes on end', () => {
	expect(flowEdges([step('a'), step('b'), step('c')])).toEqual([
		{ from: 'a', to: 'b', label: '' },
		{ from: 'b', to: 'c', label: '' },
		{ from: 'c', to: 'end', label: '' }
	]);
});

test('flowEdges gives a branch exactly two labelled edges and never a fallthrough edge', () => {
	expect(
		flowEdges([step('ask'), step('choose', 'branch', { then: 'yes', else: 'end' }), step('yes')])
	).toEqual([
		{ from: 'ask', to: 'choose', label: '' },
		{ from: 'choose', to: 'yes', label: 'Yes' },
		{ from: 'choose', to: 'end', label: 'No' },
		{ from: 'yes', to: 'end', label: '' }
	]);
});

test('flowEdges drops a reference to a node that does not exist instead of drawing it', () => {
	expect(flowEdges([step('choose', 'branch', { then: 'ghost', else: 'end' })])).toEqual([
		{ from: 'choose', to: 'end', label: 'No' }
	]);
	// A branch with no targets at all keeps no edge: `undefined` is not "end".
	expect(flowEdges([step('choose', 'branch')])).toEqual([]);
});

test('flowEdges keeps a self-loop, because a branch may legitimately point at itself', () => {
	expect(flowEdges([step('choose', 'branch', { then: 'choose', else: 'end' })])).toEqual([
		{ from: 'choose', to: 'choose', label: 'Yes' },
		{ from: 'choose', to: 'end', label: 'No' }
	]);
});

test('flowEdges keeps both edges when Yes and No land on the same node', () => {
	expect(
		flowEdges([step('choose', 'branch', { then: 'same', else: 'same' }), step('same')])
	).toEqual([
		{ from: 'choose', to: 'same', label: 'Yes' },
		{ from: 'choose', to: 'same', label: 'No' },
		{ from: 'same', to: 'end', label: '' }
	]);
});

test('flowEdges on an empty workflow is empty, not a single end edge', () => {
	expect(flowEdges([])).toEqual([]);
});

test('flowEdges draws a node a branch skipped over, so an unreachable step stays visible', () => {
	// `b` is the only step that a branch jumps past; the canvas must still show it and its edge.
	const edges = flowEdges([step('a', 'branch', { then: 'c', else: 'end' }), step('b'), step('c')]);
	expect(edges).toEqual([
		{ from: 'a', to: 'c', label: 'Yes' },
		{ from: 'a', to: 'end', label: 'No' },
		{ from: 'b', to: 'c', label: '' },
		{ from: 'c', to: 'end', label: '' }
	]);
});

test('flowEdges survives a very deep chain without dropping or repeating an edge', () => {
	const steps = Array.from({ length: 500 }, (_, index) => step(`s${index}`));
	const edges = flowEdges(steps);
	expect(edges).toHaveLength(500);
	expect(edges[0]).toEqual({ from: 's0', to: 's1', label: '' });
	expect(edges.at(-1)).toEqual({ from: 's499', to: 'end', label: '' });
});

test('newStep allocates the first free suffix instead of the next one', () => {
	const steps = [step('perceive_1'), step('perceive_3')];
	expect(newStep('perceive', steps).id).toBe('perceive_2');
	expect(newStep('browser', steps).id).toBe('browser_1');
	// A different type does not occupy this type's namespace.
	expect(newStep('perceive', [step('branch_1'), step('branch_2')]).id).toBe('perceive_1');
});

test('newStep seeds a perceive step with a local backend and one editable question', () => {
	const created = newStep('perceive', []);
	expect(created).toMatchObject({
		id: 'perceive_1',
		type: 'perceive',
		backend: 'local:npu',
		state: { message: 'Enter text here' },
		questions: { relevant: { type: 'noul', instructions: 'Does `message` ask for help?' } }
	});
});

test('newStep binds the first string-typed workflow input and ignores the rest', () => {
	expect(newStep('perceive', [], { q: { type: 'string' }, n: { type: 'number' } })).toMatchObject({
		state: { message: { $input: 'q' } }
	});
	// Naming order decides, not the input's own name.
	expect(newStep('perceive', [], { n: { type: 'number' }, q: { type: 'string' } })).toMatchObject({
		state: { message: { $input: 'q' } }
	});
	expect(newStep('perceive', [], { n: { type: 'number' }, z: null })).toMatchObject({
		state: { message: 'Enter text here' }
	});
});

test('newStep derives a branch gate from the last perceive question type', () => {
	const choice = newStep('branch', [
		step('ask', 'perceive', { questions: { pick: { type: 'choice' } } })
	]);
	expect(choice.condition).toEqual({
		step: 'ask',
		question: 'pick',
		field: 'probability',
		op: 'gte',
		value: 0.85
	});
	const score = newStep('branch', [
		step('ask', 'perceive', { questions: { rate: { type: 'score' } } })
	]);
	expect(score.condition).toMatchObject({ question: 'rate', field: 'score' });
	const noul = newStep('branch', [
		step('ask', 'perceive', { questions: { yes: { type: 'noul' } } })
	]);
	expect(noul.condition).toMatchObject({ question: 'yes', field: 'noul' });
});

test('newStep branches on the last perceive step, and starts disconnected when there is none', () => {
	const created = newStep('branch', [
		step('first', 'perceive', { questions: { a: { type: 'score' } } }),
		step('second', 'perceive', { questions: { b: { type: 'noul' } } })
	]);
	expect(created.condition).toMatchObject({ step: 'second', question: 'b' });
	expect(created).toMatchObject({ then: 'end', else: 'end' });

	expect(newStep('branch', [step('say', 'browser')]).condition).toEqual({
		step: '',
		question: '',
		field: 'noul',
		op: 'gte',
		value: 0.85
	});
});

test('newStep gives every type the shape the canvas inspector edits', () => {
	expect(newStep('document_preview', [])).toMatchObject({
		backend: 'local:npu',
		filename: 'document.txt',
		text: 'Enter text here'
	});
	expect(newStep('browser', [])).toMatchObject({ recipe: 'google_search', query: 'rahmanef.com' });
	expect(newStep('browser', [], { q: { type: 'string' } })).toMatchObject({
		query: { $input: 'q' }
	});
	// An unlisted type still gets a usable local step rather than a bare object.
	expect(newStep('windows_hint', [])).toEqual({
		id: 'windows_hint_1',
		type: 'windows_hint',
		backend: 'local:npu'
	});
});

test('newStep points a save at the last preview, and at an empty id when there is none', () => {
	expect(
		newStep('document_save', [
			step('preview_a', 'document_preview'),
			step('preview_b', 'document_preview')
		])
	).toMatchObject({ preview_id: { $step: 'preview_b', path: ['preview_id'] } });
	// Documented ceiling: with no preview the reference is the empty string, which the inspector
	// renders as nothing. Pinned rather than changed: the canvas only ever appends, so the
	// shipped path always has a preview, and the server decides what an empty `$step` means.
	expect(newStep('document_save', [])).toMatchObject({
		preview_id: { $step: '', path: ['preview_id'] }
	});
});

test('newStep does not mutate the step list it was given', () => {
	const steps = [step('perceive_1')];
	const snapshot = structuredClone(steps);
	newStep('perceive', steps, { q: { type: 'string' } });
	expect(steps).toEqual(snapshot);
});

test('stepDependents finds a node referenced by then, else or a nested value', () => {
	const steps = [
		step('target'),
		step('branch', 'branch', { then: 'target', else: 'end' }),
		step('save', 'document_save', { preview_id: { $step: 'target', path: ['preview_id'] } }),
		step('deep', 'browser', { args: { list: [{ inner: { $step: 'target' } }] } }),
		step('other', 'perceive', { state: { message: { $step: 'someone_else' } } })
	];
	expect(stepDependents(steps, 'target')).toEqual(['branch', 'save', 'deep']);
});

test('stepDependents never reports the node itself, however it refers to itself', () => {
	const steps = [step('target', 'branch', { then: 'target', else: 'target' })];
	expect(stepDependents(steps, 'target')).toEqual([]);
});

test('stepDependents reports both sides of a cycle, and every repeat of the same edge once', () => {
	const steps = [
		step('a', 'branch', { then: 'b', else: 'b' }),
		step('b', 'branch', { then: 'a', else: 'end' })
	];
	expect(stepDependents(steps, 'a')).toEqual(['b']);
	expect(stepDependents(steps, 'b')).toEqual(['a']);
});

test('stepDependents ignores an id nothing refers to, and a plain field named like one', () => {
	expect(stepDependents([step('a'), step('b')], 'a')).toEqual([]);
	// A string value equal to the id is data, not a reference.
	expect(
		stepDependents([step('a'), step('b', 'browser', { query: 'a', label: { text: 'a' } })], 'a')
	).toEqual([]);
});

test('stepDependents walks deeply nested references without losing them', () => {
	let nested: Record<string, unknown> = { $step: 'target' };
	for (let depth = 0; depth < 200; depth++) nested = { list: [nested] };
	expect(
		stepDependents([step('target'), step('deep', 'browser', { args: nested })], 'target')
	).toEqual(['deep']);
});

test('stepDependents tolerates a value that is not an object at all', () => {
	const steps = [step('target'), step('b', 'browser', { args: [null, 1, 'x', true, undefined] })];
	expect(stepDependents(steps, 'target')).toEqual([]);
});

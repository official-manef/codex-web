import { describe, expect, test } from 'vitest';
import { chunkCalls, MAX_TOOL_CONCURRENCY, runBounded, type Call } from './tools_parallel';

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('MAX_TOOL_CONCURRENCY', () => {
	test('is bounded to 2', () => {
		expect(MAX_TOOL_CONCURRENCY).toBe(2);
	});
});

describe('chunkCalls', () => {
	test('chunkCalls with 5 items and limit 2 gives [2,2,1]', () => {
		const items = [1, 2, 3, 4, 5];
		const chunks = chunkCalls(items, 2);
		expect(chunks.map((c) => c.length)).toEqual([2, 2, 1]);
		expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
	});

	test('limit 0 behaves as 1', () => {
		const items = ['a', 'b', 'c'];
		const chunks = chunkCalls(items, 0);
		expect(chunks.map((c) => c.length)).toEqual([1, 1, 1]);
		expect(chunks).toEqual([['a'], ['b'], ['c']]);
	});

	test('empty input returns []', () => {
		expect(chunkCalls([], 2)).toEqual([]);
		expect(chunkCalls([], 0)).toEqual([]);
	});

	test('input not mutated', () => {
		const items = [10, 20, 30, 40];
		const copy = [...items];
		const frozen = Object.freeze([...items]);

		const chunks = chunkCalls(items, 2);
		expect(items).toEqual(copy);

		const frozenChunks = chunkCalls(frozen, 2);
		expect(frozen).toEqual(copy);
		expect(chunks).toEqual(frozenChunks);
	});
});

describe('runBounded', () => {
	test('preserves order when the second item resolves first (use explicit delays with setTimeout)', async () => {
		const completionOrder: number[] = [];
		const items = [50, 10];

		const { results, errors } = await runBounded(items, 2, async (delayMs, index) => {
			await delay(delayMs);
			completionOrder.push(index);
			return `item-${index}`;
		});

		expect(completionOrder).toEqual([1, 0]);
		expect(results).toEqual(['item-0', 'item-1']);
		expect(errors).toBe(0);
	});

	test('a rejecting worker yields errors: 1 and does not reject the whole call', async () => {
		const items = ['ok-task', 'failing-task'];

		const outcome = await runBounded(items, 2, async (task) => {
			if (task === 'failing-task') {
				throw new Error('boom');
			}
			return `result:${task}`;
		});

		expect(outcome.errors).toBe(1);
		expect(outcome.results).toEqual(['result:ok-task', undefined]);
	});

	test('errors counts multiple failures', async () => {
		const items = [1, 2, 3, 4, 5];

		const outcome = await runBounded(items, 2, async (item) => {
			if (item % 2 === 1) {
				throw new Error(`odd failure: ${item}`);
			}
			return item * 10;
		});

		expect(outcome.errors).toBe(3);
		expect(outcome.results).toEqual([undefined, 20, undefined, 40, undefined]);
	});

	test('results stay index-aligned after a failure', async () => {
		const calls: Call[] = [
			{ name: 'read_file', args: { path: 'a.txt' } },
			{ name: 'exec', args: { argv: ['failing'] } },
			{ name: 'write_file', args: { path: 'b.txt' } },
			{ name: 'read_file', args: { path: 'c.txt' } }
		];

		const outcome = await runBounded(calls, 2, async (call, idx) => {
			if (idx === 1) {
				return Promise.reject(new Error('command failed'));
			}
			return { callName: call.name, index: idx };
		});

		expect(outcome.errors).toBe(1);
		expect(outcome.results).toHaveLength(4);
		expect(outcome.results[0]).toEqual({ callName: 'read_file', index: 0 });
		expect(outcome.results[1]).toBeUndefined();
		expect(outcome.results[2]).toEqual({ callName: 'write_file', index: 2 });
		expect(outcome.results[3]).toEqual({ callName: 'read_file', index: 3 });
	});

	test('runBounded with an empty list returns { results: [], errors: 0 }', async () => {
		const outcome = await runBounded([], 2, async () => {
			return 'never';
		});

		expect(outcome).toEqual({ results: [], errors: 0 });
	});
});

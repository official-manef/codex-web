// Concurrency inside one loop step, not parallel chats; two at a time, and a caller that needs more must justify it against the bridge's own connection cap.

export type Call = { name: string; args: Record<string, unknown> };

export const MAX_TOOL_CONCURRENCY = 2;

export function chunkCalls<T>(calls: readonly T[], maxConcurrent: number): T[][] {
	const step = maxConcurrent < 1 ? 1 : Math.floor(maxConcurrent);
	const chunks: T[][] = [];
	for (let i = 0; i < calls.length; i += step) {
		chunks.push(calls.slice(i, i + step));
	}
	return chunks;
}

export async function runBounded<T>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<unknown>
): Promise<{ results: unknown[]; errors: number }> {
	if (items.length === 0) {
		return { results: [], errors: 0 };
	}

	const chunks = chunkCalls(items, limit);
	const results: unknown[] = [];
	let errors = 0;
	let currentIndex = 0;

	for (const chunk of chunks) {
		const startIndex = currentIndex;
		const settled = await Promise.allSettled(
			chunk.map(async (item, offset) => {
				return await worker(item, startIndex + offset);
			})
		);

		for (const outcome of settled) {
			if (outcome.status === 'fulfilled') {
				results.push(outcome.value);
			} else {
				results.push(undefined);
				errors += 1;
			}
		}

		currentIndex += chunk.length;
	}

	return { results, errors };
}

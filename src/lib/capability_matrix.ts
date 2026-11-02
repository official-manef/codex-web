// This counts what the tree can prove, not what a competitor can do.

export type State = 'present' | 'absent' | 'unproven';

export type Row = {
	id: string;
	label: string;
	state: State;
	evidence: string;
};

export function summarise(rows: Row[]): {
	present: number;
	absent: number;
	unproven: number;
	percentReachable: number;
} {
	let present = 0;
	let absent = 0;
	let unproven = 0;

	for (const row of rows) {
		if (row.state === 'present') {
			present++;
		} else if (row.state === 'absent') {
			absent++;
		} else if (row.state === 'unproven') {
			unproven++;
		}
	}

	const reachable = present + absent;
	const percentReachable = reachable === 0 ? 0 : Math.round((present / reachable) * 100 * 10) / 10;

	return {
		present,
		absent,
		unproven,
		percentReachable
	};
}

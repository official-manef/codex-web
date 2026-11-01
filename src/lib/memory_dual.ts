// This computes a plan; it does not write, and nothing here touches Convex.

import type { MemoryRow } from './memory_client';

export type DualWrite = { enabled: boolean };

export const DUAL_WRITE_FLAG = 'MEMORY_DUAL_WRITE';

export function shouldDualWrite(flag: string | undefined, signedIn: boolean): DualWrite {
	return { enabled: flag === 'true' && signedIn === true };
}

function normalise(text: string): string {
	return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isValidRow(row: unknown): row is MemoryRow {
	if (!row || typeof row !== 'object') return false;
	const candidate = row as Partial<MemoryRow>;
	if (typeof candidate.id !== 'string' || !candidate.id.trim()) return false;
	if (typeof candidate.text !== 'string' || !candidate.text.trim()) return false;
	return true;
}

export function reconcile(
	local: MemoryRow[],
	cloud: MemoryRow[]
): { toCloud: MemoryRow[]; toLocal: MemoryRow[]; conflicts: MemoryRow[] } {
	const validLocal = Array.isArray(local) ? local.filter(isValidRow) : [];
	const validCloud = Array.isArray(cloud) ? cloud.filter(isValidRow) : [];

	const cloudTexts = new Set(validCloud.map((c) => normalise(c.text)));
	const localTexts = new Set(validLocal.map((l) => normalise(l.text)));

	const toCloud: MemoryRow[] = validLocal.filter((l) => !cloudTexts.has(normalise(l.text)));
	const toLocal: MemoryRow[] = validCloud.filter((c) => !localTexts.has(normalise(c.text)));

	const conflicts: MemoryRow[] = [];
	const seenConflictTexts = new Set<string>();

	for (const l of validLocal) {
		const norm = normalise(l.text);
		if (seenConflictTexts.has(norm)) continue;
		const matchingCloud = validCloud.filter((c) => normalise(c.text) === norm);
		if (matchingCloud.length > 0 && matchingCloud.some((c) => c.id !== l.id)) {
			seenConflictTexts.add(norm);
			conflicts.push(l);
		}
	}

	return { toCloud, toLocal, conflicts };
}

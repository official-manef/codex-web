export type MemoryRow = { id: string; text: string; createdAt: number };
export type MemorySource = 'cloud' | 'local';
export type MergeResult = { rows: MemoryRow[]; source: MemorySource; droppedLocal: number };

export const MAX_MEMORIES = 50;
export const MAX_TEXT_CHARS = 400;
export const MAX_CONTEXT_CHARS = 2000;

/** Cloud wins when it has rows; local is used only when cloud is empty, and never merged twice. */
export function mergeMemories(cloud: MemoryRow[] | null, local: MemoryRow[]): MergeResult {
	if (cloud === null || cloud.length === 0) {
		return {
			rows: local,
			source: 'local',
			droppedLocal: 0
		};
	}
	const cloudTexts = new Set(cloud.map((c) => c.text.trim()));
	const droppedLocal = local.filter((l) => !cloudTexts.has(l.text.trim())).length;
	return {
		rows: cloud,
		source: 'cloud',
		droppedLocal
	};
}

/** Bounded prompt block; identical shape to `memoryStore.context()`. */
export function contextBlock(rows: MemoryRow[], maxChars = MAX_CONTEXT_CHARS): string {
	if (typeof maxChars !== 'number' || Number.isNaN(maxChars) || maxChars <= 0) return '';
	if (!Array.isArray(rows) || rows.length === 0) return '';
	const lines: string[] = [];
	let currentLen = 0;
	for (const memory of rows) {
		const rawText = memory?.text;
		if (typeof rawText !== 'string') continue;
		const clean = rawText.trim().replace(/\s+/g, ' ');
		if (!clean || clean.length > MAX_TEXT_CHARS) continue;
		const line = `- ${clean}`;
		const addedLen = lines.length === 0 ? line.length : 1 + line.length;
		if (currentLen + addedLen > maxChars) break;
		lines.push(line);
		currentLen += addedLen;
	}
	return lines.join('\n');
}

export function toMemoryRows(raw: unknown): MemoryRow[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: MemoryRow[] = [];
	for (const row of raw) {
		if (!row || typeof row !== 'object') continue;
		const rawId = (row as { id?: unknown; _id?: unknown }).id ?? (row as { _id?: unknown })._id;
		if (typeof rawId !== 'string' || !rawId.trim() || seen.has(rawId)) continue;
		const rawText = (row as { text?: unknown }).text;
		if (typeof rawText !== 'string') continue;
		const text = rawText.trim();
		if (!text || text.length > MAX_TEXT_CHARS) continue;
		const rawCreatedAt = (row as { createdAt?: unknown }).createdAt;
		const createdAt =
			typeof rawCreatedAt === 'number' && Number.isFinite(rawCreatedAt) ? rawCreatedAt : 0;
		seen.add(rawId);
		out.push({
			id: rawId,
			text,
			createdAt
		});
		if (out.length >= MAX_MEMORIES) break;
	}
	return out;
}

export type ProjectFile = { path: string; bytes: number };
export type ProjectDetail = { instructions: string; files: ProjectFile[] };

export const MAX_INSTRUCTIONS = 2000;
export const MAX_PROJECT_FILES = 20;

/**
 * Validates a project file path.
 *
 * NOTE: This is a label, not a filesystem path: nothing is read from disk (no `fs.read`),
 * and a project is never a permission.
 */
export function cleanProjectPath(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	if (value.length < 1 || value.length > 300) return null;
	if (value.startsWith('/')) return null;
	if (!/^[A-Za-z0-9._/-]+$/.test(value)) return null;
	if (value.split('/').includes('..')) return null;
	return value;
}

/**
 * Validates untrusted input into a sanitized ProjectDetail.
 * Returns null for non-objects; never throws.
 */
export function parseDetail(value: unknown): ProjectDetail | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const obj = value as Record<string, unknown>;

	let instructions = '';
	if (typeof obj.instructions === 'string') {
		instructions = obj.instructions.trim().slice(0, MAX_INSTRUCTIONS);
	}

	const files: ProjectFile[] = [];
	if (Array.isArray(obj.files)) {
		const seen = new Set<string>();
		for (const item of obj.files) {
			if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
			const fileObj = item as Record<string, unknown>;
			const cleanPath = cleanProjectPath(fileObj.path);
			if (!cleanPath) continue;
			const bytes = fileObj.bytes;
			if (
				typeof bytes !== 'number' ||
				!Number.isFinite(bytes) ||
				bytes < 0 ||
				!Number.isInteger(bytes)
			) {
				continue;
			}
			if (seen.has(cleanPath)) continue;
			seen.add(cleanPath);
			files.push({ path: cleanPath, bytes });
			if (files.length >= MAX_PROJECT_FILES) break;
		}
	}

	return { instructions, files };
}

/**
 * Applies a partial patch over a base ProjectDetail.
 * Invalid fields in the patch are ignored, preserving base values.
 */
export function mergeDetail(base: ProjectDetail, patch: unknown): ProjectDetail {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
		return {
			instructions: base.instructions,
			files: base.files.map((f) => ({ ...f }))
		};
	}
	const obj = patch as Record<string, unknown>;

	let instructions = base.instructions;
	if (typeof obj.instructions === 'string') {
		instructions = obj.instructions.trim().slice(0, MAX_INSTRUCTIONS);
	}

	let files = base.files.map((f) => ({ ...f }));
	if (Array.isArray(obj.files)) {
		const nextFiles: ProjectFile[] = [];
		const seen = new Set<string>();
		for (const item of obj.files) {
			if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
			const fileObj = item as Record<string, unknown>;
			const cleanPath = cleanProjectPath(fileObj.path);
			if (!cleanPath) continue;
			const bytes = fileObj.bytes;
			if (
				typeof bytes !== 'number' ||
				!Number.isFinite(bytes) ||
				bytes < 0 ||
				!Number.isInteger(bytes)
			) {
				continue;
			}
			if (seen.has(cleanPath)) continue;
			seen.add(cleanPath);
			nextFiles.push({ path: cleanPath, bytes });
			if (nextFiles.length >= MAX_PROJECT_FILES) break;
		}
		files = nextFiles;
	}

	return { instructions, files };
}

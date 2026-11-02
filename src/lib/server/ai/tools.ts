import { decisionFor, isAllowed, type PolicyDecision, type PolicyVerb } from '../policy';

export type ToolName = 'read_file' | 'write_file' | 'apply_patch' | 'exec';
export type ToolRequest = { name: ToolName; args: Record<string, unknown> };
export type ToolOutcome = { ok: true; text: string } | { ok: false; error: string };
export type ToolDeps = {
	policy: Record<PolicyVerb, PolicyDecision>;
	exec: (argv: string[]) => Promise<{ code: number; stdout: string }>;
	readFile: (path: string) => Promise<string>;
	writeFile: (path: string, text: string) => Promise<void>;
	applyPatch?: (patch: string) => Promise<{ applied: number; rejected: number }>;
};

export const TOOL_MAP: Record<ToolName, PolicyVerb> = {
	read_file: 'read_file',
	write_file: 'write_file',
	apply_patch: 'apply_patch',
	exec: 'exec'
};

const MAX_PATH_LENGTH = 200;
const MAX_TEXT_LENGTH = 200_000;
const MAX_PATCH_LENGTH = 200_000;
const MAX_EXEC_ARGV_ENTRIES = 32;
const MAX_EXEC_ARG_LENGTH = 200;
const MAX_OUTPUT_CHARS = 8_000;
/**
 * Per-step ceiling on tool calls a model may trigger. Tool results are pushed back into the next
 * request, so an uncapped count lets the model grow its own context for eight steps.
 */
export const MAX_TOOL_CALLS_PER_STEP = 8;
const TRUNCATION_MARKER = '\n[truncated]';

export const TOOL_SPECS: readonly {
	name: ToolName;
	description: string;
	parameters: Record<string, unknown>;
}[] = [
	{
		name: 'read_file',
		description: 'Read the contents of a repository file within permitted paths.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Relative path to the file to read (max 200 characters, no .. or NUL).'
				}
			},
			required: ['path'],
			additionalProperties: false
		}
	},
	{
		name: 'write_file',
		description: 'Write text to a repository file within permitted paths.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Relative path to the file to write (max 200 characters, no .. or NUL).'
				},
				text: {
					type: 'string',
					description: 'Text content to write to the file (max 200,000 characters).'
				}
			},
			required: ['path', 'text'],
			additionalProperties: false
		}
	},
	{
		name: 'apply_patch',
		description: 'Apply a unified diff patch to the repository.',
		parameters: {
			type: 'object',
			properties: {
				patch: {
					type: 'string',
					description: 'Unified diff patch content to apply (max 200,000 characters).'
				}
			},
			required: ['patch'],
			additionalProperties: false
		}
	},
	{
		name: 'exec',
		description:
			'Execute a command directly without a shell using an argument vector. Never runs a shell.',
		parameters: {
			type: 'object',
			properties: {
				argv: {
					type: 'array',
					items: {
						type: 'string'
					},
					description:
						'Command and arguments array (1 to 32 entries, each max 200 characters). Must not be a shell string.'
				}
			},
			required: ['argv'],
			additionalProperties: false
		}
	}
] as const;

const VALID_TOOL_NAMES = new Set<ToolName>(['read_file', 'write_file', 'apply_patch', 'exec']);

function containsFunction(val: unknown): boolean {
	if (typeof val === 'function') return true;
	if (val && typeof val === 'object') {
		if (Array.isArray(val)) {
			return val.some(containsFunction);
		}
		for (const key of Object.keys(val)) {
			if (containsFunction((val as Record<string, unknown>)[key])) {
				return true;
			}
		}
	}
	return false;
}

export function parseToolRequest(value: unknown): ToolRequest | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.name !== 'string' || !VALID_TOOL_NAMES.has(candidate.name as ToolName)) {
		return null;
	}
	const args = candidate.args;
	if (
		!args ||
		typeof args !== 'object' ||
		Array.isArray(args) ||
		Object.prototype.toString.call(args) !== '[object Object]'
	) {
		return null;
	}
	if (containsFunction(args)) {
		return null;
	}
	return {
		name: candidate.name as ToolName,
		args: args as Record<string, unknown>
	};
}

function truncate(text: string, limit = MAX_OUTPUT_CHARS): string {
	if (text.length <= limit) {
		return text;
	}
	return text.slice(0, limit) + TRUNCATION_MARKER;
}

function validatePath(
	path: unknown
): { valid: true; path: string } | { valid: false; error: string } {
	if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH) {
		return {
			valid: false,
			error: `Path must be a non-empty string up to ${MAX_PATH_LENGTH} characters.`
		};
	}
	if (path.includes('..') || path.includes('\0')) {
		return {
			valid: false,
			error: 'Path must not contain traversal ("..") or NUL characters.'
		};
	}
	return { valid: true, path };
}

/**
 * Execute a tool operation bounded by approval policy, parameter caps, and runtime dependencies.
 *
 * Security boundary notes:
 * - Policy is always checked first. When decision is not 'allow', dependencies are never called.
 * - 'exec' takes an argv array and never invokes a shell; shell metacharacters have no shell to evaluate them.
 * - Dep errors are caught and converted to flat generic errors without leaking file contents or sensitive details.
 */
export async function runTool(request: ToolRequest, deps: ToolDeps): Promise<ToolOutcome> {
	const verb = TOOL_MAP[request.name];
	if (!verb) {
		return { ok: false, error: 'Unknown tool.' };
	}

	if (!isAllowed(deps.policy, verb)) {
		const decision = decisionFor(deps.policy, verb);
		if (decision === 'ask') {
			return { ok: false, error: `This action needs approval and none was granted: ${verb}.` };
		}
		return { ok: false, error: `Denied by policy: ${verb}.` };
	}

	try {
		switch (request.name) {
			case 'read_file': {
				const pathCheck = validatePath(request.args.path);
				if (!pathCheck.valid) {
					return { ok: false, error: pathCheck.error };
				}
				const content = await deps.readFile(pathCheck.path);
				return { ok: true, text: truncate(content) };
			}
			case 'write_file': {
				const pathCheck = validatePath(request.args.path);
				if (!pathCheck.valid) {
					return { ok: false, error: pathCheck.error };
				}
				const text = request.args.text;
				if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH) {
					return {
						ok: false,
						error: 'Text must be a string up to 200,000 characters.'
					};
				}
				await deps.writeFile(pathCheck.path, text);
				const byteCount = new TextEncoder().encode(text).length;
				return { ok: true, text: `Wrote ${byteCount} bytes to ${pathCheck.path}.` };
			}
			case 'apply_patch': {
				if (!deps.applyPatch) {
					return { ok: false, error: 'apply_patch is not available on this runtime.' };
				}
				const patch = request.args.patch;
				if (typeof patch !== 'string' || patch.length === 0 || patch.length > MAX_PATCH_LENGTH) {
					return {
						ok: false,
						error: 'Patch must be a non-empty string up to 200,000 characters.'
					};
				}
				const result = await deps.applyPatch(patch);
				return {
					ok: true,
					text: `Applied ${result.applied} hunk(s), ${result.rejected} rejected.`
				};
			}
			case 'exec': {
				const rawArgv = request.args.argv;
				if (typeof rawArgv === 'string' || typeof request.args.command === 'string') {
					return {
						ok: false,
						error:
							'exec does not accept shell strings; pass an argv array. exec never runs a shell.'
					};
				}
				if (
					!Array.isArray(rawArgv) ||
					rawArgv.length === 0 ||
					rawArgv.length > MAX_EXEC_ARGV_ENTRIES
				) {
					return {
						ok: false,
						error: `argv must be an array of 1 to ${MAX_EXEC_ARGV_ENTRIES} strings.`
					};
				}
				for (const arg of rawArgv) {
					if (typeof arg !== 'string' || arg.length > MAX_EXEC_ARG_LENGTH) {
						return {
							ok: false,
							error: `Each argv entry must be a string up to ${MAX_EXEC_ARG_LENGTH} characters.`
						};
					}
				}
				const res = await deps.exec(rawArgv);
				const truncated = truncate(res.stdout ?? '');
				const outputText =
					truncated.length > 0 ? `Exit code ${res.code}:\n${truncated}` : `Exit code ${res.code}`;
				return { ok: true, text: outputText };
			}
		}
	} catch {
		return { ok: false, error: `Failed to execute ${request.name}.` };
	}
}

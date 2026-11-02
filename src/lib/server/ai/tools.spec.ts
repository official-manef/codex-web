import { describe, expect, test, vi } from 'vitest';
import type { PolicyDecision, PolicyVerb } from '../policy';
import {
	MAX_TOOL_CALLS_PER_STEP,
	parseToolRequest,
	runTool,
	TOOL_MAP,
	TOOL_SPECS,
	type ToolDeps,
	type ToolRequest
} from './tools';

function makeDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
	return {
		policy: {
			read_file: 'allow',
			write_file: 'allow',
			apply_patch: 'allow',
			exec: 'allow',
			git_diff: 'deny',
			git_stage: 'deny',
			git_commit: 'deny',
			git_worktree: 'deny',
			mcp_app: 'deny'
		},
		exec: vi.fn(async () => ({ code: 0, stdout: 'ok' })),
		readFile: vi.fn(async () => 'file content'),
		writeFile: vi.fn(async () => undefined),
		applyPatch: vi.fn(async () => ({ applied: 1, rejected: 0 })),
		...overrides
	};
}

describe('TOOL_MAP and TOOL_SPECS', () => {
	test('TOOL_MAP correctly maps all tool names to policy verbs', () => {
		expect(TOOL_MAP).toEqual({
			read_file: 'read_file',
			write_file: 'write_file',
			apply_patch: 'apply_patch',
			exec: 'exec'
		});
	});

	test('TOOL_SPECS provides valid OpenAI-style tool schema definitions', () => {
		expect(TOOL_SPECS).toHaveLength(4);
		for (const spec of TOOL_SPECS) {
			expect(typeof spec.name).toBe('string');
			expect(typeof spec.description).toBe('string');
			expect(spec.parameters.type).toBe('object');
			expect(spec.parameters.additionalProperties).toBe(false);
			expect(Array.isArray(spec.parameters.required)).toBe(true);
			expect(typeof spec.parameters.properties).toBe('object');
		}
	});

	test('the per-step tool-call cap is a small positive ceiling, not a no-op', () => {
		// Results are fed back into the next request, so the number must be a real bound.
		expect(Number.isInteger(MAX_TOOL_CALLS_PER_STEP)).toBe(true);
		expect(MAX_TOOL_CALLS_PER_STEP).toBeGreaterThan(0);
		expect(MAX_TOOL_CALLS_PER_STEP).toBeLessThanOrEqual(16);
	});
});

describe('parseToolRequest', () => {
	test('rejects non-object or null input without throwing', () => {
		expect(parseToolRequest(null)).toBeNull();
		expect(parseToolRequest(undefined)).toBeNull();
		expect(parseToolRequest('read_file')).toBeNull();
		expect(parseToolRequest(42)).toBeNull();
		expect(parseToolRequest(true)).toBeNull();
		expect(parseToolRequest([])).toBeNull();
	});

	test('rejects missing name', () => {
		expect(parseToolRequest({ args: {} })).toBeNull();
	});

	test('rejects bad name', () => {
		expect(parseToolRequest({ name: 'delete_file', args: {} })).toBeNull();
		expect(parseToolRequest({ name: 'spawn_agent', args: {} })).toBeNull();
		expect(parseToolRequest({ name: '', args: {} })).toBeNull();
	});

	test('rejects args array', () => {
		expect(parseToolRequest({ name: 'read_file', args: ['path'] })).toBeNull();
	});

	test('rejects args null or missing', () => {
		expect(parseToolRequest({ name: 'read_file', args: null })).toBeNull();
		expect(parseToolRequest({ name: 'read_file' })).toBeNull();
	});

	test('rejects args containing a function', () => {
		expect(
			parseToolRequest({
				name: 'read_file',
				args: {
					path: 'test.txt',
					callback: () => undefined
				}
			})
		).toBeNull();

		expect(
			parseToolRequest({
				name: 'exec',
				args: {
					argv: ['node', () => undefined]
				}
			})
		).toBeNull();

		expect(
			parseToolRequest({
				name: 'write_file',
				args: {
					path: 'test.txt',
					deep: { nested: () => 'evil' }
				}
			})
		).toBeNull();
	});

	test('accepts valid requests for each tool', () => {
		expect(parseToolRequest({ name: 'read_file', args: { path: 'a.txt' } })).toEqual({
			name: 'read_file',
			args: { path: 'a.txt' }
		});
		expect(parseToolRequest({ name: 'write_file', args: { path: 'a.txt', text: 'hi' } })).toEqual({
			name: 'write_file',
			args: { path: 'a.txt', text: 'hi' }
		});
		expect(parseToolRequest({ name: 'apply_patch', args: { patch: 'diff' } })).toEqual({
			name: 'apply_patch',
			args: { patch: 'diff' }
		});
		expect(parseToolRequest({ name: 'exec', args: { argv: ['echo', '1'] } })).toEqual({
			name: 'exec',
			args: { argv: ['echo', '1'] }
		});
	});
});

describe('runTool - policy enforcement', () => {
	test('policy deny blocks before the dep is called and returns flat error', async () => {
		const readFile = vi.fn(async () => 'content');
		const deps = makeDeps({
			policy: {
				...makeDeps().policy,
				read_file: 'deny'
			},
			readFile
		});

		const req: ToolRequest = { name: 'read_file', args: { path: 'file.txt' } };
		const res = await runTool(req, deps);

		expect(res).toEqual({ ok: false, error: 'Denied by policy: read_file.' });
		expect(readFile).not.toHaveBeenCalled();
	});

	test('missing policy verb defaults to deny and blocks before dep is called', async () => {
		const exec = vi.fn(async () => ({ code: 0, stdout: '' }));
		const deps = makeDeps({
			policy: {} as Record<PolicyVerb, PolicyDecision>,
			exec
		});

		const req: ToolRequest = { name: 'exec', args: { argv: ['pwd'] } };
		const res = await runTool(req, deps);

		expect(res).toEqual({ ok: false, error: 'Denied by policy: exec.' });
		expect(exec).not.toHaveBeenCalled();
	});

	test('policy ask also blocks before dep is called with approval message', async () => {
		const writeFile = vi.fn(async () => undefined);
		const deps = makeDeps({
			policy: {
				...makeDeps().policy,
				write_file: 'ask'
			},
			writeFile
		});

		const req: ToolRequest = { name: 'write_file', args: { path: 'file.txt', text: 'hello' } };
		const res = await runTool(req, deps);

		expect(res).toEqual({
			ok: false,
			error: 'This action needs approval and none was granted: write_file.'
		});
		expect(writeFile).not.toHaveBeenCalled();
	});

	test('policy allow proceeds to run the tool dep', async () => {
		const readFile = vi.fn(async () => 'hello world');
		const deps = makeDeps({ readFile });

		const req: ToolRequest = { name: 'read_file', args: { path: 'file.txt' } };
		const res = await runTool(req, deps);

		expect(res).toEqual({ ok: true, text: 'hello world' });
		expect(readFile).toHaveBeenCalledWith('file.txt');
	});
});

describe('runTool - read_file', () => {
	test('refuses path traversal with ../etc/passwd', async () => {
		const readFile = vi.fn(async () => 'content');
		const deps = makeDeps({ readFile });

		const req: ToolRequest = { name: 'read_file', args: { path: '../etc/passwd' } };
		const res = await runTool(req, deps);

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain('traversal');
		}
		expect(readFile).not.toHaveBeenCalled();
	});

	test('refuses path with NUL character', async () => {
		const readFile = vi.fn(async () => 'content');
		const deps = makeDeps({ readFile });

		const req: ToolRequest = { name: 'read_file', args: { path: 'foo\0bar.txt' } };
		const res = await runTool(req, deps);

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain('NUL');
		}
		expect(readFile).not.toHaveBeenCalled();
	});

	test('refuses path exceeding 200 characters', async () => {
		const readFile = vi.fn(async () => 'content');
		const deps = makeDeps({ readFile });

		const longPath = 'a'.repeat(201);
		const req: ToolRequest = { name: 'read_file', args: { path: longPath } };
		const res = await runTool(req, deps);

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain('200');
		}
		expect(readFile).not.toHaveBeenCalled();
	});

	test('truncates file content larger than 8,000 characters', async () => {
		const hugeContent = 'a'.repeat(10_000);
		const readFile = vi.fn(async () => hugeContent);
		const deps = makeDeps({ readFile });

		const req: ToolRequest = { name: 'read_file', args: { path: 'large.txt' } };
		const res = await runTool(req, deps);

		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.text.startsWith('a'.repeat(8000))).toBe(true);
			expect(res.text.endsWith('\n[truncated]')).toBe(true);
		}
	});
});

describe('runTool - write_file', () => {
	test('refuses path traversal in write_file', async () => {
		const writeFile = vi.fn(async () => undefined);
		const deps = makeDeps({ writeFile });

		const req: ToolRequest = {
			name: 'write_file',
			args: { path: '../../evil.txt', text: 'payload' }
		};
		const res = await runTool(req, deps);

		expect(res.ok).toBe(false);
		expect(writeFile).not.toHaveBeenCalled();
	});

	test('refuses oversized text (> 200,000 characters)', async () => {
		const writeFile = vi.fn(async () => undefined);
		const deps = makeDeps({ writeFile });

		const hugeText = 'x'.repeat(200_001);
		const req: ToolRequest = {
			name: 'write_file',
			args: { path: 'valid.txt', text: hugeText }
		};
		const res = await runTool(req, deps);

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain('200,000');
		}
		expect(writeFile).not.toHaveBeenCalled();
	});

	test('returns confirmation with byte count and never echoes content back', async () => {
		const writeFile = vi.fn(async () => undefined);
		const deps = makeDeps({ writeFile });

		const content = 'Hello, world! 🌍';
		const req: ToolRequest = {
			name: 'write_file',
			args: { path: 'greeting.txt', text: content }
		};
		const res = await runTool(req, deps);

		expect(res.ok).toBe(true);
		if (res.ok) {
			const byteLength = new TextEncoder().encode(content).length;
			expect(res.text).toBe(`Wrote ${byteLength} bytes to greeting.txt.`);
			expect(res.text).not.toContain(content);
		}
		expect(writeFile).toHaveBeenCalledWith('greeting.txt', content);
	});
});

describe('runTool - apply_patch', () => {
	test('returns error when applyPatch is absent on runtime', async () => {
		const deps = makeDeps({ applyPatch: undefined });

		const req: ToolRequest = {
			name: 'apply_patch',
			args: { patch: '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n' }
		};
		const res = await runTool(req, deps);

		expect(res).toEqual({
			ok: false,
			error: 'apply_patch is not available on this runtime.'
		});
	});

	test('refuses oversized patch (> 200,000 characters)', async () => {
		const applyPatch = vi.fn(async () => ({ applied: 1, rejected: 0 }));
		const deps = makeDeps({ applyPatch });

		const hugePatch = 'p'.repeat(200_001);
		const req: ToolRequest = { name: 'apply_patch', args: { patch: hugePatch } };
		const res = await runTool(req, deps);

		expect(res.ok).toBe(false);
		expect(applyPatch).not.toHaveBeenCalled();
	});

	test('applies patch successfully and returns count', async () => {
		const applyPatch = vi.fn(async () => ({ applied: 2, rejected: 0 }));
		const deps = makeDeps({ applyPatch });

		const req: ToolRequest = { name: 'apply_patch', args: { patch: 'diff content' } };
		const res = await runTool(req, deps);

		expect(res).toEqual({
			ok: true,
			text: 'Applied 2 hunk(s), 0 rejected.'
		});
	});
});

describe('runTool - exec', () => {
	test('refuses shell strings and requires argv array', async () => {
		const exec = vi.fn(async () => ({ code: 0, stdout: '' }));
		const deps = makeDeps({ exec });

		const req: ToolRequest = {
			name: 'exec',
			args: { argv: 'rm -rf /' as unknown as string[] }
		};
		const res = await runTool(req, deps);

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain('shell');
		}
		expect(exec).not.toHaveBeenCalled();
	});

	test('refuses argv exceeding 32 entries', async () => {
		const exec = vi.fn(async () => ({ code: 0, stdout: '' }));
		const deps = makeDeps({ exec });

		const argv = Array.from({ length: 33 }, (_, i) => `arg${i}`);
		const req: ToolRequest = { name: 'exec', args: { argv } };
		const res = await runTool(req, deps);

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain('32');
		}
		expect(exec).not.toHaveBeenCalled();
	});

	test('refuses argv entry exceeding 200 characters', async () => {
		const exec = vi.fn(async () => ({ code: 0, stdout: '' }));
		const deps = makeDeps({ exec });

		const req: ToolRequest = {
			name: 'exec',
			args: { argv: ['echo', 'x'.repeat(201)] }
		};
		const res = await runTool(req, deps);

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toContain('200');
		}
		expect(exec).not.toHaveBeenCalled();
	});

	test('non-zero exit is still ok: true with code in text', async () => {
		const exec = vi.fn(async () => ({ code: 127, stdout: 'command not found' }));
		const deps = makeDeps({ exec });

		const req: ToolRequest = { name: 'exec', args: { argv: ['missing-bin'] } };
		const res = await runTool(req, deps);

		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.text).toContain('127');
			expect(res.text).toContain('command not found');
		}
	});

	test('truncates exec stdout larger than 8,000 characters', async () => {
		const hugeStdout = 'output-'.repeat(2000);
		const exec = vi.fn(async () => ({ code: 0, stdout: hugeStdout }));
		const deps = makeDeps({ exec });

		const req: ToolRequest = { name: 'exec', args: { argv: ['cat', 'huge.txt'] } };
		const res = await runTool(req, deps);

		expect(res.ok).toBe(true);
		if (res.ok) {
			expect(res.text).toContain('[truncated]');
			expect(res.text.includes(hugeStdout.slice(0, 8000))).toBe(true);
		}
	});
});

describe('runTool - thrown dep becomes flat error', () => {
	test('catches thrown error from readFile without leaking sensitive content', async () => {
		const readFile = vi.fn(async () => {
			throw new Error('Secret content leaked: SUPER_SECRET_TOKEN_123');
		});
		const deps = makeDeps({ readFile });

		const req: ToolRequest = { name: 'read_file', args: { path: 'secret.txt' } };
		const res = await runTool(req, deps);

		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error).toBe('Failed to execute read_file.');
			expect(res.error).not.toContain('SUPER_SECRET_TOKEN_123');
		}
	});

	test('catches thrown error from writeFile', async () => {
		const writeFile = vi.fn(async () => {
			throw new Error('EACCES: permission denied');
		});
		const deps = makeDeps({ writeFile });

		const req: ToolRequest = { name: 'write_file', args: { path: 'test.txt', text: 'hi' } };
		const res = await runTool(req, deps);

		expect(res).toEqual({ ok: false, error: 'Failed to execute write_file.' });
	});

	test('catches thrown error from applyPatch', async () => {
		const applyPatch = vi.fn(async () => {
			throw new Error('git error: corrupt patch');
		});
		const deps = makeDeps({ applyPatch });

		const req: ToolRequest = { name: 'apply_patch', args: { patch: 'diff' } };
		const res = await runTool(req, deps);

		expect(res).toEqual({ ok: false, error: 'Failed to execute apply_patch.' });
	});

	test('catches thrown error from exec', async () => {
		const exec = vi.fn(async () => {
			throw new Error('spawn ENOENT');
		});
		const deps = makeDeps({ exec });

		const req: ToolRequest = { name: 'exec', args: { argv: ['bad'] } };
		const res = await runTool(req, deps);

		expect(res).toEqual({ ok: false, error: 'Failed to execute exec.' });
	});
});

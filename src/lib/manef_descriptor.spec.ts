import { describe, expect, test } from 'vitest';
import {
	CONTRACT_VERSION,
	isRepoPath,
	validateModuleDescriptor,
	validateModuleProjection
} from './manef_descriptor';
import models from './manef-ai-fixtures/models.json';
import connectors from './manef-ai-fixtures/connectors.json';

/**
 * Parity proof for the zod port of `manef-ai/packages/foundation`.
 *
 * The two real descriptors from that repository are committed under
 * `src/lib/manef-ai-fixtures/` and must validate here. If this suite goes red, the port drifted from
 * the schema it claims to implement, and a descriptor the CLI accepts would be rejected by the
 * console — which is the one failure mode that makes a validator worse than none.
 */

const base = () => structuredClone(connectors) as Record<string, unknown>;

describe('real MANEF AI descriptors validate', () => {
	test.each([
		['models (library, review-candidate)', models],
		['connectors (guidance, main)', connectors]
	])('%s', (_label, descriptor) => {
		const result = validateModuleDescriptor(descriptor);
		expect(result.errors).toEqual([]);
		expect(result.ok).toBe(true);
	});
});

describe('hostile shapes are refused before any schema check', () => {
	test('a credential-shaped field name is a sensitive-field error, not a type error', () => {
		const descriptor = base();
		(descriptor as Record<string, unknown>).apiKey = 'value';
		expect(validateModuleDescriptor(descriptor)).toEqual({
			ok: false,
			errors: ['schema:# keyword:sensitive-field']
		});
	});

	test('a cycle is refused rather than overflowing the stack', () => {
		const descriptor = base();
		(descriptor as Record<string, unknown>).extensions = { loop: descriptor };
		expect(validateModuleDescriptor(descriptor).errors).toEqual(['schema:# keyword:cycle']);
	});

	test('a class instance is not JSON and is refused', () => {
		class Foreign {}
		const descriptor = base();
		(descriptor as Record<string, unknown>).extensions = new Foreign();
		expect(validateModuleDescriptor(descriptor).errors).toEqual(['schema:# keyword:type']);
	});

	test('a getter is refused: descriptors must be plain data', () => {
		const descriptor = base();
		Object.defineProperty(descriptor, 'extensions', {
			enumerable: true,
			get: () => ({})
		});
		expect(validateModuleDescriptor(descriptor).errors).toEqual(['schema:# keyword:type']);
	});

	test('a non-finite number is refused', () => {
		const descriptor = base();
		(descriptor as Record<string, unknown>).extensions = { n: Number.POSITIVE_INFINITY };
		expect(validateModuleDescriptor(descriptor).errors).toEqual(['schema:# keyword:type']);
	});
});

describe('schema constraints match the JSON schema', () => {
	test('an unknown top-level field is refused (additionalProperties: false)', () => {
		const descriptor = base();
		(descriptor as Record<string, unknown>).surprise = true;
		expect(validateModuleDescriptor(descriptor).ok).toBe(false);
	});

	test('contractVersion must be exactly 1.0.0', () => {
		const descriptor = base();
		(descriptor as Record<string, unknown>).contractVersion = '1.0.1';
		expect(validateModuleDescriptor(descriptor).ok).toBe(false);
		expect(CONTRACT_VERSION).toBe('1.0.0');
	});

	test('a module id with an underscore is refused; the pattern allows only lower kebab', () => {
		const descriptor = base();
		(descriptor as Record<string, unknown>).id = 'my_module';
		expect(validateModuleDescriptor(descriptor).ok).toBe(false);
	});

	test('an abbreviated git revision is refused', () => {
		const descriptor = base() as { source: { revision: string } };
		descriptor.source.revision = 'd4d74fd';
		expect(validateModuleDescriptor(descriptor).ok).toBe(false);
	});
});

describe('cross-field rules the schema cannot express', () => {
	test('two capabilities with the same id are refused', () => {
		const descriptor = base() as { capabilities: unknown[] };
		descriptor.capabilities = [descriptor.capabilities[0], descriptor.capabilities[0]];
		expect(validateModuleDescriptor(descriptor)).toEqual({
			ok: false,
			errors: ['schema:#/properties/capabilities keyword:unique-id']
		});
	});

	test('effects containing none must be exactly none', () => {
		const descriptor = base() as {
			capabilities: { effects: string[] }[];
		};
		descriptor.capabilities[0].effects = ['none', 'read'];
		expect(validateModuleDescriptor(descriptor)).toEqual({
			ok: false,
			errors: ['schema:#/definitions/capability/properties/effects keyword:exclusive-none']
		});
	});

	test('a duplicated effect is refused', () => {
		const descriptor = base() as {
			capabilities: { effects: string[] }[];
		};
		descriptor.capabilities[0].effects = ['read', 'read'];
		expect(validateModuleDescriptor(descriptor)).toEqual({
			ok: false,
			errors: ['schema:#/definitions/capability/properties/effects keyword:uniqueItems']
		});
	});

	test('a layout path that escapes the repo is refused', () => {
		const descriptor = base() as { layout: { source: string[] } };
		descriptor.layout.source = ['../outside'];
		// Refused by the path regex before the post-schema loop runs, exactly as ajv refuses it in
		// the original — so the assertion is that it is refused, not which of the two guards caught it.
		const result = validateModuleDescriptor(descriptor);
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toContain('#/properties/layout');
	});

	test('an absolute reference is refused', () => {
		const descriptor = base() as { capabilities: { input: { ref: string | null } }[] };
		descriptor.capabilities[0].input.ref = '/etc/passwd';
		expect(validateModuleDescriptor(descriptor).ok).toBe(false);
	});
});

describe('isRepoPath matches the foundation implementation', () => {
	test.each([
		['src', true],
		['adapters/convex', true],
		['./README.md', true],
		['docs', true],
		['src/index.ts', true],
		['../outside', false],
		['/absolute', false],
		['https://example.com/x', false],
		['a\\b', false],
		['a%2fb', false],
		['src//double', false],
		['src/./dot', false],
		// Fragments are only allowed where the caller asks for them: `input.ref`/`output.ref` pass
		// `fragment = true`, layout paths do not.
		['src/index.ts#resolveModel', false]
	])('%s -> %s', (value, expected) => {
		expect(isRepoPath(value)).toBe(expected);
	});

	test('a fragment reference is accepted only when the caller allows fragments', () => {
		expect(isRepoPath('src/index.ts#resolveModel', true)).toBe(true);
		expect(isRepoPath('src/index.ts#resolveModel')).toBe(false);
	});
});

describe('hub projection, which is what /api/modules actually sends', () => {
	/**
	 * `apps/hub/metadata.mjs#publicModule` narrows a descriptor before it goes on the wire: `layout`,
	 * `commands`, `trust` and `health` are dropped, `link`/`status`/`liveStatus` are added. This is a
	 * captured response, so the projection schema is pinned against the real shape rather than
	 * against what the descriptor schema would have accepted.
	 */
	const projection = {
		contractVersion: '1.0.0',
		id: 'models',
		name: 'Models',
		version: '0.1.0',
		kind: 'library',
		runtime: { language: 'javascript', minimumVersion: '22.6', manager: 'node' },
		source: {
			repository: 'rahmanef63/models-rahmanef-com',
			revision: 'd4d74fd84e7f1b1486a512914292e937e25f4a25',
			channel: 'review-candidate',
			link: null
		},
		capabilities: [
			{
				id: 'models.resolve',
				summary: 'Resolve a provider/model reference through the owning product.',
				input: { format: 'json-schema', ref: null },
				output: { format: 'json-schema', ref: null },
				effects: ['read'],
				requiredScopes: [],
				mode: 'product-authorized',
				risk: 'read'
			}
		],
		config: { defaultMode: 'preview', secrets: 'references-only' },
		status: 'declared',
		liveStatus: 'unconfigured'
	};

	test('a real hub projection validates', () => {
		expect(validateModuleProjection(projection).errors).toEqual([]);
	});

	test('the projection is refused by the full descriptor schema, which is why it needs its own', () => {
		// Not a bug in either: the hub deliberately does not ship `layout`, `commands`, `trust` or
		// `health`. Asserting this keeps the two schemas from being "unified" by a later refactor.
		expect(validateModuleDescriptor(projection).ok).toBe(false);
	});

	test('a projection missing liveStatus is refused', () => {
		const rest: Record<string, unknown> = { ...projection };
		delete rest.liveStatus;
		expect(validateModuleProjection(rest).ok).toBe(false);
	});
});

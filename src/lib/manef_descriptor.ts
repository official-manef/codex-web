/**
 * MANEF AI module descriptor validation.
 *
 * This is a port of `manef-ai/packages/foundation` (`schema/module.schema.json` + `inspect.ts` +
 * `validate.ts`) onto zod, because zod is already a runtime dependency here and ajv is not. The
 * console can then say *which* descriptor is broken and why, instead of showing a registry that
 * silently omitted a module.
 *
 * Deliberately NOT ported: `adoption.adoptModule`, which writes `.manef/` into another product's
 * repository. Writing files into other repos from a web console is a different risk class from
 * reading a descriptor, and the CLI in `manef-ai` already owns it.
 *
 * Parity notes, because a port that drifts is worse than no port:
 * - `inspectDescriptor` runs first and returns the same short codes (`depth`, `items`, `size`,
 *   `cycle`, `type`, `sensitive-field`) the original returns, so operator-facing text is stable.
 * - Every constraint is copied from the schema, including the exact regexes. Where the schema uses
 *   a negative-lookahead pattern for repo paths, this uses the same pattern rather than a
 *   hand-rolled loop, because the two must reject exactly the same strings.
 * - Cross-field rules the schema cannot express are kept: unique capability ids, `effects`
 *   containing `none` must be exactly `['none']`, and every `layout`/`ref` path must be repo-relative.
 */
import { z } from 'zod';

/** Mirrors `packages/foundation/src/constants.ts`. */
export const CONTRACT_VERSION = '1.0.0';
export const MAX_DESCRIPTOR_BYTES = 128 * 1024;
export const MAX_DESCRIPTOR_DEPTH = 20;
export const MAX_COLLECTION_ITEMS = 256;

export type ValidationResult = { ok: boolean; errors: string[] };

/**
 * Mirrors `isRepoPath` in `packages/foundation/src/paths.ts`. Kept as code rather than replaced by
 * the schema's regex alone because this is also used for `input.ref`/`output.ref` with fragments,
 * which the schema's `defs:path` does not allow.
 */
export function isRepoPath(value: string, fragment = false): boolean {
	if (!value || value.includes('..') || value.includes('\\') || value.includes('%')) return false;
	// Control characters are rejected on purpose: a path containing NUL or a newline is a path a
	// shell or a filesystem call interprets differently from a reader. `no-control-regex` is about
	// accidentally matching control characters, which is the opposite of this intent.
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(value)) return false;
	if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/')) return false;
	const parts = value.split('#');
	if (parts.length > (fragment ? 2 : 1)) return false;
	if (parts.length === 2 && !/^[a-zA-Z0-9_$./:~-]*$/.test(parts[1])) return false;
	const path = parts[0].startsWith('./') ? parts[0].slice(2) : parts[0];
	return (
		path.length > 0 &&
		path.split('/').every((segment) => !!segment && segment !== '.' && segment !== '..')
	);
}

/** Mirrors the `secretKeys` set in `inspect.ts`. Normalised the same way before lookup. */
const SECRET_KEYS = new Set([
	'apikey',
	'password',
	'passwd',
	'accesstoken',
	'refreshtoken',
	'authorization',
	'ciphertext',
	'privatekey',
	'clientsecret',
	'secretkey',
	'secretvalue',
	'token',
	'bearertoken',
	'credential',
	'credentials',
	'connectionstring',
	'databaseurl',
	'signingkey',
	'encryptionkey',
	'secret',
	'apitoken',
	'bearer',
	'cookie',
	'setcookie',
	'sessiontoken',
	'sessionsecret',
	'passphrase',
	'authorizationheader',
	'xapikey',
	'awssecretaccesskey',
	'awsaccesskeyid',
	'awssecuritytoken'
]);

const encoder = new TextEncoder();

/**
 * Mirrors `inspectDescriptor`. Rejects non-JSON objects, oversized collections, accessors, cycles
 * and credential-shaped field names *before* any schema check, so a hostile descriptor is refused
 * for being hostile rather than for being a shape mismatch.
 */
export function inspectDescriptor(value: unknown): string | null {
	const seen = new Set<object>();
	let budget = 0;
	let nodes = 0;

	const visit = (current: unknown, depth: number): string | null => {
		if (depth > MAX_DESCRIPTOR_DEPTH) return 'depth';
		if (++nodes > 8192) return 'items';
		if (typeof current === 'string') {
			budget += encoder.encode(current).byteLength;
			return budget > MAX_DESCRIPTOR_BYTES ? 'size' : null;
		}
		if (current === null || typeof current === 'boolean') return null;
		if (typeof current === 'number') return Number.isFinite(current) ? null : 'type';
		if (typeof current !== 'object') return 'type';
		if (seen.has(current)) return 'cycle';
		seen.add(current);
		const array = Array.isArray(current);
		const proto = Object.getPrototypeOf(current);
		if (!array && proto !== Object.prototype && proto !== null) return 'type';
		const descriptors = Object.getOwnPropertyDescriptors(current);
		const keys = Reflect.ownKeys(descriptors).filter((key) => !array || key !== 'length');
		if (keys.length > MAX_COLLECTION_ITEMS || (array && current.length > MAX_COLLECTION_ITEMS))
			return 'items';
		if (array && keys.length !== current.length) return 'type';
		for (const key of keys) {
			if (typeof key !== 'string') return 'type';
			if (SECRET_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase())) return 'sensitive-field';
			const field = descriptors[key];
			if (!field || !('value' in field) || !field.enumerable) return 'type';
			budget += encoder.encode(key).byteLength;
			if (budget > MAX_DESCRIPTOR_BYTES) return 'size';
			const error = visit(field.value, depth + 1);
			if (error) return error;
		}
		seen.delete(current);
		return null;
	};

	try {
		const error = visit(value, 0);
		if (error) return error;
		return encoder.encode(JSON.stringify(value)).byteLength > MAX_DESCRIPTOR_BYTES ? 'size' : null;
	} catch {
		return 'type';
	}
}

/**
 * The repo-path pattern, copied verbatim from `schema/module.schema.json#/definitions/path`.
 *
 * Written out rather than built from parts: a negative lookahead that gains or loses a character
 * here changes which descriptors are accepted, and the whole point of the port is that it accepts
 * exactly what the original accepts.
 *
 * The control-character class rejects NUL/newline in a path on purpose — a path a shell or a
 * filesystem call reads differently from a human is exactly what this must not accept. The
 * disable below sits on the assignment, not on the comment, or it applies to nothing.
 */
export const REPO_PATH_PATTERN =
	// eslint-disable-next-line no-control-regex
	/^(?!.*\.\.)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*[\\%\x00-\x1F\x7F])(?:\.\/)?(?!\.{1,2}(?:\/|$))[^/#]+(?:\/(?!\.{1,2}(?:\/|$))[^/#]+)*$/;

const MODULE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REVISION = /^[a-fA-F0-9]{40}$/;

/** `defs:reference` — where a capability's input/output contract is described. */
const reference = z
	.object({
		format: z.enum(['json-schema', 'typescript', 'python-api', 'none']),
		ref: z.string().nullable()
	})
	.strict();

const capability = z
	.object({
		id: z.string().min(1).max(128).regex(CAPABILITY_ID),
		summary: z.string().min(1).max(2048),
		input: reference,
		output: reference,
		effects: z
			.array(z.enum(['none', 'read', 'write', 'network', 'execute']))
			.min(1)
			.max(5),
		requiredScopes: z.array(z.string().min(1).max(128)).max(64),
		mode: z.enum(['declaration', 'preview', 'product-authorized']),
		risk: z.enum(['read', 'write', 'dangerous'])
	})
	.strict();

/** `defs:command` — an argv array, never a shell string, so nothing is word-split. */
const command = z.array(z.string().min(1).max(1024)).min(1).max(32);

export const moduleDescriptorSchema = z
	.object({
		contractVersion: z.literal(CONTRACT_VERSION),
		id: z.string().min(1).max(128).regex(MODULE_ID),
		name: z.string().min(1).max(256),
		version: z.string().min(1).max(128),
		kind: z.enum(['library', 'service', 'toolkit', 'guidance']),
		runtime: z
			.object({
				language: z.enum(['javascript', 'typescript', 'python']),
				minimumVersion: z.string().min(1).max(64),
				manager: z.enum(['node', 'bun', 'python'])
			})
			.strict(),
		source: z
			.object({
				repository: z.string().min(1).max(256).regex(REPOSITORY),
				revision: z.string().regex(REVISION),
				channel: z.enum(['main', 'review-candidate'])
			})
			.strict(),
		layout: z
			.object({
				source: z.array(z.string().regex(REPO_PATH_PATTERN)).max(64),
				tests: z.array(z.string().regex(REPO_PATH_PATTERN)).max(64),
				docs: z.array(z.string().regex(REPO_PATH_PATTERN)).max(64)
			})
			.strict(),
		commands: z
			.object({
				check: z.array(command).max(32),
				test: z.array(command).max(32),
				build: z.array(command).max(32)
			})
			.strict(),
		capabilities: z.array(capability).max(128),
		trust: z
			.object({
				identityAuthority: z.enum(['product', 'host', 'none']),
				tenantBoundary: z.enum(['product-owned', 'local-workspace', 'consumer-owned']),
				secretOwner: z.enum(['product', 'host', 'none']),
				sandbox: z.enum(['none', 'host-policy-only'])
			})
			.strict(),
		config: z
			.object({
				profile: z.enum(['service', 'library', 'toolkit', 'guidance']),
				secrets: z.literal('references-only'),
				defaultMode: z.literal('preview'),
				network: z.literal('explicit-adapter')
			})
			.strict(),
		health: z
			.object({
				kind: z.enum(['liveness-only', 'capability-declaration', 'not-a-service']),
				path: z.string().nullable()
			})
			.strict(),
		extensions: z.record(z.string(), z.unknown()).optional()
	})
	.strict();

/**
 * The hub's *public projection*, which is what `/api/modules` actually returns.
 *
 * `apps/hub/metadata.mjs#publicModule` narrows a descriptor before sending it: `layout`, `commands`,
 * `trust` and `health` are dropped, `source.link`, `status` and `liveStatus` are added, and `config`
 * keeps only two fields. Validating that projection against the full descriptor schema always
 * fails — for eight fields the hub chose not to send — so it gets its own schema rather than a
 * false alarm on every card.
 *
 * The console therefore proves two different things, and they are different questions:
 * - `validateModuleDescriptor` — "is this a well-formed descriptor?" for a file the operator has.
 * - `validateModuleProjection` — "did the hub send a projection this build can read?" for the wire.
 */
export const moduleProjectionSchema = z
	.object({
		contractVersion: z.literal(CONTRACT_VERSION),
		id: z.string().min(1).max(128),
		name: z.string().min(1).max(256),
		version: z.string().min(1).max(128),
		kind: z.string().min(1).max(80),
		runtime: z
			.object({
				language: z.string().min(1).max(80),
				minimumVersion: z.string().min(1).max(80),
				manager: z.string().min(1).max(80)
			})
			.strict(),
		source: z
			.object({
				repository: z.string(),
				revision: z.string().max(80),
				channel: z.string().max(80),
				link: z.string().nullable()
			})
			.strict(),
		capabilities: z
			.array(
				z
					.object({
						id: z.string().min(1).max(120),
						summary: z.string(),
						input: reference,
						output: reference,
						effects: z.array(z.string()).max(5),
						requiredScopes: z.array(z.string()).max(64),
						mode: z.string().max(80),
						risk: z.string().max(80)
					})
					.strict()
			)
			.max(64),
		config: z.object({ defaultMode: z.string(), secrets: z.string() }).strict(),
		status: z.string().min(1).max(80),
		liveStatus: z.string().min(1).max(80)
	})
	.strict();

/** Validate what the hub put on the wire. Same hostile-shape preflight, then the projection schema. */
export function validateModuleProjection(value: unknown): ValidationResult {
	const preflight = inspectDescriptor(value);
	if (preflight) return { ok: false, errors: [`schema:# keyword:${preflight}`] };

	const parsed = moduleProjectionSchema.safeParse(value);
	if (!parsed.success) {
		return {
			ok: false,
			errors: parsed.error.issues.map(
				(issue) =>
					`schema:${issue.path.length ? `#/properties/${issue.path.join('/')}` : '#'} keyword:${issue.code}`
			)
		};
	}
	return { ok: true, errors: [] };
}

/**
 * Validate a descriptor. Same order as `validate.ts`: hostile-shape preflight, then the schema, then
 * the cross-field rules a JSON schema cannot express.
 *
 * Error strings keep the original `schema:<path> keyword:<keyword>` shape so an operator reading
 * both this console and the `manef-ai` CLI sees the same vocabulary.
 */
export function validateModuleDescriptor(value: unknown): ValidationResult {
	const preflight = inspectDescriptor(value);
	if (preflight) return { ok: false, errors: [`schema:# keyword:${preflight}`] };

	const parsed = moduleDescriptorSchema.safeParse(value);
	if (!parsed.success) {
		return {
			ok: false,
			errors: parsed.error.issues.map(
				(issue) =>
					`schema:${issue.path.length ? `#/properties/${issue.path.join('/')}` : '#'} keyword:${issue.code}`
			)
		};
	}
	const module = parsed.data;

	const ids = module.capabilities.map((entry) => entry.id);
	if (new Set(ids).size !== ids.length)
		return { ok: false, errors: ['schema:#/properties/capabilities keyword:unique-id'] };

	for (const paths of Object.values(module.layout))
		if (paths.some((path) => !isRepoPath(path)))
			return { ok: false, errors: ['schema:#/properties/layout keyword:relative-path'] };

	for (const entry of module.capabilities) {
		if (entry.effects.includes('none') && entry.effects.length !== 1)
			return {
				ok: false,
				errors: ['schema:#/definitions/capability/properties/effects keyword:exclusive-none']
			};
		if (new Set(entry.effects).size !== entry.effects.length)
			return {
				ok: false,
				errors: ['schema:#/definitions/capability/properties/effects keyword:uniqueItems']
			};
		if (new Set(entry.requiredScopes).size !== entry.requiredScopes.length)
			return {
				ok: false,
				errors: ['schema:#/definitions/capability/properties/requiredScopes keyword:uniqueItems']
			};
		for (const ref of [entry.input, entry.output])
			if (ref.ref !== null && !isRepoPath(ref.ref, true))
				return { ok: false, errors: ['schema:#/definitions/reference keyword:relative-path'] };
	}

	return { ok: true, errors: [] };
}

/**
 * Server-side HTTP client for the user's paired device bridge.
 *
 * Communicates with the user's local bridge process over HTTP endpoints:
 * - POST /v1/exec
 * - POST /v1/fs/read
 * - POST /v1/fs/write
 *
 * Strict security rules:
 * - Credentials (BRIDGE_TOKEN) are never logged, placed in URLs, or leaked in errors.
 * - Endpoints must be loopback/lan for http:, or https:.
 * - Non-2xx responses and transport failures return fixed generic error strings.
 * - Input validation (argv, path, text limits) is enforced before network calls.
 * - Responses are capped at 1 MB.
 */

import { Buffer } from 'node:buffer';
import { classifyEndpoint } from '../runtime/endpoint';

/**
 * The env is read structurally, so any object with these keys works. The index signature
 * keeps a whole `$env/dynamic/private` object assignable without a cast at every call site.
 */
export type BridgeEnv = { BRIDGE_URL?: string; BRIDGE_TOKEN?: string; [key: string]: unknown };

export type BridgeClient = {
	exec: (argv: string[]) => Promise<{ code: number; stdout: string }>;
	readFile: (path: string) => Promise<string>;
	writeFile: (path: string, text: string) => Promise<void>;
};

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_ARGV_ENTRIES = 32;
const MAX_ARG_LENGTH = 200;
const MAX_PATH_LENGTH = 500;
const MAX_WRITE_TEXT_LENGTH = 200_000;
const TIMEOUT_MS = 5000;

/**
 * Check if the bridge environment is configured and safe to use.
 *
 * True only when both BRIDGE_URL and BRIDGE_TOKEN are present, non-empty,
 * and BRIDGE_URL parses as http: loopback/lan or https:, with no credentials
 * and no query string.
 *
 * Reuses classifyEndpoint from src/lib/runtime/endpoint.ts which is pure
 * and introduces no browser globals.
 */
export function bridgeAvailable(env: BridgeEnv): boolean {
	if (!env || typeof env !== 'object') return false;
	const url = env.BRIDGE_URL;
	const token = env.BRIDGE_TOKEN;
	if (typeof url !== 'string' || !url.trim() || typeof token !== 'string' || !token.trim()) {
		return false;
	}

	const classification = classifyEndpoint(url);
	if (classification.kind === 'invalid' || !classification.origin) {
		return false;
	}

	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		return false;
	}

	if (parsed.protocol === 'https:') {
		return true;
	}
	if (parsed.protocol === 'http:') {
		return classification.kind === 'loopback' || classification.kind === 'lan';
	}
	return false;
}

function assertValidArgv(argv: unknown): asserts argv is string[] {
	if (!Array.isArray(argv) || argv.length < 1 || argv.length > MAX_ARGV_ENTRIES) {
		throw new Error('Invalid argv');
	}
	for (const arg of argv) {
		if (typeof arg !== 'string' || arg.length > MAX_ARG_LENGTH || arg.includes('\0')) {
			throw new Error('Invalid argv');
		}
	}
}

function assertValidPath(path: unknown): asserts path is string {
	if (
		typeof path !== 'string' ||
		path.length < 1 ||
		path.length > MAX_PATH_LENGTH ||
		path.includes('\0')
	) {
		throw new Error('Invalid path');
	}
}

function assertValidWriteText(text: unknown): asserts text is string {
	if (typeof text !== 'string' || text.length > MAX_WRITE_TEXT_LENGTH) {
		throw new Error('Invalid text');
	}
}

async function postBridge(
	fetcher: typeof fetch,
	url: string,
	token: string,
	body: unknown,
	failMessage: string
): Promise<string> {
	let response: Response;
	try {
		response = await fetcher(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS),
			redirect: 'error'
		});
	} catch {
		throw new Error(failMessage);
	}

	if (!response.ok) {
		throw new Error(failMessage);
	}

	const contentLength = response.headers?.get?.('content-length');
	if (contentLength) {
		const parsed = Number(contentLength);
		if (Number.isFinite(parsed) && parsed > MAX_RESPONSE_BYTES) {
			throw new Error('bridge response too large');
		}
	}

	let text: string;
	try {
		text = await response.text();
	} catch {
		throw new Error(failMessage);
	}

	if (text.length > MAX_RESPONSE_BYTES || Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
		throw new Error('bridge response too large');
	}

	return text;
}

export function createBridgeClient(env: BridgeEnv, fetcher: typeof fetch = fetch): BridgeClient {
	if (!bridgeAvailable(env)) {
		throw new Error('bridge environment invalid');
	}

	const classification = classifyEndpoint(env.BRIDGE_URL!);
	const origin = classification.origin!;
	const token = env.BRIDGE_TOKEN!.trim();

	return {
		async exec(argv: string[]): Promise<{ code: number; stdout: string }> {
			assertValidArgv(argv);
			const text = await postBridge(
				fetcher,
				`${origin}/v1/exec`,
				token,
				{ argv },
				'bridge exec failed'
			);

			let data: unknown;
			try {
				data = JSON.parse(text);
			} catch {
				throw new Error('bridge exec failed');
			}

			if (
				!data ||
				typeof data !== 'object' ||
				typeof (data as Record<string, unknown>).code !== 'number' ||
				typeof (data as Record<string, unknown>).stdout !== 'string'
			) {
				throw new Error('bridge exec failed');
			}

			return {
				code: (data as { code: number }).code,
				stdout: (data as { stdout: string }).stdout
			};
		},

		async readFile(path: string): Promise<string> {
			assertValidPath(path);
			const text = await postBridge(
				fetcher,
				`${origin}/v1/fs/read`,
				token,
				{ path },
				'bridge read failed'
			);

			let data: unknown;
			try {
				data = JSON.parse(text);
			} catch {
				throw new Error('bridge read failed');
			}

			if (
				!data ||
				typeof data !== 'object' ||
				typeof (data as Record<string, unknown>).text !== 'string'
			) {
				throw new Error('bridge read failed');
			}

			return (data as { text: string }).text;
		},

		async writeFile(path: string, text: string): Promise<void> {
			assertValidPath(path);
			assertValidWriteText(text);
			const resText = await postBridge(
				fetcher,
				`${origin}/v1/fs/write`,
				token,
				{ path, text },
				'bridge write failed'
			);

			let data: unknown;
			try {
				data = JSON.parse(resText);
			} catch {
				throw new Error('bridge write failed');
			}

			if (!data || typeof data !== 'object' || (data as Record<string, unknown>).ok !== true) {
				throw new Error('bridge write failed');
			}
		}
	};
}

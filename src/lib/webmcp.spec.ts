import { expect, test } from 'vitest';
import { publicCapabilities } from './webmcp';

/**
 * `publicCapabilities` is the redaction boundary between the local runtime's capability
 * document and the browser page tools. It must drop credentials, error text and model paths.
 */

test('an error or non-object capability document is refused rather than partially exposed', () => {
	expect(() => publicCapabilities(null)).toThrow();
	expect(() => publicCapabilities('text')).toThrow();
	expect(() => publicCapabilities([])).toThrow();
	expect(() => publicCapabilities({ error: 'runtime offline' })).toThrow();
	// The error text must not leak through the thrown message either.
	expect(() => publicCapabilities({ error: 'secret-path /home/user/.model' })).toThrow(
		'The local runtime could not complete this request'
	);
});

test('only the declared groups survive, so an unknown field cannot be forwarded', () => {
	const result = publicCapabilities({
		chat: { present: true },
		audio: { present: true },
		unknown_group: { anything: 1 },
		api_key: 'sk-should-not-appear',
		token: 'also-not',
		error: undefined
	});
	expect(Object.keys(result).sort()).toEqual(['audio', 'chat']);
	expect(JSON.stringify(result)).not.toContain('should-not-appear');
	expect(JSON.stringify(result)).not.toContain('also-not');
});

test('numeric limits are kept only when they are finite, non-negative and named like a limit', () => {
	const result = publicCapabilities({
		chat: {
			max_tokens: 512,
			max_context: 0,
			approval_seconds: 30,
			attachment_chunk_chars: 1000,
			width: 800,
			height: 600,
			// Not a limit name, or not a sane number: all dropped.
			latency_ms: 42,
			model_path: '/models/x',
			max_negative: -1,
			max_infinite: Number.POSITIVE_INFINITY,
			max_nan: Number.NaN,
			max_string: '512'
		}
	});
	expect(result.chat).toEqual({
		max_tokens: 512,
		max_context: 0,
		approval_seconds: 30,
		attachment_chunk_chars: 1000,
		width: 800,
		height: 600
	});
});

test('audio booleans and string lists are forwarded, and model paths are not', () => {
	const result = publicCapabilities({
		audio: {
			present: true,
			converter: 'ffmpeg',
			multilingual: false,
			timestamps: 'yes',
			formats: ['wav', 42, 'mp3'],
			devices: 'not-a-list',
			prepared_devices: ['cpu'],
			languages: ['en', null],
			model_path: '/models/whisper.bin',
			max_seconds: 60
		}
	});
	expect(result.audio).toEqual({
		present: true,
		// `converter: 'ffmpeg'` is dropped: the four flags are booleans, so a string is not
		// forwarded under that name.
		multilingual: false,
		// A non-boolean `timestamps` is dropped instead of being coerced.
		formats: ['wav', 'mp3'],
		prepared_devices: ['cpu'],
		languages: ['en'],
		max_seconds: 60
	});
	const text = JSON.stringify(result);
	expect(text).not.toContain('whisper');
	expect(text).not.toContain('/models/');
});

test('attachment image flags keep booleans only', () => {
	const result = publicCapabilities({
		attachments: {
			images: { vision: true, ocr: false, verification: 'yes' },
			max_bytes: 100
		} as never
	});
	expect(result.attachments).toEqual({
		images: { vision: true, ocr: false },
		max_bytes: 100
	});
});

test('MCP protocol versions keep strings only', () => {
	expect(
		publicCapabilities({ mcp: { protocol_versions: ['2025-06-18', 2, null, '2025-11-25'] } }).mcp
	).toEqual({ protocol_versions: ['2025-06-18', '2025-11-25'] });
});

test('a group that is not an object is skipped instead of crashing the whole document', () => {
	expect(publicCapabilities({ chat: 'nope', audio: null, sessions: { max_turns: 5 } })).toEqual({
		sessions: { max_turns: 5 }
	});
});

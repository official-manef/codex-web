import { describe, expect, it } from 'vitest';
import {
	framePolicy,
	hostMessage,
	MAX_MESSAGE_BYTES,
	MAX_REQUEST_ID_CHARS,
	parseGuestMessage,
	type GuestToHost,
	type HostToGuest
} from './mcp_app_host';

describe('mcp_app_host protocol and security boundary', () => {
	it('validly parses each of the three guest message types', () => {
		const ready: GuestToHost = { type: 'guest:ready', appId: 'app-sandbox-1' };
		expect(parseGuestMessage(ready)).toEqual(ready);

		const call: GuestToHost = {
			type: 'guest:call',
			requestId: 'req_123-abc',
			tool: 'read_status.v1',
			args: { verbose: true, count: 5 }
		};
		expect(parseGuestMessage(call)).toEqual(call);

		const resize: GuestToHost = { type: 'guest:resize', height: 480 };
		expect(parseGuestMessage(resize)).toEqual(resize);
	});

	it('validly parses JSON string encoded guest messages', () => {
		const ready: GuestToHost = { type: 'guest:ready', appId: 'test-app' };
		expect(parseGuestMessage(JSON.stringify(ready))).toEqual(ready);
	});

	it('rejects unknown or missing type', () => {
		expect(parseGuestMessage({ type: 'guest:unknown', appId: 'a' })).toBeNull();
		expect(parseGuestMessage({ appId: 'missing-type' })).toBeNull();
		expect(parseGuestMessage({ type: 123 })).toBeNull();
		expect(parseGuestMessage(null)).toBeNull();
		expect(parseGuestMessage(undefined)).toBeNull();
		expect(parseGuestMessage('not-json')).toBeNull();
		expect(parseGuestMessage([1, 2, 3])).toBeNull();
	});

	it('rejects invalid tools, including uppercase-invalid ones', () => {
		// Uppercase tool with invalid characters, spaces, or leading non-letters
		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'r1',
				tool: 'INVALID TOOL',
				args: {}
			})
		).toBeNull();
		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'r1',
				tool: 'TOOL!',
				args: {}
			})
		).toBeNull();
		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'r1',
				tool: '-INVALID',
				args: {}
			})
		).toBeNull();
		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'r1',
				tool: '123tool',
				args: {}
			})
		).toBeNull();
		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'r1',
				tool: '',
				args: {}
			})
		).toBeNull();
		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'r1',
				tool: 'a'.repeat(65),
				args: {}
			})
		).toBeNull();
	});

	it('rejects 65-char requestId and accepts valid length requestIds', () => {
		const validId = 'a'.repeat(MAX_REQUEST_ID_CHARS);
		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: validId,
				tool: 'tool',
				args: {}
			})
		).toEqual({
			type: 'guest:call',
			requestId: validId,
			tool: 'tool',
			args: {}
		});

		const invalidId = 'a'.repeat(MAX_REQUEST_ID_CHARS + 1);
		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: invalidId,
				tool: 'tool',
				args: {}
			})
		).toBeNull();

		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: '',
				tool: 'tool',
				args: {}
			})
		).toBeNull();

		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'has spaces',
				tool: 'tool',
				args: {}
			})
		).toBeNull();
	});

	it('rejects args as an array and requires plain object', () => {
		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'r1',
				tool: 'tool',
				args: ['item1', 'item2']
			})
		).toBeNull();

		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'r1',
				tool: 'tool',
				args: null
			})
		).toBeNull();
	});

	it('rejects args with 33 keys but accepts 32 keys', () => {
		const args32: Record<string, unknown> = {};
		for (let i = 0; i < 32; i++) {
			args32[`k${i}`] = i;
		}

		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'r1',
				tool: 'tool',
				args: args32
			})
		).not.toBeNull();

		const args33: Record<string, unknown> = { ...args32, extra: 33 };
		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'r1',
				tool: 'tool',
				args: args33
			})
		).toBeNull();
	});

	it('rejects height out of range or non-finite', () => {
		expect(parseGuestMessage({ type: 'guest:resize', height: 39 })).toBeNull();
		expect(parseGuestMessage({ type: 'guest:resize', height: 2001 })).toBeNull();
		expect(parseGuestMessage({ type: 'guest:resize', height: NaN })).toBeNull();
		expect(parseGuestMessage({ type: 'guest:resize', height: Infinity })).toBeNull();

		expect(parseGuestMessage({ type: 'guest:resize', height: 40 })).toEqual({
			type: 'guest:resize',
			height: 40
		});
		expect(parseGuestMessage({ type: 'guest:resize', height: 2000 })).toEqual({
			type: 'guest:resize',
			height: 2000
		});
	});

	it('rejects oversized payloads past MAX_MESSAGE_BYTES', () => {
		const hugeString = 'x'.repeat(MAX_MESSAGE_BYTES);
		expect(
			parseGuestMessage({
				type: 'guest:call',
				requestId: 'r1',
				tool: 'tool',
				args: { data: hugeString }
			})
		).toBeNull();
	});

	it('hostMessage round-trips and returns null past the cap', () => {
		const init: HostToGuest = { type: 'host:init', appId: 'app-9', theme: 'dark' };
		const initEncoded = hostMessage(init);
		expect(initEncoded).not.toBeNull();
		expect(JSON.parse(initEncoded!)).toEqual(init);

		const resultSuccess: HostToGuest = {
			type: 'host:result',
			requestId: 'r-1',
			ok: true,
			data: { items: [1, 2, 3] }
		};
		const resSuccessEncoded = hostMessage(resultSuccess);
		expect(resSuccessEncoded).not.toBeNull();
		expect(JSON.parse(resSuccessEncoded!)).toEqual(resultSuccess);

		const resultFailure: HostToGuest = {
			type: 'host:result',
			requestId: 'r-2',
			ok: false,
			error: 'Permission denied'
		};
		const resFailureEncoded = hostMessage(resultFailure);
		expect(resFailureEncoded).not.toBeNull();
		expect(JSON.parse(resFailureEncoded!)).toEqual(resultFailure);

		const oversized: HostToGuest = {
			type: 'host:result',
			requestId: 'r-3',
			ok: true,
			data: 'x'.repeat(MAX_MESSAGE_BYTES + 100)
		};
		expect(hostMessage(oversized)).toBeNull();
	});

	it('framePolicy returns strict sandbox with no allow-same-origin and denies every permission', () => {
		const policy = framePolicy('https://app.example.com');
		expect(policy.sandbox).toBe('allow-scripts');
		expect(policy.sandbox).not.toContain('allow-same-origin');
		expect(policy.sandbox).not.toContain('allow-top-navigation');
		expect(policy.sandbox).not.toContain('allow-popups');
		expect(policy.sandbox).not.toContain('allow-forms');

		expect(policy.allow).toContain("camera 'none'");
		expect(policy.allow).toContain("microphone 'none'");
		expect(policy.allow).toContain("geolocation 'none'");
		expect(policy.allow).toContain("clipboard-read 'none'");
		expect(policy.allow).toContain("clipboard-write 'none'");

		expect(policy.referrerPolicy).toBe('no-referrer');
	});

	it('framePolicy throws for http://, a path, credentials and a non-URL', () => {
		expect(() => framePolicy('http://app.example.com')).toThrow(/must use https: protocol/);
		expect(() => framePolicy('https://app.example.com/some/path')).toThrow(
			/must not contain a path/
		);
		expect(() => framePolicy('https://app.example.com/')).toThrow(/must not have a trailing slash/);
		expect(() => framePolicy('https://user:pass@app.example.com')).toThrow(
			/must not contain credentials/
		);
		expect(() => framePolicy('not-a-url')).toThrow(/Invalid app origin/);
		expect(() => framePolicy('')).toThrow(/non-empty string/);
	});
});

import { describe, expect, test } from 'vitest';
import {
	clearBridgeToken,
	readBridgeToken,
	saveBridgeToken,
	type TokenStorage
} from './bridge_token';

/** A Map-backed Storage stand-in, so no jsdom is needed for a pure module test. */
function memoryStorage(): TokenStorage & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => void map.set(key, value),
		removeItem: (key) => void map.delete(key)
	};
}

const DEVICE = 'jd7abc123';
const TOKEN = 'bridge-token-abcdefghijklmnop';

describe('bridge token storage', () => {
	test('round-trips a valid token for one device only', () => {
		const storage = memoryStorage();
		expect(saveBridgeToken(DEVICE, TOKEN, storage)).toBe(true);
		expect(readBridgeToken(DEVICE, storage)).toBe(TOKEN);
		expect(readBridgeToken('otherdevice', storage)).toBe('');
	});

	test('never stores a token a subprotocol cannot carry', () => {
		const storage = memoryStorage();
		// Base64 punctuation: the exact shape that makes `new WebSocket` throw.
		expect(saveBridgeToken(DEVICE, 'abc+def/ghi=jklmnop', storage)).toBe(false);
		expect(storage.map.size).toBe(0);

		expect(saveBridgeToken(DEVICE, 'short', storage)).toBe(false);
		expect(saveBridgeToken(DEVICE, '', storage)).toBe(false);
	});

	test('refuses a device id that is not a safe key', () => {
		const storage = memoryStorage();
		expect(saveBridgeToken('../../etc/passwd', TOKEN, storage)).toBe(false);
		expect(saveBridgeToken('has space', TOKEN, storage)).toBe(false);
		expect(readBridgeToken('../../etc/passwd', storage)).toBe('');
	});

	test('clearing removes exactly one device', () => {
		const storage = memoryStorage();
		saveBridgeToken(DEVICE, TOKEN, storage);
		saveBridgeToken('otherdevice', TOKEN, storage);
		clearBridgeToken(DEVICE, storage);
		expect(readBridgeToken(DEVICE, storage)).toBe('');
		expect(readBridgeToken('otherdevice', storage)).toBe(TOKEN);
	});

	test('a corrupt or foreign envelope reads as no token', () => {
		const storage = memoryStorage();
		storage.setItem(`bridge-token:v1:${DEVICE}`, 'not json at all');
		expect(readBridgeToken(DEVICE, storage)).toBe('');

		storage.setItem(`bridge-token:v1:${DEVICE}`, JSON.stringify({ version: 2, value: TOKEN }));
		expect(readBridgeToken(DEVICE, storage)).toBe('');

		storage.setItem(
			`bridge-token:v1:${DEVICE}`,
			JSON.stringify({ version: 1, value: 'has+base64/chars=' })
		);
		expect(readBridgeToken(DEVICE, storage)).toBe('');
	});

	test('a storage that throws reads as no token instead of crashing the panel', () => {
		const broken: TokenStorage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		expect(readBridgeToken(DEVICE, broken)).toBe('');
		expect(saveBridgeToken(DEVICE, TOKEN, broken)).toBe(false);
		expect(() => clearBridgeToken(DEVICE, broken)).not.toThrow();
	});
});

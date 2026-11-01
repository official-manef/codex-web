import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { readBridgeToken, saveBridgeToken, clearBridgeToken } from './bridge_token';

/**
 * Bridge tokens live in `sessionStorage`. These cases cover what a real browser hands back:
 * a value from an older build, a value another origin/device wrote, and a store that refuses
 * to be read or written at all.
 */
class ThrowingStorage {
	getItem(): string {
		throw new DOMException('denied', 'SecurityError');
	}
	setItem(): void {
		throw new DOMException('denied', 'SecurityError');
	}
	removeItem(): void {
		throw new DOMException('denied', 'SecurityError');
	}
}

function memoryStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial));
	return {
		map,
		storage: {
			getItem: (key: string) => map.get(key) ?? null,
			setItem: (key: string, value: string) => void map.set(key, value),
			removeItem: (key: string) => void map.delete(key)
		}
	};
}

const TOKEN = 'pairing-token-0123456789-abcdef';
const DEVICE = 'device-abc_123';

describe('a stored token this build would not have written', () => {
	test('a bare string where the envelope belongs reads as no token', () => {
		const { storage } = memoryStorage({ [`bridge-token:v1:${DEVICE}`]: TOKEN });
		expect(readBridgeToken(DEVICE, storage)).toBe('');
	});

	test('a newer envelope version reads as no token', () => {
		const { storage } = memoryStorage({
			[`bridge-token:v1:${DEVICE}`]: JSON.stringify({ version: 2, value: TOKEN })
		});
		expect(readBridgeToken(DEVICE, storage)).toBe('');
	});

	test('a token with characters a WebSocket subprotocol cannot carry is refused', () => {
		const { storage } = memoryStorage({
			[`bridge-token:v1:${DEVICE}`]: JSON.stringify({ version: 1, value: 'has+slash/and=pad' })
		});
		expect(readBridgeToken(DEVICE, storage)).toBe('');
	});

	test('an oversized stored value is refused before parsing', () => {
		const { storage } = memoryStorage({
			[`bridge-token:v1:${DEVICE}`]: 'x'.repeat(100_000)
		});
		expect(readBridgeToken(DEVICE, storage)).toBe('');
	});

	test('a device id that is not a safe key reads nothing and writes nothing', () => {
		const { storage, map } = memoryStorage();
		expect(readBridgeToken('../../etc/passwd', storage)).toBe('');
		expect(saveBridgeToken('../evil', TOKEN, storage)).toBe(false);
		expect(map.size).toBe(0);
	});
});

describe('a storage that throws on every call', () => {
	test('read, save and clear all fail quietly', () => {
		const storage = new ThrowingStorage();
		expect(readBridgeToken(DEVICE, storage)).toBe('');
		expect(saveBridgeToken(DEVICE, TOKEN, storage)).toBe(false);
		expect(() => clearBridgeToken(DEVICE, storage)).not.toThrow();
	});
});

describe('round trip', () => {
	test('a saved token reads back and a clear removes it', () => {
		const { storage } = memoryStorage();
		expect(saveBridgeToken(DEVICE, TOKEN, storage)).toBe(true);
		expect(readBridgeToken(DEVICE, storage)).toBe(TOKEN);
		clearBridgeToken(DEVICE, storage);
		expect(readBridgeToken(DEVICE, storage)).toBe('');
	});

	test('the bridge script the terminal talks to is present', () => {
		// The terminal panel is only honest if the half it documents exists in the repo.
		expect(existsSync('bridge/terminal-bridge.mjs')).toBe(true);
	});
});

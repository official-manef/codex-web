import { expect, test } from 'vitest';
import {
	isPublicAddress,
	redactSecrets,
	snapshotArguments,
	validAlias,
	validPublicMcpUrl,
	validSecret,
	validTools
} from './mcp_rules';

test('alias matches the operator config shape', () => {
	expect(validAlias('my-server')).toBe('my-server');
	expect(validAlias(' a1 ')).toBe('a1');
	for (const input of ['1abc', 'My-Server', 'a_b', '', '-x', 'a'.repeat(41), 7, undefined])
		expect(validAlias(input), String(input)).toBeNull();
});

test('endpoint must be a public HTTPS URL with no embedded credential', () => {
	expect(validPublicMcpUrl('https://mcp.example.com/mcp')).toBe('https://mcp.example.com/mcp');
	expect(validPublicMcpUrl('https://mcp.example.com:8443/mcp?mode=stream')).toBe(
		'https://mcp.example.com:8443/mcp?mode=stream'
	);
	for (const input of [
		'http://mcp.example.com/mcp',
		'https://user:pass@mcp.example.com/mcp',
		'https://mcp.example.com/mcp#fragment',
		'https://mcp.example.com/mcp?token=abc',
		'https://mcp.example.com/mcp?api_key=abc',
		'https://127.0.0.1/mcp',
		'https://0x7f.1/mcp',
		'https://2130706433/mcp',
		'https://[::1]/mcp',
		'https://localhost/mcp',
		'https://box.local/mcp',
		'https://box.localhost/mcp',
		// A trailing dot is the same name to the resolver. Without stripping it, `localhost.`
		// and `127.0.0.1.` slipped past the denylist as "public" hosts.
		'https://localhost./mcp',
		'https://box.local./mcp',
		'https://box.localhost./mcp',
		'https://127.0.0.1./mcp',
		// Wildcard resolvers return the address encoded in the name, so no lookup is needed to
		// know they are private. Without these a stored URL reached loopback and the metadata IP.
		'https://127.0.0.1.nip.io/mcp',
		'https://169.254.169.254.nip.io/mcp',
		'https://10.0.0.1.sslip.io/mcp',
		'https://127-0-0-1.sslip.io/mcp',
		'https://127.0.0.1.xip.io/mcp',
		'https://localtest.me/mcp',
		'',
		undefined
	])
		expect(validPublicMcpUrl(input), String(input)).toBeNull();
});

test('address classification refuses loopback, RFC1918, link-local, CGNAT and IPv6', () => {
	for (const address of [
		'127.0.0.1',
		'10.1.2.3',
		'172.16.0.1',
		'192.168.0.1',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'::1',
		'::',
		'fd00::1',
		'fe80::1',
		'::ffff:127.0.0.1',
		'::ffff:7f00:1'
	])
		expect(isPublicAddress(address), address).toBe(false);
	for (const address of ['93.184.216.34', '1.1.1.1', '2606:2800:220:1:248:1893:25c8:1946'])
		expect(isPublicAddress(address), address).toBe(true);
});

test('tool allowlist is 1..128 direct tool names, deduplicated, never a Composio metatool', () => {
	expect(validTools(['read_file', 'read_file', 'ns.write:v1'])).toEqual([
		'read_file',
		'ns.write:v1'
	]);
	expect(validTools([])).toBeNull();
	expect(validTools(Array.from({ length: 129 }, (_, index) => `tool_${index}`))).toBeNull();
	expect(validTools(['has space'])).toBeNull();
	expect(validTools(['COMPOSIO_SEARCH_TOOLS'])).toBeNull();
	expect(validTools([42])).toBeNull();
});

test('secret is non-empty printable ASCII with no accidental whitespace', () => {
	expect(validSecret('sk-live_ABC123')).toBe('sk-live_ABC123');
	expect(validSecret('a b')).toBe('a b');
	for (const input of [
		'',
		' padded',
		'trailing\n',
		'tab\there',
		'é',
		'x'.repeat(16_385),
		1,
		undefined
	])
		expect(validSecret(input), String(input)).toBeNull();
});

test('argument snapshot is a plain object bounded to 16 000 serialized characters', () => {
	expect(snapshotArguments({ query: 'x' })).toBe('{"query":"x"}');
	expect(snapshotArguments({})).toBe('{}');
	expect(snapshotArguments([])).toBeNull();
	expect(snapshotArguments(null)).toBeNull();
	expect(snapshotArguments('text')).toBeNull();
	expect(snapshotArguments({ blob: 'x'.repeat(16_000) })).toBeNull();
});

test('redaction removes every supplied secret and ignores empty ones', () => {
	expect(
		redactSecrets('key sk-1 at https://mcp.example.com', ['sk-1', '', 'https://mcp.example.com'])
	).toBe('key [redacted] at [redacted]');
});

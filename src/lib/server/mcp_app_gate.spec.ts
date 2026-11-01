import { describe, expect, test } from 'vitest';
import { defaultPolicy } from './policy';
import { appAllowed, appAllowlist } from './mcp_app_gate';
import type { PolicyVerb, PolicyDecision } from './policy';

describe('mcp_app_gate', () => {
	const allowPolicy = (): Record<PolicyVerb, PolicyDecision> => ({
		...defaultPolicy(),
		mcp_app: 'allow'
	});

	const denyPolicy = (): Record<PolicyVerb, PolicyDecision> => ({
		...defaultPolicy(),
		mcp_app: 'deny'
	});

	const askPolicy = (): Record<PolicyVerb, PolicyDecision> => ({
		...defaultPolicy(),
		mcp_app: 'ask'
	});

	describe('appAllowed', () => {
		test('policy deny → reason: policy', () => {
			const verdict = appAllowed('weather', denyPolicy(), ['weather']);
			expect(verdict).toEqual({ ok: false, reason: 'policy' });
		});

		test('policy ask → reason: policy', () => {
			const verdict = appAllowed('weather', askPolicy(), ['weather']);
			expect(verdict).toEqual({ ok: false, reason: 'policy' });
		});

		test('policy allow but id not in allowlist → reason: not-allowed', () => {
			const verdict = appAllowed('weather', allowPolicy(), ['calculator']);
			expect(verdict).toEqual({ ok: false, reason: 'not-allowed' });
		});

		test('both pass → ok: true', () => {
			const verdict = appAllowed('weather', allowPolicy(), ['weather', 'calculator']);
			expect(verdict).toEqual({ ok: true });
		});

		test('empty allowlist blocks an allowed policy', () => {
			const verdict = appAllowed('weather', allowPolicy(), []);
			expect(verdict).toEqual({ ok: false, reason: 'not-allowed' });
		});

		test('reason precedence: policy denial takes precedence over missing allowlist entry', () => {
			const verdict = appAllowed('weather', denyPolicy(), []);
			expect(verdict).toEqual({ ok: false, reason: 'policy' });
		});
	});

	describe('appAllowlist', () => {
		test('returns [] for unset or undefined MCP_APPS_ALLOW', () => {
			expect(appAllowlist({})).toEqual([]);
			expect(appAllowlist({ MCP_APPS_ALLOW: undefined })).toEqual([]);
		});

		test('returns [] for empty string or whitespace only', () => {
			expect(appAllowlist({ MCP_APPS_ALLOW: '' })).toEqual([]);
			expect(appAllowlist({ MCP_APPS_ALLOW: '   ' })).toEqual([]);
			expect(appAllowlist({ MCP_APPS_ALLOW: ' , ,  ' })).toEqual([]);
		});

		test('parses comma-separated entries and trims whitespace', () => {
			const env = { MCP_APPS_ALLOW: '  weather ,  notes-app  , calc  ' };
			expect(appAllowlist(env)).toEqual(['weather', 'notes-app', 'calc']);
		});

		test('dedupes duplicate entries while preserving order', () => {
			const env = { MCP_APPS_ALLOW: 'weather, notes-app, weather, calc, notes-app' };
			expect(appAllowlist(env)).toEqual(['weather', 'notes-app', 'calc']);
		});

		test('rejects bad ids', () => {
			const env = {
				MCP_APPS_ALLOW:
					'weather, Weather, invalid_id, -invalid, 1234, a, tool$, tool#1, ' +
					'tool-name-that-is-way-too-long-because-it-exceeds-32-chars, valid-tool'
			};
			// '1234' matches ^[a-z0-9][a-z0-9-]{1,31}$ (starts with 1, length 4)
			// 'a' has length 1 so {1,31} needs a 2nd character, fails
			// 'Weather' uppercase, fails
			// 'invalid_id' underscore, fails
			// '-invalid' starts with -, fails
			// 'tool$' symbol, fails
			// 'valid-tool' passes
			expect(appAllowlist(env)).toEqual(['weather', '1234', 'valid-tool']);
		});

		test('caps at 20 entries', () => {
			const ids = Array.from({ length: 25 }, (_, i) => `app-${i + 1}`);
			const env = { MCP_APPS_ALLOW: ids.join(',') };
			const result = appAllowlist(env);
			expect(result).toHaveLength(20);
			expect(result).toEqual(ids.slice(0, 20));
		});
	});
});

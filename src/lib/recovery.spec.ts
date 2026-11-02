import { expect, test } from 'vitest';
import { recoveryFor } from './recovery';

/**
 * `recoveryFor` turns a runtime error string into the one sentence and the links the user sees.
 * Every branch is reachable from `RecoveryNotice`, and the ordering is the contract: an error
 * that mentions two causes must get the more specific advice. Nothing here retries a write.
 */

test('a recording limit points at Saved recordings instead of a reload', () => {
	const recovery = recoveryFor('recording limit reached for this run');
	expect(recovery).toMatchObject({ reload: false, links: [] });
	expect(recovery.hint).toMatch(/Saved recordings/);
});

test('a blocked external site is explained, not retried', () => {
	for (const message of [
		'captcha required',
		'automated traffic detected',
		'consent prompt blocked the page',
		'Google blocked this request'
	]) {
		const recovery = recoveryFor(message);
		expect(recovery, message).toMatchObject({ reload: false, links: [] });
		expect(recovery.hint, message).toMatch(/blocked this browser run/);
	}
});

test('a Windows-app failure links to the RPA surface and never offers a reload', () => {
	const recovery = recoveryFor('the native Solitaire window is not visible');
	expect(recovery.reload).toBe(false);
	expect(recovery.links).toEqual([{ label: 'Windows RPA', href: '#apps' }]);
	expect(recovery.hint).toMatch(/stops without a click/);
});

test('an auth failure is the case that does ask for a reload', () => {
	for (const message of ['401 unauthorized', 'missing bearer token', 'access token expired']) {
		const recovery = recoveryFor(message);
		expect(recovery, message).toMatchObject({ reload: true, links: [] });
		expect(recovery.hint, message).toMatch(/Reload the app/);
	}
	// British spelling is matched too, so a localised message still recovers.
	expect(recoveryFor('unauthorised').reload).toBe(true);
});

test('a transport failure reloads and offers the device list', () => {
	for (const message of [
		'fetch failed',
		'network error',
		'connection closed',
		'cannot reach the runtime',
		'server is unavailable'
	]) {
		const recovery = recoveryFor(message);
		expect(recovery, message).toMatchObject({ reload: true });
		expect(recovery.links, message).toEqual([{ label: 'Paired devices', href: '#devices' }]);
	}
});

test('an unsupported device sends the user to the two settings screens', () => {
	const recovery = recoveryFor('this model is not verified for that device');
	expect(recovery).toMatchObject({ reload: false });
	expect(recovery.links.map((link) => link.href)).toEqual(['#backends', '#setup']);
	expect(recoveryFor('driver compile failed').links).toEqual(recovery.links);
});

test('a missing dependency points at Setup check and Models, not at an installer', () => {
	const recovery = recoveryFor('openvino is not installed');
	expect(recovery.links.map((link) => link.href)).toEqual(['#setup', '#models']);
	expect(recovery.hint).toMatch(/no package manager/);
});

test('a stale preview and a busy runtime are separate answers with no links', () => {
	const stale = recoveryFor('the preview expired');
	expect(stale).toMatchObject({ reload: false, links: [] });
	expect(stale.hint).toMatch(/fresh preview/);

	const busy = recoveryFor('429 rate limit');
	expect(busy).toMatchObject({ reload: false, links: [] });
	expect(busy.hint).toMatch(/Wait for the current operation/);
	expect(recoveryFor('an operation is already running').hint).toBe(busy.hint);
});

test('a denied microphone is not treated as a network problem', () => {
	const recovery = recoveryFor('microphone permission denied');
	expect(recovery).toMatchObject({ reload: false, links: [] });
	expect(recovery.hint).toMatch(/browser's permission/);
	// The word "denied" alone is enough; the message need not name the microphone.
	expect(recoveryFor('permission denied').hint).toBe(recovery.hint);
});

test('a full context window suggests a new chat rather than a reload', () => {
	const recovery = recoveryFor('context limit reached');
	expect(recovery.reload).toBe(false);
	expect(recovery.links).toEqual([{ label: 'Open Chat', href: '#chat' }]);
	expect(recovery.hint).toMatch(/Shorten the message/);
});

test('anything unrecognised still tells the user their input survived', () => {
	const recovery = recoveryFor('weird internal thing');
	expect(recovery).toMatchObject({ reload: false });
	expect(recovery.links).toEqual([{ label: 'Setup check', href: '#setup' }]);
	expect(recovery.hint).toMatch(/Your input is preserved/);
	// Empty text is the same fallback, not a crash.
	expect(recoveryFor('')).toEqual(recovery);
});

test('the specific cause wins when one message names two of them', () => {
	// "401" and "fetch" both match; the auth branch comes first and asks for a reload only.
	const both = recoveryFor('fetch failed with 401');
	expect(both.hint).toMatch(/Reload the app to refresh/);
	expect(both.links).toEqual([]);

	// A capture failure that also mentions a missing model resolves as a device problem.
	const deviceAndModel = recoveryFor('not verified for this device and no model installed');
	expect(deviceAndModel.links.map((link) => link.href)).toEqual(['#backends', '#setup']);
});

test('matching is case-insensitive, because runtime messages are not normalised', () => {
	expect(recoveryFor('CAPTCHA required').hint).toBe(recoveryFor('captcha required').hint);
	expect(recoveryFor('UNAUTHORIZED').reload).toBe(true);
	expect(recoveryFor('Fetch Failed').reload).toBe(true);
});

test('no branch ever claims the app will retry an operation', () => {
	for (const message of [
		'expired preview',
		'already exists',
		'busy',
		'network',
		'401',
		'driver',
		'microphone',
		'context'
	]) {
		expect(recoveryFor(message).hint, message).not.toMatch(/\bretry|resend|will run again\b/i);
	}
});

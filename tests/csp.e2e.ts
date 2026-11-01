import { expect, test } from '@playwright/test';

/**
 * The CSP is enforced, not reported. These tests read the real response header and then try
 * to violate the policy in the browser, because a header that is present but ignored by the
 * browser is worth nothing.
 */

function directives(header: string): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const part of header.split(';')) {
		const tokens = part.trim().split(/\s+/).filter(Boolean);
		if (!tokens.length) continue;
		map.set(tokens[0].toLowerCase(), tokens.slice(1));
	}
	return map;
}

test('the page ships an enforced CSP with a nonce and no unsafe script sources', async ({
	page
}) => {
	const response = await page.goto('/');
	expect(response).not.toBeNull();

	// Enforced, not report-only. A report-only policy would leave the second header empty.
	const policy = response!.headers()['content-security-policy'];
	expect(policy, 'Content-Security-Policy header is missing').toBeTruthy();
	expect(response!.headers()['content-security-policy-report-only']).toBeUndefined();

	const map = directives(policy);
	const scriptSrc = map.get('script-src');
	expect(
		scriptSrc,
		'script-src must be explicit; CSP does not inherit nonces from default-src'
	).toBeTruthy();

	// The whole point of the exercise: a nonce, never an inline allowance.
	expect(scriptSrc!.some((source) => source.startsWith("'nonce-"))).toBe(true);
	expect(scriptSrc).not.toContain("'unsafe-inline'");
	expect(scriptSrc).not.toContain("'unsafe-eval'");
	expect(scriptSrc).not.toContain("'wasm-unsafe-eval'");

	// Directives that need no relaxation here; if one of these ever disappears, something
	// started relying on the fallback to default-src and lost its fence.
	expect(map.get('object-src')).toEqual(["'none'"]);
	expect(map.get('base-uri')).toEqual(["'none'"]);
	expect(map.get('frame-ancestors')).toEqual(["'none'"]);
	expect(map.get('form-action')).toEqual(["'self'"]);

	// `style-src 'unsafe-inline'` is the one deliberate relaxation and it is asserted here so
	// nobody widens it silently. It exists because `ArtifactFrame.svelte` renders a
	// model-written fragment with `srcdoc`, and a srcdoc document inherits this policy; its
	// `<style>` blocks cannot carry a nonce. Scripts stay nonce-only, and the artifact frame
	// is `sandbox=""`, so this buys styling, not execution.
	expect(map.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
	expect(map.get('style-src-elem')).toBeUndefined();
});

test('the browser actually blocks an un-nonced inline script while the nonced one ran', async ({
	page
}) => {
	const violations: string[] = [];
	await page.exposeFunction('recordViolation', (blocked: string) => violations.push(blocked));
	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (event) => {
			// @ts-expect-error exposed by the test
			void window.recordViolation(`${event.violatedDirective} ${event.blockedURI}`);
		});
	});

	await page.goto('/');

	// Hydration proves the nonced bootstrap script was allowed to run: the shell is
	// interactive, not just server-rendered markup.
	await expect(page.getByRole('menubar', { name: 'Workspace menu' })).toBeVisible();

	// An injected inline script must not execute. `page.evaluate` needs CDP, so it survives
	// the policy; a `<script>` element appended to the document does not.
	const executed = await page.evaluate(async () => {
		const script = document.createElement('script');
		script.textContent = 'window.__cspInlineRan = true;';
		document.head.append(script);
		await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
		return (window as unknown as { __cspInlineRan?: boolean }).__cspInlineRan === true;
	});
	expect(executed, 'an inline script without a nonce was executed').toBe(false);

	expect(
		violations.some(
			(entry) => entry.startsWith('script-src-elem') || entry.startsWith('script-src')
		)
	).toBe(true);
});

test('a srcdoc artifact frame still gets its own styles, which is why style-src allows inline', async ({
	page
}) => {
	// `ArtifactFrame.svelte` renders model-written HTML with `srcdoc`, and a srcdoc document
	// inherits this page's policy. If `style-src` were tightened to nonce-only, every
	// artifact would render unstyled — that is the regression this test exists to catch.
	await page.goto('/');
	const colour = await page.evaluate(async () => {
		const frame = document.createElement('iframe');
		// The probe needs `allow-same-origin` only so the parent can read the computed style.
		// CSP inheritance for `srcdoc` does not depend on the sandbox token list, so the
		// directive under test is the same one the production `sandbox=""` frame gets.
		frame.setAttribute('sandbox', 'allow-same-origin');
		frame.srcdoc = '<style>#probe { color: rgb(1, 2, 3); }</style><div id="probe">styled</div>';
		document.body.append(frame);
		await new Promise((resolve) => setTimeout(resolve, 300));
		const doc = frame.contentDocument;
		const node = doc?.getElementById('probe');
		const value = node && doc?.defaultView ? doc.defaultView.getComputedStyle(node).color : '';
		frame.remove();
		return value;
	});
	expect(colour).toBe('rgb(1, 2, 3)');
});

test('no CSP violation is reported while the workspace shell and composer run', async ({
	page
}) => {
	const violations: string[] = [];
	page.on('console', (message) => {
		if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
	});
	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (event) => {
			console.error(
				`Content Security Policy: ${event.violatedDirective} blocked ${event.blockedURI}`
			);
		});
	});

	await page.goto('/');

	// Send a turn: this exercises the same-origin `/api` path and the local stub reply.
	const composer = page.getByRole('textbox').first();
	await composer.fill('CSP smoke');
	await composer.press('Enter');
	await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('CSP smoke');

	expect(violations).toEqual([]);
});

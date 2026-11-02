import type { Handle, HandleServerError } from '@sveltejs/kit';
import { appConfig } from '$lib/config/app';

if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(appConfig.locale)) {
	throw new Error('Set a valid language tag in appConfig.locale.');
}

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = crypto.randomUUID();
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%app.locale%', appConfig.locale)
	});
	// CSP is not set here: SvelteKit emits the enforced policy from `kit.csp` in
	// `svelte.config.js`, because it needs a per-response nonce stamped on the inline
	// bootstrap script. See `docs/csp.md`.
	// HSTS only when this request actually arrived over HTTPS: the adapter reports the scheme
	// on `event.url`, so an HTTPS deployment (including one behind a proxy that rewrites the
	// forwarded scheme) gets the header, and a plain-HTTP dev server does not claim it.
	// ponytail: no `includeSubDomains`/`preload` — those are one-way commitments for every
	// subdomain and need operator sign-off. Add them once the whole domain is HTTPS-only.
	if (event.url.protocol === 'https:')
		response.headers.set('Strict-Transport-Security', 'max-age=31536000');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	if (!response.headers.has('Referrer-Policy'))
		response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Request-Id', event.locals.requestId);
	if (event.url.pathname.startsWith('/api/') || event.url.pathname.startsWith('/auth/')) {
		response.headers.set('Cache-Control', 'no-store');
	}
	return response;
};

export const handleError: HandleServerError = ({ event, status }) => {
	const id = event.locals.requestId ?? crypto.randomUUID();
	// Provider exceptions may contain credentials or request payloads. Log only correlation data.
	console.error('request_failed', {
		id,
		status,
		method: event.request.method,
		route: event.route.id
	});
	return { message: 'Something went wrong. Please try again.', id };
};

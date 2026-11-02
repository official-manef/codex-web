import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET as robots } from './robots.txt/+server';
import { GET as sitemap } from './sitemap.xml/+server';

const { publicEnv } = vi.hoisted(() => ({
	publicEnv: { PUBLIC_SITE_URL: 'https://app.example.com' } as Record<string, string>
}));

vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));

beforeEach(() => {
	for (const key of Object.keys(publicEnv)) delete publicEnv[key];
	publicEnv.PUBLIC_SITE_URL = 'https://app.example.com';
});

describe('method discipline', () => {
	test('both routes export GET only', async () => {
		const modules = await Promise.all([
			import('./robots.txt/+server'),
			import('./sitemap.xml/+server')
		]);
		for (const module of modules) {
			expect(Object.keys(module)).toContain('GET');
			expect(Object.keys(module)).not.toContain('POST');
			expect(Object.keys(module)).not.toContain('PUT');
		}
	});

	test('the handlers take no RequestEvent, so no request input can influence the body', () => {
		expect(robots.length).toBe(0);
		expect(sitemap.length).toBe(0);
	});
});

describe('robots.txt', () => {
	test('is text/plain utf-8 and allows crawling even when indexing is off', async () => {
		publicEnv.PUBLIC_SEO_INDEXABLE = 'false';
		const response = robots();
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		const body = await response.text();
		// A crawler must still be able to read `noindex`; robots.txt is not access control.
		expect(body).toBe('User-agent: *\nAllow: /\n');
		expectNoInternals(body);
	});

	test('names the sitemap once indexing is on', async () => {
		publicEnv.PUBLIC_SEO_INDEXABLE = 'true';
		expect(await robots().text()).toBe(
			'User-agent: *\nAllow: /\nSitemap: https://app.example.com/sitemap.xml\n'
		);
	});

	test('an unset origin still emits a valid document with no dangling origin', async () => {
		delete publicEnv.PUBLIC_SITE_URL;
		publicEnv.PUBLIC_SEO_INDEXABLE = 'false';
		const body = await robots().text();
		expect(body).toBe('User-agent: *\nAllow: /\n');
		expect(body).not.toContain('undefined');
	});

	test('a non-boolean indexing flag fails loudly instead of guessing', () => {
		publicEnv.PUBLIC_SEO_INDEXABLE = 'yes';
		expect(() => robots()).toThrow(/PUBLIC_SEO_INDEXABLE/);
	});

	test('indexing without an origin fails loudly instead of publishing a relative sitemap', () => {
		delete publicEnv.PUBLIC_SITE_URL;
		publicEnv.PUBLIC_SEO_INDEXABLE = 'true';
		expect(() => robots()).toThrow(/PUBLIC_SITE_URL/);
	});

	test('a verification token is never embedded in robots.txt', async () => {
		publicEnv.PUBLIC_SEO_INDEXABLE = 'true';
		publicEnv.PUBLIC_GOOGLE_SITE_VERIFICATION = 'fake-verification-token';
		const body = await robots().text();
		expect(body).not.toContain('fake-verification-token');
	});

	test('an HTML tag smuggled into a public var is refused, not reflected', () => {
		publicEnv.PUBLIC_GOOGLE_SITE_VERIFICATION = '<meta name="x" content="y">';
		expect(() => robots()).toThrow();
	});
});

describe('sitemap.xml', () => {
	test('is application/xml utf-8 with a well-formed empty urlset when indexing is off', async () => {
		publicEnv.PUBLIC_SEO_INDEXABLE = 'false';
		const response = sitemap();
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8');
		const body = await response.text();
		expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(body).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
		expect(body).not.toContain('<url>');
		expectNoInternals(body);
	});

	test('lists every public page when indexing is on', async () => {
		publicEnv.PUBLIC_SEO_INDEXABLE = 'true';
		const body = await sitemap().text();
		// The landing page plus the two pages an OAuth reviewer must be able to reach. A policy
		// nobody can find is not a published policy, so these three are the whole public surface.
		expect(body).toContain('<loc>https://app.example.com/</loc>');
		expect(body).toContain('<loc>https://app.example.com/privacy</loc>');
		expect(body).toContain('<loc>https://app.example.com/terms</loc>');
		expect(body.match(/<url>/g)).toHaveLength(3);
	});

	test('the origin is escaped rather than interpolated raw', async () => {
		// `siteOrigin` rejects a path or query, so an unescaped `&` cannot reach the document.
		publicEnv.PUBLIC_SITE_URL = 'https://app.example.com/?a=1&b=2';
		publicEnv.PUBLIC_SEO_INDEXABLE = 'true';
		expect(() => sitemap()).toThrow();
	});

	test('a non-boolean indexing flag fails loudly', () => {
		publicEnv.PUBLIC_SEO_INDEXABLE = 'sometimes';
		expect(() => sitemap()).toThrow(/PUBLIC_SEO_INDEXABLE/);
	});

	test('indexing without an origin fails loudly', () => {
		delete publicEnv.PUBLIC_SITE_URL;
		publicEnv.PUBLIC_SEO_INDEXABLE = 'true';
		expect(() => sitemap()).toThrow(/PUBLIC_SITE_URL/);
	});

	test('a malformed Twitter handle is refused instead of emitted', () => {
		publicEnv.PUBLIC_TWITTER_SITE = 'not-a-handle';
		expect(() => sitemap()).toThrow(/PUBLIC_TWITTER_SITE/);
	});
});

function expectNoInternals(text: string) {
	expect(text).not.toMatch(/\n\s+at .+:\d+:\d+/);
	expect(text).not.toContain('/home/');
}

import { appConfig } from './app';
import { assets } from '../../../assets.config';

export function siteOrigin(value = '') {
	if (!value) return undefined;
	const url = new URL(value);
	if (
		!['https:', 'http:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		throw new Error(
			'PUBLIC_SITE_URL must be an HTTP(S) origin without credentials, path, query or fragment.'
		);
	}
	if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
		throw new Error('PUBLIC_SITE_URL must use HTTPS outside local development.');
	}
	return url.origin;
}

export function pageMetadata(meta: App.PageData['meta'], pathname: string, origin?: string) {
	return {
		title: meta?.title ? `${meta.title} · ${appConfig.name}` : appConfig.name,
		description: meta?.description ?? appConfig.description,
		// Never infer the canonical host from an incoming Host header.
		canonical: origin ? `${origin}${pathname}` : undefined,
		image: origin ? `${origin}${assets.socialImage.path}` : assets.socialImage.path
	};
}

// Public values only. Never pass a private integration config to this browser module.
export function seoSettings(env: Readonly<Record<string, string | undefined>>) {
	const origin = siteOrigin(env.PUBLIC_SITE_URL);
	const setting = env.PUBLIC_SEO_INDEXABLE || 'false';
	if (!['true', 'false'].includes(setting))
		throw new Error('PUBLIC_SEO_INDEXABLE must be true or false.');
	if (setting === 'true' && !origin)
		throw new Error('PUBLIC_SITE_URL is required before enabling indexing.');
	const token = (key: string) => {
		const value = env[key]?.trim() || undefined;
		if (value && !/^[A-Za-z0-9_-]{1,256}$/.test(value))
			throw new Error(`${key} must contain only the verification token, not an HTML tag.`);
		return value;
	};
	const twitterSite = env.PUBLIC_TWITTER_SITE?.trim() || undefined;
	if (twitterSite && !/^@[A-Za-z0-9_]{1,15}$/.test(twitterSite))
		throw new Error('PUBLIC_TWITTER_SITE must be an @username.');
	return {
		origin,
		indexable: setting === 'true',
		googleVerification: token('PUBLIC_GOOGLE_SITE_VERIFICATION'),
		bingVerification: token('PUBLIC_BING_SITE_VERIFICATION'),
		twitterSite
	};
}

export function pageIndexable(
	seo: ReturnType<typeof seoSettings>,
	meta: App.PageData['meta'],
	status = 200
) {
	return seo.indexable && status >= 200 && status < 300 && meta?.indexable !== false;
}

export function robotsDocument(seo: ReturnType<typeof seoSettings>) {
	// Crawlers must be able to read noindex. robots.txt is not an access-control mechanism.
	return `User-agent: *\nAllow: /\n${seo.indexable ? `Sitemap: ${seo.origin}/sitemap.xml\n` : ''}`;
}

export function sitemapDocument(seo: ReturnType<typeof seoSettings>) {
	// The public pages that exist as routes. `/privacy` and `/terms` are listed because an OAuth
	// reviewer has to reach them, and a page nobody can find is not a published policy.
	const paths = ['/', '/privacy', '/terms'];
	const locations = seo.indexable
		? paths.map((path) => `<url><loc>${seo.origin}${path}</loc></url>`).join('')
		: '';
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations}</urlset>\n`;
}

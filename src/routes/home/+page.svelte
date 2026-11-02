<script lang="ts">
	import { appConfig } from '$lib/config/app';
	import { legal } from '$lib/config/legal';

	// Public landing. Deliberately not a marketing page: it exists so a visitor — or a reviewer
	// checking an OAuth consent screen — can confirm what the service is, and reach the two
	// legal pages, without signing in or loading the workspace bundle.
	const features = [
		{
			title: 'Bring your own key',
			body: 'Paste your own provider key. It stays in the tab you pasted it in: no browser storage, no URL, no log. Supported providers are pinned to a fixed origin, so a key cannot be redirected elsewhere.'
		},
		{
			title: 'Local by default',
			body: 'Conversations, memories and project labels live in your browser. Signing in is optional and only unlocks the features that need an owner-scoped store.'
		},
		{
			title: 'A console, not an agent',
			body: 'This build executes nothing on your machine. A shell is reachable only through a bridge you run yourself and deliberately pair.'
		},
		{
			title: 'Readable source',
			body: `Every claim on this page is checkable in the ${legal.license}-licensed source, which is public.`
		}
	];
</script>

<svelte:head>
	<title>{legal.appName} — {legal.tagline}</title>
	<meta
		name="description"
		content="{legal.appName}: {legal.tagline}. Open-source AI workspace with BYOK chat, local-first state and no telemetry."
	/>
	<meta name="robots" content="index,follow" />
</svelte:head>

<main class="landing">
	<header>
		<div class="brand">
			<span class="mark" aria-hidden="true">◆</span>
			<div>
				<h1>{legal.appName}</h1>
				<p class="tagline">{legal.tagline}</p>
			</div>
		</div>
		<nav aria-label="Legal and source">
			<a href={legal.sourceUrl}>Source</a>
			<a href="/privacy">Privacy</a>
			<a href="/terms">Terms</a>
		</nav>
	</header>

	<section class="hero">
		<p class="eyebrow">{appConfig.name}</p>
		<h2>A workspace you drive with your own model access.</h2>
		<p class="lede">
			Chat, memories and projects in one shell, with your provider key held in the tab and nothing
			sent anywhere you did not choose. Sign-in is optional; it only adds the features that need a
			place to store what you own.
		</p>
		<div class="actions">
			<a class="primary" href="/">Open the workspace</a>
			<a href={legal.sourceUrl}>Read the source</a>
		</div>
		<p class="fine">
			No analytics, no advertising trackers, no telemetry. The operator is {legal.operator}.
		</p>
	</section>

	<section class="grid" aria-label="What it does">
		{#each features as feature (feature.title)}
			<article>
				<h3>{feature.title}</h3>
				<p>{feature.body}</p>
			</article>
		{/each}
	</section>

	<section class="links">
		<h3>Before you sign in</h3>
		<p>
			What is collected, and what is not, is written out in the
			<a href="/privacy">Privacy Policy</a>. The terms you agree to are in the
			<a href="/terms">Terms of Service</a>. Both are plain pages: no cookie wall, no consent
			theatre.
		</p>
	</section>

	<footer>
		<p>
			{legal.appName} · {legal.license} licence ·
			<a href="mailto:{legal.contactEmail}">{legal.contactEmail}</a>
		</p>
	</footer>
</main>

<style>
	.landing {
		display: flex;
		flex-direction: column;
		max-width: 82ch;
		margin: 0 auto;
		padding: 40px 24px 72px;
		line-height: 1.65;
		font-size: 14px;
		background: var(--color-page, #0d0d0d);
		color: var(--color-ink, #ededed);
		min-height: 100dvh;
		overflow-y: auto;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--color-line, #2b2b2b);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.mark {
		color: var(--color-accent, #b998f2);
		font-size: 18px;
	}
	h1 {
		font-size: 17px;
		font-weight: 600;
		margin: 0;
		letter-spacing: 0.01em;
	}
	.tagline {
		margin: 2px 0 0;
		font-size: 12px;
		color: var(--color-ink-3, #808080);
	}
	nav {
		display: flex;
		gap: 18px;
		font-size: 12.5px;
	}
	.hero {
		padding: 52px 0 40px;
	}
	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 11px;
		color: var(--color-ink-3, #808080);
		margin: 0 0 12px;
	}
	.hero h2 {
		font-size: 30px;
		line-height: 1.22;
		margin: 0 0 16px;
		font-weight: 600;
		max-width: 30ch;
	}
	.lede {
		font-size: 15px;
		color: var(--color-ink-2, #b2b2b2);
		max-width: 62ch;
		margin: 0 0 24px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
		margin-bottom: 16px;
	}
	.primary {
		background: var(--color-ink, #ededed);
		color: var(--color-page, #0d0d0d);
		padding: 9px 16px;
		border-radius: 7px;
		font-weight: 500;
		text-decoration: none;
	}
	.fine {
		font-size: 12px;
		color: var(--color-ink-3, #808080);
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 18px;
		padding: 8px 0 32px;
	}
	.grid article {
		border: 1px solid var(--color-line, #2b2b2b);
		border-radius: 10px;
		padding: 16px 18px;
	}
	.grid h3,
	.links h3 {
		font-size: 13.5px;
		font-weight: 600;
		margin: 0 0 6px;
	}
	.grid p,
	.links p {
		margin: 0;
		font-size: 12.5px;
		color: var(--color-ink-2, #b2b2b2);
	}
	.links {
		border-top: 1px solid var(--color-line, #2b2b2b);
		padding-top: 24px;
	}
	.links h3 {
		margin-bottom: 8px;
	}
	a {
		color: var(--color-link, #9ecbff);
		text-underline-offset: 3px;
	}
	nav a {
		color: var(--color-ink-2, #b2b2b2);
		text-decoration: none;
	}
	nav a:hover {
		color: var(--color-ink, #ededed);
	}
	footer {
		margin-top: 40px;
		padding-top: 18px;
		border-top: 1px solid var(--color-line, #2b2b2b);
		font-size: 12px;
		color: var(--color-ink-3, #808080);
	}
	footer p {
		margin: 0;
	}
	@media (max-width: 640px) {
		.landing {
			padding: 28px 18px 56px;
		}
		.hero {
			padding: 36px 0 28px;
		}
		.hero h2 {
			font-size: 23px;
		}
	}
</style>

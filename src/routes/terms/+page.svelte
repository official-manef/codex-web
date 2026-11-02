<script lang="ts">
	import { legal } from '$lib/config/legal';
</script>

<svelte:head>
	<title>Terms of Service · {legal.appName}</title>
	<meta
		name="description"
		content="The terms under which {legal.appName} is provided: what you may do, what the operator may do, and what is excluded."
	/>
	<meta name="robots" content="index,follow" />
</svelte:head>

<main class="legal-page">
	<article>
		<header>
			<p class="eyebrow">Legal</p>
			<h1>Terms of Service</h1>
			<p class="lede">
				{legal.appName} is the {legal.tagline}, provided as open-source software under the
				{legal.license} licence. These terms cover the hosted service at
				<a href={legal.appUrl}>{legal.appUrl.replace('https://', '')}</a>. The licence covers the
				code; this page covers the running instance.
			</p>
			<dl class="facts">
				<div>
					<dt>Effective</dt>
					<dd>{legal.effectiveDate}</dd>
				</div>
				<div>
					<dt>Operator</dt>
					<dd>{legal.operator}</dd>
				</div>
				<div>
					<dt>Contact</dt>
					<dd><a href="mailto:{legal.contactEmail}">{legal.contactEmail}</a></dd>
				</div>
				<div>
					<dt>Source</dt>
					<dd><a href={legal.sourceUrl}>{legal.sourceUrl.replace('https://', '')}</a></dd>
				</div>
			</dl>
		</header>

		<section>
			<h2>1. Acceptance</h2>
			<p>
				By using the service you agree to these terms. If you do not agree, do not use it. If you
				use it on behalf of an organisation, you confirm you may accept these terms for that
				organisation.
			</p>
		</section>

		<section>
			<h2>2. What the service is</h2>
			<p>
				A browser workspace that lets you talk to AI models using your own provider credentials. It
				is a console, not an agent: it does not execute commands on your machine except through a
				bridge you run yourself and deliberately pair.
			</p>
			<p>
				You supply your own provider key. You are the customer of that provider, and their terms and
				billing apply to your use of their model. The operator of this service does not resell model
				access and takes no margin on your usage.
			</p>
		</section>

		<section>
			<h2>3. Accounts</h2>
			<p>
				Sign-in is optional. Without it, chat, memories and projects run entirely in your browser.
				With it, features that need an owner-scoped store become available.
			</p>
			<p>
				You are responsible for activity under your account and for keeping your own credentials
				secure. Do not share an account. One account is for one person.
			</p>
		</section>

		<section>
			<h2>4. Acceptable use</h2>
			<p>You must not use the service to:</p>
			<ul>
				<li>break any law that applies to you, or help anyone else do so;</li>
				<li>
					generate or distribute material that is unlawful, sexually exploitative of minors, or
					intended to harass a specific person;
				</li>
				<li>
					attack, probe or overload the service, evade its rate limits, or attempt to reach data
					belonging to another user;
				</li>
				<li>
					infringe intellectual property, or misrepresent AI output as human-authored where that
					misrepresentation is itself unlawful;
				</li>
				<li>
					bypass a provider's usage policies through this interface — your obligations to your
					provider survive these terms.
				</li>
			</ul>
			<p>
				Automated access is limited to the published HTTP interface, at the published rate. Scraping
				beyond that, or reselling access to the service, is not permitted.
			</p>
		</section>

		<section>
			<h2>5. Your content</h2>
			<p>
				You keep whatever rights you have in what you submit. You grant the operator only the
				limited permission needed to operate the feature you used — for example, relaying a message
				to the provider you selected, or storing a note you asked to be stored.
			</p>
			<p>
				The operator does not claim a licence to train models on your content, does not sell it, and
				does not publish it.
			</p>
		</section>

		<section>
			<h2>6. AI output</h2>
			<p>
				Model output can be wrong, incomplete, or confidently mistaken. It is not professional
				advice — not legal, medical, financial or security advice — and it must not be relied on as
				if it were. Verify anything that matters before acting on it.
			</p>
			<p>
				You are responsible for what you do with the output, including anything you publish or ship.
			</p>
		</section>

		<section>
			<h2>7. Availability and changes</h2>
			<p>
				The service is provided as-is, with no uptime commitment. Features may change, and a feature
				may be withdrawn when it is unsafe or unmaintained. Where a change would break how you use
				it, the operator will say so in the public repository rather than silently.
			</p>
			<p>
				The operator may suspend or close an account that breaches §4, or where suspension is
				required by law.
			</p>
		</section>

		<section>
			<h2>8. Open-source licence</h2>
			<p>
				The source is published under the {legal.license} licence. That licence governs copying, modifying
				and redistributing the code. Nothing in these terms restricts rights the licence grants you —
				including running your own instance.
			</p>
		</section>

		<section>
			<h2>9. Disclaimers and liability</h2>
			<p>
				To the extent permitted by law, the service is provided without warranties of any kind, and
				the operator is not liable for indirect, incidental or consequential loss, nor for loss of
				profit, data or goodwill arising from your use of it. Where liability cannot be excluded, it
				is limited to the amount you paid to use the service — which, for this hosted instance, is
				nothing.
			</p>
			<p>
				Nothing here excludes liability for fraud, or for anything else that cannot lawfully be
				excluded.
			</p>
		</section>

		<section>
			<h2>10. Termination</h2>
			<p>
				You may stop using the service at any time, and may ask for your stored data to be deleted
				at <a href="mailto:{legal.contactEmail}">{legal.contactEmail}</a>. Browser-stored data you
				can delete yourself. On termination, the permissions in §5 end, other than what the operator
				must keep to meet a legal obligation.
			</p>
		</section>

		<section>
			<h2>11. Governing law</h2>
			<p>
				These terms are governed by the laws of {legal.jurisdiction}. Disputes are subject to the
				competent courts there, without depriving you of protection given by mandatory law where you
				live.
			</p>
		</section>

		<section>
			<h2>12. Changes to these terms</h2>
			<p>
				A material change updates the effective date above. The previous wording stays in the
				repository history at <a href={legal.sourceUrl}>{legal.sourceUrl.replace('https://', '')}</a
				>, so a change can be read as a diff rather than taken on trust.
			</p>
		</section>

		<footer>
			<p>
				See also the <a href="/privacy">Privacy Policy</a>. Operator: {legal.operator}, {legal.jurisdiction}.
			</p>
		</footer>
	</article>
</main>

<style>
	.legal-page {
		min-height: 100dvh;
		overflow-y: auto;
		background: var(--color-page, #0d0d0d);
		color: var(--color-ink, #ededed);
	}
	article {
		max-width: 74ch;
		margin: 0 auto;
		padding: 48px 24px 96px;
		line-height: 1.65;
		font-size: 14px;
	}
	header {
		border-bottom: 1px solid var(--color-line, #2b2b2b);
		padding-bottom: 24px;
		margin-bottom: 8px;
	}
	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 11px;
		color: var(--color-ink-3, #808080);
		margin: 0 0 10px;
	}
	h1 {
		font-size: 30px;
		line-height: 1.2;
		margin: 0 0 14px;
		font-weight: 600;
	}
	.lede {
		font-size: 15px;
		color: var(--color-ink-2, #b2b2b2);
		margin: 0 0 20px;
	}
	.facts {
		display: grid;
		gap: 6px;
		margin: 0;
		font-size: 12.5px;
	}
	.facts div {
		display: flex;
		gap: 10px;
	}
	.facts dt {
		min-width: 84px;
		color: var(--color-ink-3, #808080);
	}
	.facts dd {
		margin: 0;
	}
	h2 {
		font-size: 16px;
		margin: 34px 0 10px;
		font-weight: 600;
	}
	p,
	li {
		color: var(--color-ink-2, #b2b2b2);
	}
	p {
		margin: 0 0 12px;
	}
	ul {
		margin: 0 0 12px;
		padding-left: 20px;
	}
	li {
		margin-bottom: 6px;
	}
	a {
		color: var(--color-link, #9ecbff);
		text-underline-offset: 3px;
	}
	footer {
		margin-top: 40px;
		padding-top: 20px;
		border-top: 1px solid var(--color-line, #2b2b2b);
		font-size: 12.5px;
	}
	@media (max-width: 640px) {
		article {
			padding: 32px 18px 72px;
		}
		h1 {
			font-size: 24px;
		}
	}
</style>

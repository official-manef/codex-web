<script lang="ts">
	import { legal } from '$lib/config/legal';
</script>

<svelte:head>
	<title>Privacy Policy · {legal.appName}</title>
	<meta
		name="description"
		content="What {legal.appName} collects, why, how long it is kept, and how to have it deleted."
	/>
	<meta name="robots" content="index,follow" />
</svelte:head>

<main class="legal-page">
	<article>
		<header>
			<p class="eyebrow">Legal</p>
			<h1>Privacy Policy</h1>
			<p class="lede">
				{legal.appName} is the {legal.tagline}. This page states what the service actually does with
				your data, in the present tense. If a claim here is not true of the running build, the claim
				is the thing that is wrong — the source is public at
				<a href={legal.sourceUrl}>{legal.sourceUrl.replace('https://', '')}</a>.
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
			</dl>
		</header>

		<section>
			<h2>1. What is collected</h2>
			<p>
				Only what the features you use require. There is no analytics product, no advertising
				tracker and no third-party session recorder in this build.
			</p>
			<table>
				<thead>
					<tr
						><th scope="col">Data</th><th scope="col">When</th><th scope="col">Where it lives</th
						></tr
					>
				</thead>
				<tbody>
					<tr>
						<th scope="row"
							>Google account identity: stable subject id, and your email only when Google marks it
							verified</th
						>
						<td>When you sign in with Google</td>
						<td>An encrypted <code>HttpOnly</code> cookie in your browser. Not a user database.</td>
					</tr>
					<tr>
						<th scope="row">Provider API key (BYOK)</th>
						<td>When you paste a key to use your own provider</td>
						<td>
							For the duration of the browser tab, in memory only. It is not written to browser
							storage, not placed in a URL and not logged.
						</td>
					</tr>
					<tr>
						<th scope="row">Conversation text and attachments you submit</th>
						<td>When you send a message</td>
						<td>
							Held in the current browser session, then sent to the provider you selected, under
							your own key. Not stored on this server.
						</td>
					</tr>
					<tr>
						<th scope="row">Notes, memories and project labels you create</th>
						<td>When you create them</td>
						<td>
							In this browser's <code>localStorage</code>, unless you enable the Convex-backed
							option, in which case they are stored on the configured deployment under your
							signed-in identity.
						</td>
					</tr>
					<tr>
						<th scope="row">Server logs</th>
						<td>Only when an operator sets <code>LOG_LEVEL</code></td>
						<td>
							Off by default. When enabled: event name, provider, model, counts and outcome. Never
							message text, keys, cookies or full URLs. Kept in a local file on the host.
						</td>
					</tr>
					<tr>
						<th scope="row">Rate-limit counters</th>
						<td>On each API request</td>
						<td>
							A hashed key and a count, in process memory, expiring after one minute. Not a session
							or credential store.
						</td>
					</tr>
				</tbody>
			</table>
		</section>

		<section>
			<h2>2. What is not collected</h2>
			<p>
				No advertising identifiers. No cross-site tracking. No contact-list, calendar, Drive or
				Gmail access: the sign-in scope requests your identity only. No payment data — the service
				has no billing. No keystroke or screen recording.
			</p>
		</section>

		<section>
			<h2>3. Cookies</h2>
			<p>Two cookies, both set only when you sign in:</p>
			<ul>
				<li>
					<strong>Session</strong> — an encrypted, <code>HttpOnly</code>, <code>SameSite=Lax</code>
					cookie holding your identity and expiry. Valid for at most one hour from sign-in.
				</li>
				<li>
					<strong>Login transaction</strong> — a ten-minute encrypted cookie carrying the OAuth
					<code>state</code> and <code>nonce</code> for one sign-in attempt, then discarded.
				</li>
			</ul>
			<p>Nothing is stored for advertising or analytics. Signing out deletes both.</p>
		</section>

		<section>
			<h2>4. Who processes it</h2>
			<ul>
				<li>
					<strong>Google</strong> — the identity provider, when you choose to sign in.
				</li>
				<li>
					<strong>Your chosen AI provider</strong> — OpenAI, Anthropic, Google, or a self-hosted gateway
					you point at. Your prompts go there under your own key. Each provider's policy applies, not
					this one.
				</li>
				<li>
					<strong>The hosting platform</strong> — the deployment serving these pages, which keeps standard
					request logs.
				</li>
				<li>
					<strong>Convex</strong> — only if this deployment is configured with a Convex backend and you
					use the account-backed features.
				</li>
			</ul>
			<p>There is no data broker, no resale, and no sharing beyond the processors listed above.</p>
		</section>

		<section>
			<h2>5. Why it is processed</h2>
			<p>
				To authenticate you, to run the request you asked for, to enforce rate limits that keep the
				service available, and to diagnose failures when an operator has enabled logging. Nothing is
				processed for profiling or automated decisions about you.
			</p>
		</section>

		<section>
			<h2>6. Retention</h2>
			<ul>
				<li>Session cookie: at most one hour, then gone.</li>
				<li>Login transaction cookie: at most ten minutes.</li>
				<li>Provider key: until you close the tab or press “Forget key”.</li>
				<li>Browser-stored notes: until you delete them in the app or clear site data.</li>
				<li>Rate-limit counters: one minute.</li>
				<li>Server logs, when enabled: rotated by the operator of that host.</li>
			</ul>
		</section>

		<section>
			<h2>7. Your choices</h2>
			<p>
				You can use the workspace without signing in: chat, memories and projects then run entirely
				in your browser. You can sign out at any time, which deletes the session cookies. You can
				delete browser-stored data yourself under the app's memories and projects screens.
			</p>
			<p>
				To request access to, correction of, or deletion of data held under your identity, write to
				<a href="mailto:{legal.contactEmail}">{legal.contactEmail}</a> from the address you signed in
				with. Requests are answered within 30 days.
			</p>
		</section>

		<section>
			<h2>8. Security</h2>
			<p>
				Traffic is served over HTTPS. Session and transaction cookies are encrypted with
				AES-256-GCM; the session cookie carries the <code>__Host-</code> prefix in production. The
				login flow verifies the ID token signature against Google's published keys, and checks
				issuer, audience, expiry, <code>state</code> and <code>nonce</code>. Provider requests are
				pinned to a fixed origin per provider, so a key cannot be redirected elsewhere.
			</p>
			<p>
				No system is perfect. If you find a weakness, report it to
				<a href="mailto:{legal.contactEmail}">{legal.contactEmail}</a> rather than disclosing it publicly
				first.
			</p>
		</section>

		<section>
			<h2>9. Children</h2>
			<p>
				The service is not directed at children under 13, and an account must not be created for
				one. If such an account is discovered it is deleted.
			</p>
		</section>

		<section>
			<h2>10. Changes</h2>
			<p>
				If this policy changes materially, the effective date above changes and the previous wording
				remains in the public repository history at
				<a href={legal.sourceUrl}>{legal.sourceUrl.replace('https://', '')}</a>.
			</p>
		</section>

		<footer>
			<p>
				See also the <a href="/terms">Terms of Service</a>. Operator: {legal.operator}, {legal.jurisdiction}.
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
	code {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 12px;
		background: var(--color-panel-2, #262626);
		padding: 1px 5px;
		border-radius: 4px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		margin: 0 0 12px;
		font-size: 12.5px;
	}
	th,
	td {
		text-align: left;
		vertical-align: top;
		padding: 8px 10px;
		border-bottom: 1px solid var(--color-line, #2b2b2b);
	}
	thead th {
		color: var(--color-ink-3, #808080);
		font-weight: 500;
		font-size: 11.5px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	tbody th {
		font-weight: 500;
		color: var(--color-ink, #ededed);
		width: 34%;
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
		table,
		thead,
		tbody,
		tr,
		th,
		td {
			display: block;
		}
		thead {
			display: none;
		}
		tbody th {
			width: auto;
			padding-bottom: 2px;
		}
		tbody td {
			border-bottom: 1px solid var(--color-line, #2b2b2b);
		}
	}
</style>

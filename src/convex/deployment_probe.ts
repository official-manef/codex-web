/**
 * Which state a Convex deployment is actually in.
 *
 * A deployment can be missing, up-but-empty, or up-and-serving. Those are three different
 * facts, and the auth spec used to collapse all of them into one word: "skipped". That is
 * how a green gate hid an unproven auth boundary — port 9999 answered nothing, so four
 * security assertions silently disappeared from the run.
 *
 * The classification lives here, not in the spec, so it can be tested against fake answers
 * in CI without a live backend. `deployment.spec.ts` only reports it.
 *
 * The empty case is detected by calling a protected function anonymously and reading the
 * answer: a deployment with no functions pushed says "Could not find public function",
 * while a deployment that has them says "Please sign in." Those two strings are the whole
 * difference between "no backend" and "the auth boundary holds", so they must never be
 * allowed to look alike.
 */

export type DeploymentState = 'absent' | 'empty' | 'ready';

export interface DeploymentProbe {
	url: string;
	state: DeploymentState;
	/** One line of measured fact. Safe to paste into a report. */
	detail: string;
}

/** What a Convex deployment answers when the function was never pushed. */
const NO_FUNCTION = /could not find (?:public )?function/i;

/** What `requireUser` and the Convex auth layer answer for a caller with no identity. */
export const REFUSED = /[Ss]ign in|not_authenticated|Unauthorized|Not authenticated/;

/**
 * The local `npx convex dev` port. Not 9999: that port is dead, so pointing a gate at it
 * forces this spec to skip forever while a real deployment sits here being ignored.
 */
export const DEFAULT_DEPLOYMENT_URL = 'http://127.0.0.1:3210';

/** A protected function that exists in every build; its absence means nothing was pushed. */
const PROBE_PATH = 'devices:list';

export function deploymentUrl(env: Record<string, string | undefined> = process.env): string {
	// A blank variable is an unset variable here: `CONVEX_URL= npx vitest run` must not turn
	// into a request against the empty string.
	const url = [env.CONVEX_URL, env.PUBLIC_CONVEX_URL].find((value) => value && value.trim());
	return (url ?? DEFAULT_DEPLOYMENT_URL).trim().replace(/\/$/, '');
}

export type QueryAnswer = 'missing-functions' | 'ready' | 'unclassified';

/**
 * Read a `/api/query` body. Convex answers HTTP 200 even for errors, so the body is the only
 * signal: an error payload naming a missing function is `missing-functions`, any other error
 * or success payload means the function was deployed and the server ran it.
 */
export function classifyQueryAnswer(body: string): QueryAnswer {
	if (NO_FUNCTION.test(body)) return 'missing-functions';
	try {
		const parsed = JSON.parse(body) as { status?: string };
		if (parsed.status === 'success' || parsed.status === 'error') return 'ready';
	} catch {
		// Not JSON: no way to tell what answered, so claim nothing.
	}
	return 'unclassified';
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function firstLine(text: string): string {
	return text.split('\n').filter((line) => line.trim() !== '')[0] ?? '';
}

export async function probeDeployment(
	url: string = deploymentUrl(),
	fetcher: typeof fetch = fetch
): Promise<DeploymentProbe> {
	const base = url.replace(/\/$/, '');

	try {
		const version = await fetcher(`${base}/version`, { signal: AbortSignal.timeout(3000) });
		if (!version.ok) {
			return { url: base, state: 'absent', detail: `${base}/version answered ${version.status}` };
		}
	} catch (error) {
		return {
			url: base,
			state: 'absent',
			detail: `nothing answered at ${base} (${errorText(error)})`
		};
	}

	try {
		const response = await fetcher(`${base}/api/query`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: PROBE_PATH, args: {}, format: 'json' }),
			signal: AbortSignal.timeout(3000)
		});
		const status = response.status;
		const body = await response.text();

		switch (classifyQueryAnswer(body)) {
			case 'missing-functions':
				return {
					url: base,
					state: 'empty',
					detail: `${base} is up but has no functions pushed: ${PROBE_PATH} is not deployed`
				};
			case 'ready':
				return {
					url: base,
					state: 'ready',
					detail: `${PROBE_PATH} is deployed; anonymous call answered: ${firstLine(body)}`
				};
			case 'unclassified':
				return {
					url: base,
					state: 'empty',
					detail: `${base} answers HTTP ${status} to ${PROBE_PATH} with an unreadable body: ${firstLine(body)}`
				};
		}
	} catch (error) {
		return {
			url: base,
			state: 'empty',
			detail: `${base} answers /version but ${base}/api/query failed (${errorText(error)})`
		};
	}
}

/**
 * Why the auth assertions cannot run, or `null` when they must run. A `null` here is the
 * only state in which a skip is a lie, so the guard test pins it.
 */
export function skipReason(probe: DeploymentProbe): string | null {
	switch (probe.state) {
		case 'absent':
			return `no Convex deployment: ${probe.detail}. Auth boundary NOT exercised — start one with \`npx convex dev\`.`;
		case 'empty':
			return `deployment reachable but auth boundary NOT proven: ${probe.detail}. Run \`npx convex dev\` to push schema + functions.`;
		case 'ready':
			return null;
	}
}

/** The rejection message of `run`, or `null` when it resolved. */
export async function attempt(run: () => Promise<unknown>): Promise<string | null> {
	try {
		await run();
		return null;
	} catch (error) {
		return errorText(error);
	}
}

export type AuthFailure = 'refused' | 'missing-functions' | 'unexpected';

export function classifyAuthFailure(rejection: string | null): AuthFailure {
	if (rejection === null) return 'unexpected';
	if (NO_FUNCTION.test(rejection)) return 'missing-functions';
	if (REFUSED.test(rejection)) return 'refused';
	return 'unexpected';
}

/**
 * Turn a rejection into a verdict we are willing to defend. Anything unrecognised throws:
 * `Server Error` from a missing function must never be counted as "the boundary held", and
 * neither must a plain 500 from something else.
 */
export function assertRefused(rejection: string | null, label: string, url: string): void {
	switch (classifyAuthFailure(rejection)) {
		case 'refused':
			return;
		case 'missing-functions':
			throw new Error(
				`${label} is not deployed on ${url}, so the auth boundary was NOT exercised. ` +
					`This is a missing backend, not a passing security test. Run \`npx convex dev\` to push schema + functions. ` +
					`Raw answer: ${firstLine(rejection ?? '')}`
			);
		case 'unexpected':
			throw new Error(
				rejection === null
					? `anonymous ${label} SUCCEEDED on ${url}: an unauthenticated caller was accepted.`
					: `anonymous ${label} was rejected, but not by the auth boundary — refusing to count it as proof. Raw answer: ${firstLine(rejection)}`
			);
	}
}

/**
 * Artifact extraction and safety filtering.
 *
 * In ChatGPT / Codex desktop, the `visualize` skill lets an agent render visual
 * artifacts by writing an HTML fragment to a durable path for host viewing.
 * In this web workspace, we render untrusted model-generated HTML inside a sandboxed
 * iframe (<iframe sandbox="" srcdoc={...}>).
 *
 * The browser's `sandbox=""` attribute is the primary security boundary: with an empty
 * sandbox token list, scripts are disabled, same-origin access (cookies, storage) is
 * denied, forms and popups are blocked, and top-level navigation is prevented.
 *
 * The regex checks in `artifactRejection` serve as a defense-in-depth ceiling (a second
 * fence, not the primary one) to reject obviously unsafe or malformed payloads before
 * framing them.
 */

export const MAX_ARTIFACT_BYTES = 500_000;

export type Artifact = {
	html: string;
	title: string;
};

/**
 * True when the HTML is safe enough for a sandboxed frame; reason otherwise.
 *
 * This check is a conservative ceiling: the real containment boundary is the
 * iframe's `sandbox=""` attribute.
 */
export function artifactRejection(html: string): string | null {
	if (html.length > MAX_ARTIFACT_BYTES) {
		return 'Artifact is too large to render.';
	}

	if (
		/<script/i.test(html) ||
		/<iframe/i.test(html) ||
		/javascript:/i.test(html) ||
		/data:text\/html/i.test(html) ||
		/onload\s*=/i.test(html) ||
		/onerror\s*=/i.test(html)
	) {
		return 'Artifact contains executable content.';
	}

	if (/<base/i.test(html) || /http-equiv\s*=\s*["']?refresh/i.test(html)) {
		return 'Artifact tries to navigate.';
	}

	return null;
}

const FENCE_PATTERN = /```html\b[^\r\n]*\r?\n([\s\S]*?)```/i;
const TITLE_COMMENT_PATTERN = /^<!--\s*title:\s*([^\r\n]+?)\s*-->/i;

/** Pull the FIRST ```html fenced block out of assistant text. */
export function extractArtifact(text: string): Artifact | null {
	const match = text.match(FENCE_PATTERN);
	if (!match) {
		return null;
	}

	const html = match[1].trim();
	if (artifactRejection(html) !== null) {
		return null;
	}

	const titleMatch = html.match(TITLE_COMMENT_PATTERN);
	const title = titleMatch && titleMatch[1].trim() ? titleMatch[1].trim() : 'Artifact';

	return {
		html,
		title
	};
}

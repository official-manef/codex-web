import { describe, expect, test } from 'vitest';
import { artifactRejection, extractArtifact, MAX_ARTIFACT_BYTES, type Artifact } from './artifact';

describe('artifactRejection', () => {
	test("artifactRejection('') → null", () => {
		expect(artifactRejection('')).toBeNull();
	});

	test('a plain <div>hello</div> accepted', () => {
		expect(artifactRejection('<div>hello</div>')).toBeNull();
	});

	test('oversized rejected', () => {
		const oversized = 'a'.repeat(MAX_ARTIFACT_BYTES + 1);
		expect(artifactRejection(oversized)).toBe('Artifact is too large to render.');

		const atLimit = 'a'.repeat(MAX_ARTIFACT_BYTES);
		expect(artifactRejection(atLimit)).toBeNull();
	});

	test('a block containing <script> rejected', () => {
		expect(artifactRejection('<script>alert("xss")</script>')).toBe(
			'Artifact contains executable content.'
		);
		expect(artifactRejection('<SCRIPT src="evil.js"></SCRIPT>')).toBe(
			'Artifact contains executable content.'
		);
	});

	test('javascript: rejected', () => {
		expect(artifactRejection('<a href="javascript:alert(1)">click</a>')).toBe(
			'Artifact contains executable content.'
		);
		expect(artifactRejection('JAVASCRIPT:void(0)')).toBe('Artifact contains executable content.');
	});

	test('other executable vectors (<iframe, data:text/html, onload=, onerror=) rejected', () => {
		expect(artifactRejection('<iframe src="https://example.com"></iframe>')).toBe(
			'Artifact contains executable content.'
		);
		expect(artifactRejection('<object data="data:text/html;base64,PHNjcmlwdD4="></object>')).toBe(
			'Artifact contains executable content.'
		);
		expect(artifactRejection('<img src="x" onload=alert(1)>')).toBe(
			'Artifact contains executable content.'
		);
		expect(artifactRejection('<img src="x" onerror="alert(1)">')).toBe(
			'Artifact contains executable content.'
		);
	});

	test('meta refresh rejected', () => {
		expect(artifactRejection('<meta http-equiv="refresh" content="0;url=https://evil.com">')).toBe(
			'Artifact tries to navigate.'
		);
		expect(artifactRejection('meta http-equiv="refresh"')).toBe('Artifact tries to navigate.');
		expect(artifactRejection('<META HTTP-EQUIV=\'refresh\' CONTENT="5">')).toBe(
			'Artifact tries to navigate.'
		);
	});

	test('<base rejected', () => {
		expect(artifactRejection('<base href="https://evil.com">')).toBe('Artifact tries to navigate.');
		expect(artifactRejection('<BASE target="_blank">')).toBe('Artifact tries to navigate.');
	});
});

describe('extractArtifact', () => {
	test('extraction of a normal fenced block', () => {
		const assistantText = [
			'Here is an interactive preview:',
			'```html',
			'<div class="card">',
			'  <h1>Dashboard</h1>',
			'</div>',
			'```',
			'Let me know what you think.'
		].join('\n');

		const result: Artifact | null = extractArtifact(assistantText);
		expect(result).toEqual({
			html: '<div class="card">\n  <h1>Dashboard</h1>\n</div>',
			title: 'Artifact'
		});
	});

	test('no block → null', () => {
		expect(extractArtifact('Just a plain text message without code.')).toBeNull();
		expect(extractArtifact('```json\n{"key": "value"}\n```')).toBeNull();
		// Tolerate ~~~? No — fence is ``` only.
		expect(extractArtifact('~~~html\n<div>ignored</div>\n~~~')).toBeNull();
	});

	test('title comment parsed', () => {
		const withTitle = [
			'```html',
			'<!-- title: Quarterly Revenue Chart -->',
			'<div class="chart">Data</div>',
			'```'
		].join('\n');

		expect(extractArtifact(withTitle)).toEqual({
			html: '<!-- title: Quarterly Revenue Chart -->\n<div class="chart">Data</div>',
			title: 'Quarterly Revenue Chart'
		});

		const tightComment = ['```html', '<!--title:Tight Title-->', '<p>Hello</p>', '```'].join('\n');
		expect(extractArtifact(tightComment)?.title).toBe('Tight Title');
	});

	test('second block ignored (first wins)', () => {
		const twoBlocks = [
			'First design:',
			'```html',
			'<!-- title: First Artifact -->',
			'<div>First Content</div>',
			'```',
			'Alternative design:',
			'```html',
			'<!-- title: Second Artifact -->',
			'<div>Second Content</div>',
			'```'
		].join('\n');

		const result = extractArtifact(twoBlocks);
		expect(result).toEqual({
			html: '<!-- title: First Artifact -->\n<div>First Content</div>',
			title: 'First Artifact'
		});
	});

	test('a block containing <script> rejected', () => {
		const unsafeText = [
			'```html',
			'<div>Hello</div>',
			'<script>alert("pwned")</script>',
			'```'
		].join('\n');

		expect(extractArtifact(unsafeText)).toBeNull();
	});

	test('oversized rejected in extractArtifact', () => {
		const oversizedBlock = ['```html', 'a'.repeat(MAX_ARTIFACT_BYTES + 1), '```'].join('\n');

		expect(extractArtifact(oversizedBlock)).toBeNull();
	});

	test('javascript: rejected in extractArtifact', () => {
		const jsLink = ['```html', '<a href="javascript:void(0)">Click me</a>', '```'].join('\n');

		expect(extractArtifact(jsLink)).toBeNull();
	});

	test('meta refresh rejected in extractArtifact', () => {
		const navBlock = [
			'```html',
			'<meta http-equiv="refresh" content="0;url=https://attacker.com">',
			'```'
		].join('\n');

		expect(extractArtifact(navBlock)).toBeNull();
	});

	test('case-insensitive html fence language tag', () => {
		const upperFence = ['```HTML', '<div>Case Insensitive</div>', '```'].join('\n');

		expect(extractArtifact(upperFence)).toEqual({
			html: '<div>Case Insensitive</div>',
			title: 'Artifact'
		});
	});
});

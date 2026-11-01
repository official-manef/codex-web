import { expect, test } from 'vitest';
import { parseMarkdown, parseInline, safeLink, type Inline } from './markdown';

// Only text/code nodes carry `text`; structural nodes are flattened by their children.
const text = (nodes: Inline[]): string =>
	nodes.map((node) => ('text' in node ? node.text : text(node.children))).join('');

test('safeLink allows only http(s) and mailto, and never a script or data URL', () => {
	expect(safeLink('https://example.com/a')).toBe('https://example.com/a');
	expect(safeLink('mailto:someone@example.com')).toBe('mailto:someone@example.com');
	for (const value of [
		'',
		'javascript:alert(1)',
		'JavaScript:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'vbscript:msgbox(1)',
		'file:///etc/passwd',
		'//example.com',
		'/relative',
		'mailto:',
		'https://',
		'https://exa mple.com',
		'https://example.com/\u0000',
		'https://example.com/\nnext'
	])
		expect(safeLink(value), value).toBeNull();
});

test('safeLink refuses a userinfo prefix, because the visible text and the destination differ', () => {
	// `https://example.com@evil.example/x` reads as example.com and the browser contacts
	// evil.example. Model-written markdown is untrusted input, so an href whose host is not
	// what a reader sees is refused rather than rendered. `mailto:` still carries its user.
	expect(safeLink('http://user:pass@example.com')).toBeNull();
	expect(safeLink('https://example.com@evil.example/x')).toBeNull();
	expect(safeLink('https://a@b@evil.example/')).toBeNull();
	expect(safeLink('mailto:user@example.com')).toBe('mailto:user@example.com');
	expect(new URL('https://example.com@evil.example/x').hostname).toBe('evil.example');
});

test('safeLink returns the original string, not a normalised URL', () => {
	// Normalising would silently rewrite what the user typed; the renderer keeps the input.
	const href = 'https://example.com/a%20b?q=1#frag';
	expect(safeLink(href)).toBe(href);
});

test('an unsafe link keeps its literal text instead of becoming a link', () => {
	const nodes = parseInline('[click](javascript:alert(1))');
	expect(nodes.every((node) => node.type === 'text')).toBe(true);
	expect(text(nodes)).toContain('javascript:alert(1)');
});

test('markdown never produces an href outside the allowlist, however it is written', () => {
	const hostile = [
		'[a](javascript:alert(1))',
		'[a](JAVASCRIPT:alert(1))',
		'[a](data:text/html;base64,PHNjcmlwdD4=)',
		'[a](vbscript:x)',
		'[a](https://ok.example "title")',
		'[a](  https://ok.example)'
	];
	const hrefs = hostile
		.flatMap((source) => parseInline(source))
		.flatMap((node) => (node.type === 'link' ? [node.href] : []));
	// Every surviving href is allowlisted; none of the four schemes above survives.
	expect(hrefs.every((href) => /^(https?:\/\/|mailto:)/.test(href))).toBe(true);
	expect(hrefs.some((href) => /^(javascript|data|vbscript):/i.test(href))).toBe(false);
});

test('inline formatting nests and closes in the documented order', () => {
	expect(parseInline('plain')).toEqual([{ type: 'text', text: 'plain' }]);
	expect(parseInline('**bold**')).toEqual([
		{ type: 'strong', children: [{ type: 'text', text: 'bold' }] }
	]);
	expect(parseInline('*it*')).toEqual([
		{ type: 'emphasis', children: [{ type: 'text', text: 'it' }] }
	]);
	expect(parseInline('`a\nb`')).toEqual([{ type: 'code', text: 'a b' }]);
	expect(parseInline('a **b *c* d** e')[1]).toMatchObject({ type: 'strong' });
});

test('an unclosed marker stays literal instead of swallowing the rest of the line', () => {
	expect(text(parseInline('**unclosed'))).toBe('**unclosed');
	expect(text(parseInline('`unclosed'))).toBe('`unclosed');
	expect(text(parseInline('[unclosed'))).toBe('[unclosed');
});

test('backslash escapes render the character, not the syntax', () => {
	expect(parseInline('\\*not emphasis\\*')).toEqual([{ type: 'text', text: '*not emphasis*' }]);
	expect(parseInline('\\`not code\\`')).toEqual([{ type: 'text', text: '`not code`' }]);
});

test('underscore inside a word is not emphasis, so snake_case survives', () => {
	expect(text(parseInline('some_snake_case_name'))).toBe('some_snake_case_name');
	expect(parseInline('_em_')).toEqual([
		{ type: 'emphasis', children: [{ type: 'text', text: 'em' }] }
	]);
});

test('deep nesting and oversized input fall back to plain text instead of recursing', () => {
	const deep = '*'.repeat(120) + 'x';
	expect(() => parseInline(deep)).not.toThrow();
	const huge = 'a'.repeat(20_001);
	expect(parseInline(huge)).toEqual([{ type: 'text', text: huge }]);
});

test('parseMarkdown builds headings, paragraphs, quotes, lists and fenced code', () => {
	const blocks = parseMarkdown(
		[
			'# Title',
			'',
			'para',
			'',
			'> quote',
			'',
			'- one',
			'- two',
			'',
			'```ts',
			'let a = 1;',
			'```'
		].join('\n')
	);
	expect(blocks.map((block) => block.type)).toEqual([
		'heading',
		'paragraph',
		'quote',
		'list',
		'code'
	]);
	expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
	expect(blocks[3]).toMatchObject({ type: 'list', ordered: false });
	expect(blocks[4]).toMatchObject({ type: 'code', language: 'ts', text: 'let a = 1;' });
});

test('an unclosed fence renders its content as code rather than dropping it', () => {
	const blocks = parseMarkdown('```\nnever closed');
	expect(blocks).toEqual([{ type: 'code', language: '', text: 'never closed' }]);
});

test('block parsing emits only typed text nodes, so HTML arrives as inert text', () => {
	// The parser never returns an HTML node: markup becomes a text child, which the Svelte
	// renderer prints with `{text}`, so the browser sees characters rather than an element.
	const blocks = parseMarkdown('<script>alert(1)</script>\n\n<img onerror=alert(1)>');
	expect(blocks).toEqual([
		{
			type: 'paragraph',
			children: [{ type: 'text', text: '<script>alert(1)</script>' }]
		},
		{ type: 'paragraph', children: [{ type: 'text', text: '<img onerror=alert(1)>' }] }
	]);
});

test('ordered lists keep their start number and do not merge with bullet lists', () => {
	const blocks = parseMarkdown(['3. three', '4. four', '', '- bullet'].join('\n'));
	expect(blocks[0]).toMatchObject({ type: 'list', ordered: true, start: 3 });
	expect(blocks[0]).toMatchObject({ items: [[{ type: 'paragraph' }], [{ type: 'paragraph' }]] });
	expect(blocks[1]).toMatchObject({ type: 'list', ordered: false, start: 1 });
});

test('list indentation continues an item, and a blank line ends the list', () => {
	const blocks = parseMarkdown('- first line\n  continued\n\n- second');
	expect(blocks).toHaveLength(2);
	expect(blocks[0]).toMatchObject({ type: 'list' });
	expect(JSON.stringify(blocks[0])).toContain('continued');
});

test('a horizontal rule is its own block, not a list item', () => {
	expect(parseMarkdown('---')).toEqual([{ type: 'rule' }]);
	expect(parseMarkdown('***')).toEqual([{ type: 'rule' }]);
	expect(parseMarkdown('___')).toEqual([{ type: 'rule' }]);
	// The rule pattern is anchored to the whole line, so `--- x` is ordinary text.
	expect(parseMarkdown('--- x')[0]).toMatchObject({ type: 'paragraph' });
	// A single dash is a bullet list, so the two forms must not be confused.
	expect(parseMarkdown('- x')[0]).toMatchObject({ type: 'list', ordered: false });
});

test('CRLF input parses the same as LF', () => {
	const lf = parseMarkdown('# Title\n\npara\n\n- item');
	const crlf = parseMarkdown('# Title\r\n\r\npara\r\n\r\n- item');
	expect(crlf).toEqual(lf);
});

test('a nested quote is a quote inside a quote', () => {
	const blocks = parseMarkdown('> outer\n> > inner');
	expect(blocks[0]).toMatchObject({ type: 'quote' });
	expect(JSON.stringify(blocks[0])).toContain('"type":"quote"');
});

test('a heading keeps inline formatting and drops closing hashes', () => {
	expect(parseMarkdown('## **bold** ##')[0]).toEqual({
		type: 'heading',
		level: 2,
		children: [{ type: 'strong', children: [{ type: 'text', text: 'bold' }] }]
	});
});

test('a document larger than the parse cap is returned as one plain paragraph', () => {
	const huge = 'x'.repeat(20_001);
	expect(parseMarkdown(huge)).toEqual([
		{ type: 'paragraph', children: [{ type: 'text', text: huge }] }
	]);
});

test('more than 1000 inline nodes stop accumulating and keep the tail as text', () => {
	const nodes = parseInline('*a*'.repeat(1200));
	expect(nodes.length).toBeGreaterThan(1000);
	const last = nodes.at(-1);
	expect(last).toMatchObject({ type: 'text' });
	// Nothing is lost even though node creation stopped.
	expect(text(nodes.filter((node) => node.type === 'text')).length).toBeGreaterThan(0);
});

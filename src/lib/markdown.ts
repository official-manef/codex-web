// Markdown is parsed into text nodes, never HTML. Unknown syntax stays readable.
export type Inline =
  | { type: "text" | "code"; text: string }
  | { type: "strong" | "emphasis"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type MarkdownBlock =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: number; children: Inline[] }
  | { type: "code"; text: string; language: string }
  | { type: "quote"; children: MarkdownBlock[] }
  | { type: "list"; ordered: boolean; start: number; items: MarkdownBlock[][] }
  | { type: "rule" };

const MAX_PARSE_CHARS = 100_000;
const MAX_DEPTH = 8;

export function safeLink(value: string): string | null {
  if (!value || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  if (!/^(https?:\/\/|mailto:)/i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "mailto:") return url.pathname ? value : null;
    // `https://example.com@evil.example/x` reads as example.com and connects to evil.example:
    // everything before `@` is userinfo, not the host. Refuse it rather than render a link
    // whose visible text and destination disagree.
    if (url.username || url.password) return null;
    return url.hostname ? value : null;
  } catch {
    return null;
  }
}

export function parseInline(text: string, depth = 0, links = true): Inline[] {
  if (depth >= MAX_DEPTH || text.length > MAX_PARSE_CHARS) return [{ type: "text", text }];
  const result: Inline[] = [];
  const unclosed = new Set<string>();
  let pending = "";
  const flush = () => {
    if (pending) result.push({ type: "text", text: pending });
    pending = "";
  };
  let cursor = 0;
  while (cursor < text.length) {
    if (result.length > 1000) {
      pending += text.slice(cursor);
      break;
    }
    const char = text[cursor];
    if (char === "\\" && /[\\`*_[\]{}()#+.!>~-]/.test(text[cursor + 1] ?? "")) {
      pending += text[cursor + 1];
      cursor += 2;
      continue;
    }
    if (char === "`") {
      let count = 1;
      while (text[cursor + count] === "`") count++;
      const marker = "`".repeat(count);
      const end = unclosed.has(marker) ? -1 : text.indexOf(marker, cursor + count);
      if (end >= 0) {
        flush();
        result.push({ type: "code", text: text.slice(cursor + count, end).replace(/\n/g, " ") });
        cursor = end + count;
        continue;
      }
      unclosed.add(marker);
      pending += marker;
      cursor += count;
      continue;
    }
    if (links && char === "[" && text[cursor - 1] !== "!" && !unclosed.has("link")) {
      const labelEnd = text.indexOf("](", cursor + 1);
      if (labelEnd < 0) unclosed.add("link");
      else {
        let end = labelEnd + 2;
        let balance = 1;
        while (end < text.length && balance > 0 && text[end] !== "\n") {
          if (text[end] === "(") balance++;
          else if (text[end] === ")") balance--;
          if (balance > 0) end++;
        }
        if (balance === 0) {
          const href = safeLink(text.slice(labelEnd + 2, end));
          if (href) {
            flush();
            result.push({
              type: "link",
              href,
              children: parseInline(text.slice(cursor + 1, labelEnd), depth + 1, false),
            });
          } else pending += text.slice(cursor, end + 1);
          cursor = end + 1;
          continue;
        }
        unclosed.add("link");
      }
    }
    if (char === "*" || char === "_") {
      const marker = text[cursor + 1] === char ? char.repeat(2) : char;
      const intraword = char === "_" && /[\p{L}\p{N}]/u.test(text[cursor - 1] ?? "");
      let end =
        intraword || unclosed.has(marker) ? -1 : text.indexOf(marker, cursor + marker.length);
      if (marker.length === 2 && end >= 0 && text[end + 2] === char) end++;
      if (end < 0 && !intraword) unclosed.add(marker);
      else if (
        end > cursor + marker.length &&
        !/\s/.test(text[cursor + marker.length]) &&
        !/\s/.test(text[end - 1])
      ) {
        flush();
        result.push({
          type: marker.length === 2 ? "strong" : "emphasis",
          children: parseInline(text.slice(cursor + marker.length, end), depth + 1, links),
        });
        cursor = end + marker.length;
        continue;
      }
      pending += marker;
      cursor += marker.length;
      continue;
    }
    pending += char;
    cursor++;
  }
  flush();
  return result;
}

const listItem = (line: string) => /^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+(.*)$/.exec(line);
const startsBlock = (line: string) =>
  /^ {0,3}(?:#{1,6}[ \t]|>|`{3,}|~{3,}|(?:[-+*]|\d{1,9}[.)])[ \t])/.test(line);

function blocks(lines: string[], depth: number): MarkdownBlock[] {
  if (depth >= MAX_DEPTH)
    return [{ type: "paragraph", children: [{ type: "text", text: lines.join("\n") }] }];
  const result: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})([^\s`]*)[ \t]*$/.exec(line);
    if (fence) {
      const content: string[] = [];
      const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}$`);
      index++;
      while (index < lines.length && !close.test(lines[index].trimEnd()))
        content.push(lines[index++]);
      if (index < lines.length) index++;
      result.push({
        type: "code",
        text: content.join("\n"),
        language: /^[\w+-]{1,24}$/.test(fence[2]) ? fence[2] : "",
      });
      continue;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+)$/.exec(line);
    if (heading) {
      result.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2].replace(/[ \t]+#+[ \t]*$/, "")),
      });
      index++;
      continue;
    }
    if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)) {
      result.push({ type: "rule" });
      index++;
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const content: string[] = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index]))
        content.push(lines[index++].replace(/^ {0,3}>[ \t]?/, ""));
      result.push({ type: "quote", children: blocks(content, depth + 1) });
      continue;
    }
    const first = listItem(line);
    if (first) {
      const ordered = /^\d/.test(first[1]);
      const items: MarkdownBlock[][] = [];
      while (index < lines.length) {
        const item = listItem(lines[index]);
        if (!item || /^\d/.test(item[1]) !== ordered) break;
        const content = [item[2]];
        index++;
        while (index < lines.length && /^(?: {2,}|\t)/.test(lines[index]))
          content.push(lines[index++].replace(/^(?: {2,4}|\t)/, ""));
        items.push(blocks(content, depth + 1));
      }
      result.push({ type: "list", ordered, start: ordered ? parseInt(first[1], 10) : 1, items });
      continue;
    }
    const content = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index]))
      content.push(lines[index++]);
    result.push({ type: "paragraph", children: parseInline(content.join("\n")) });
  }
  return result;
}

export function parseMarkdown(text: string): MarkdownBlock[] {
  if (text.length > MAX_PARSE_CHARS)
    return [{ type: "paragraph", children: [{ type: "text", text }] }];
  return blocks(text.replace(/\r\n?/g, "\n").split("\n"), 0);
}

/** Inline markdown parsing for `MarkdownLite` (lib/markdownLite.tsx): pure, no rendering. */

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

const INLINE_RE = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/;

/** Parse inline markdown into a flat node list (exported for tests). */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let rest = text;
  for (;;) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      if (rest) nodes.push({ kind: "text", text: rest });
      return nodes;
    }
    if (m.index > 0) nodes.push({ kind: "text", text: rest.slice(0, m.index) });
    if (m[2] !== undefined) nodes.push({ kind: "bold", text: m[2] });
    else if (m[4] !== undefined) nodes.push({ kind: "italic", text: m[4] });
    else if (m[6] !== undefined) nodes.push({ kind: "code", text: m[6] });
    else if (m[8] !== undefined) {
      const href = m[9];
      if (/^https?:\/\//i.test(href)) {
        nodes.push({ kind: "link", text: m[8], href });
      } else {
        // Refuse javascript:/data:/relative schemes: render as plain text.
        nodes.push({ kind: "text", text: m[0] });
      }
    }
    rest = rest.slice(m.index + m[0].length);
  }
}

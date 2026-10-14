/**
 * Event descriptions that arrive as HTML. Pure, so it can be tested:
 * `npm test -- rich-text`.
 *
 * Google Calendar stores a description written in its editor as HTML, so an
 * imported event's description is `<h1>…</h1><ul><li>…</li></ul>`. The event
 * card stripped the tags and the edit field showed them raw. Now the card
 * draws the formatting and the edit field gets clean text.
 *
 * The HTML is someone else's, so nothing from it reaches the page as markup.
 * It is read into a small tree of known elements (headings, paragraphs, bold,
 * italic, underline, lists, line breaks and web or mail links), and
 * RichText renders that tree as React elements. Every other tag is dropped and
 * keeps only its text; scripts and styles lose their contents too.
 */

export type RichTag = "p" | "h" | "strong" | "em" | "u" | "ul" | "ol" | "li" | "br" | "a";

export type RichNode =
  | { type: "text"; text: string }
  | { type: "element"; tag: RichTag; level?: number; href?: string; children: RichNode[] };

type ElementNode = Extract<RichNode, { type: "element" }>;

const KNOWN = /<\/?(p|br|div|b|strong|i|em|u|ul|ol|li|h[1-6]|a|span|font)\b[^>]*>/i;

/** Whether a description is HTML rather than plain text with newlines. */
export function looksLikeHtml(text: string | null | undefined): boolean {
  return Boolean(text && KNOWN.test(text));
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'",
  ndash: String.fromCharCode(0x2013), mdash: String.fromCharCode(0x2014), hellip: String.fromCharCode(0x2026), rsquo: String.fromCharCode(0x2019), lsquo: String.fromCharCode(0x2018),
  rdquo: String.fromCharCode(0x201d), ldquo: String.fromCharCode(0x201c), bull: String.fromCharCode(0x2022),
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+[0-9]*);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = parseInt(lower.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (lower.startsWith("#")) {
      const code = parseInt(lower.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[lower] ?? whole;
  });
}

/** A link is kept only for the web and for mail; anything else is its text. */
function safeHref(attributes: string): string | undefined {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
  const raw = match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim() : "";
  return /^(https?:|mailto:)/i.test(raw) ? raw : undefined;
}

function mapTag(name: string): { tag: RichTag; level?: number } | null {
  switch (name) {
    case "p":
    case "div":
      return { tag: "p" };
    case "b":
    case "strong":
      return { tag: "strong" };
    case "i":
    case "em":
      return { tag: "em" };
    case "u":
      return { tag: "u" };
    case "ul":
    case "ol":
    case "li":
    case "a":
      return { tag: name };
    default:
      if (/^h[1-6]$/.test(name)) return { tag: "h", level: Number(name[1]) };
      return null;
  }
}

const SKIP_CONTENT = new Set(["script", "style", "head", "title"]);

/** Reads HTML into the tree RichText draws. Never throws on malformed input. */
export function parseRichText(html: string): RichNode[] {
  const root: ElementNode = { type: "element", tag: "p", children: [] };
  const stack: { node: ElementNode; name: string }[] = [{ node: root, name: "#root" }];
  const top = () => stack[stack.length - 1].node;

  const pushText = (raw: string) => {
    // HTML collapses runs of whitespace, newlines included.
    const text = decodeEntities(raw.replace(/\s+/g, " "));
    if (!text) return;
    const children = top().children;
    const last = children[children.length - 1];
    if (last && last.type === "text") last.text += text;
    else children.push({ type: "text", text });
  };

  const pattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let cursor = 0;
  let skipping: string | null = null;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    const [whole, closing, rawName = "", attributes = ""] = match;
    const name = rawName.toLowerCase();
    if (!skipping) pushText(html.slice(cursor, match.index));
    cursor = match.index + whole.length;
    if (!rawName) continue; // a comment

    if (skipping) {
      if (closing && name === skipping) skipping = null;
      continue;
    }
    if (SKIP_CONTENT.has(name)) {
      if (!closing && !/\/\s*$/.test(attributes)) skipping = name;
      continue;
    }
    if (name === "br") {
      top().children.push({ type: "element", tag: "br", children: [] });
      continue;
    }

    const mapped = mapTag(name);
    if (!mapped) continue; // unknown: dropped, its text kept

    if (closing) {
      const at = stack.map((entry) => entry.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }

    const node: ElementNode = { type: "element", tag: mapped.tag, children: [] };
    if (mapped.level) node.level = mapped.level;
    if (mapped.tag === "a") {
      const href = safeHref(attributes);
      if (!href) {
        // Not a link we trust: keep the text, drop the element.
        continue;
      }
      node.href = href;
    }
    top().children.push(node);
    stack.push({ node, name });
  }
  if (!skipping) pushText(html.slice(cursor));

  return trimTree(root.children);
}

/** Drops whitespace-only text at the edges of blocks, and empty paragraphs. */
function trimTree(nodes: RichNode[]): RichNode[] {
  const out: RichNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      out.push(node);
      continue;
    }
    const children = trimTree(node.children);
    const empty = children.every((child) => child.type === "text" && !child.text.trim());
    if (node.tag !== "br" && empty && (node.tag === "p" || node.tag === "h" || node.tag === "li" || node.tag === "ul" || node.tag === "ol")) continue;
    out.push({ ...node, children });
  }
  return out;
}

const BLOCK: ReadonlySet<RichTag> = new Set(["p", "h", "ul", "ol", "li"]);

/**
 * The description as clean text for the edit field: a line per paragraph,
 * heading and list item, `• ` before a bullet and `1. ` before a numbered one,
 * and at most one blank line anywhere.
 */
export function htmlToPlainText(html: string): string {
  const lines: string[] = [""];
  const newline = () => {
    if (lines[lines.length - 1] !== "") lines.push("");
  };

  const walk = (nodes: RichNode[], list: { ordered: boolean; count: number } | null) => {
    for (const node of nodes) {
      if (node.type === "text") {
        lines[lines.length - 1] += node.text;
        continue;
      }
      if (node.tag === "br") {
        lines.push("");
        continue;
      }
      if (node.tag === "ul" || node.tag === "ol") {
        newline();
        walk(node.children, { ordered: node.tag === "ol", count: 0 });
        newline();
        lines.push("");
        continue;
      }
      if (node.tag === "li") {
        newline();
        const marker = list?.ordered ? `${(list.count += 1)}. ` : "• ";
        lines[lines.length - 1] += marker;
        walk(node.children, null);
        newline();
        continue;
      }
      if (BLOCK.has(node.tag)) {
        newline();
        walk(node.children, list);
        newline();
        if (node.tag === "h" || node.tag === "p") lines.push("");
        continue;
      }
      walk(node.children, list);
    }
  };

  walk(parseRichText(html), null);

  return lines
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** What the edit field starts with: HTML made clean, plain text as it is. */
export function descriptionForEditing(description: string | null | undefined): string {
  if (!description) return "";
  return looksLikeHtml(description) ? htmlToPlainText(description) : description;
}

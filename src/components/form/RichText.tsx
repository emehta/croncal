import type { ReactNode } from "react";
import { parseRichText, looksLikeHtml, type RichNode } from "@/lib/rich-text";
import styles from "./RichText.module.css";

/** Long text on a view card: formatted if it came as HTML, as written if not. */
export default function RichText({ text, empty }: { text: string | null | undefined; empty?: string }) {
  if (!text || !text.trim()) {
    return empty ? <p className={styles.plain} style={{ color: "var(--c-text-4)" }}>{empty}</p> : null;
  }
  if (!looksLikeHtml(text)) return <p className={styles.plain}>{text}</p>;
  return <div className={styles.rich}>{renderNodes(parseRichText(text))}</div>;
}

function renderNodes(nodes: RichNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.text;
    const children = renderNodes(node.children);
    switch (node.tag) {
      case "br":
        return <br key={index} />;
      case "p":
        return <p key={index}>{children}</p>;
      case "h": {
        const level = Math.min(6, Math.max(1, node.level ?? 3));
        const Heading = `h${level}` as "h1";
        return <Heading key={index}>{children}</Heading>;
      }
      case "strong":
        return <strong key={index}>{children}</strong>;
      case "em":
        return <em key={index}>{children}</em>;
      case "u":
        return <u key={index}>{children}</u>;
      case "ul":
        return <ul key={index}>{children}</ul>;
      case "ol":
        return <ol key={index}>{children}</ol>;
      case "li":
        return <li key={index}>{children}</li>;
      case "a":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      default:
        return <span key={index}>{children}</span>;
    }
  });
}

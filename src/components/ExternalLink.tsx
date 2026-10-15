import type { CSSProperties, ReactNode } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";

/**
 * A link to another site, opened in a new tab, with the icon that says so.
 * The one look for every such link: the setup steps, Settings and the cards.
 * The text size is the surroundings', so it sits in a sentence or a note.
 */
export default function ExternalLink({ href, children, style }: { href: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--c-accent)", fontWeight: 600, whiteSpace: "nowrap", ...style }}
    >
      {children}
      <ArrowSquareOut size="0.95em" weight="bold" aria-hidden="true" style={{ flexShrink: 0 }} />
    </a>
  );
}

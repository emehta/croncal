"use client";

import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { CHOICE_CHIP, CHOICE_CHIP_SELECTED, CHOICE_CHIP_UNSELECTED } from "@/lib/styles";
import { parseRichText, looksLikeHtml, type RichNode } from "@/lib/rich-text";
import styles from "./form.module.css";
import { contentColor } from "@/lib/content-palette";

/** The small uppercase name above a field or a group of choices. */
export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  const style: React.CSSProperties = {
    display: "block",
    fontSize: "var(--ui-type-micro)",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "var(--tracking-label)",
    color: "var(--c-text-4)",
    marginBottom: 6,
  };
  return htmlFor
    ? <label htmlFor={htmlFor} style={style}>{children}</label>
    : <p style={style}>{children}</p>;
}

/**
 * A labelled field, or a labelled row of fields. The gap between groups is
 * the card's rhythm: 16px, everywhere.
 */
export function FieldGroup({
  label,
  htmlFor,
  children,
  style,
}: {
  label?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ minWidth: 0, ...style }}>
      {label && <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>}
      {children}
    </div>
  );
}

/** Two fields side by side on a desktop, one above the other on a phone. */
export function FieldRow({ phone, children }: { phone: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: phone ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
        gap: phone ? 16 : 12,
      }}
    >
      {children}
    </div>
  );
}

/** The vertical stack every edit card lays its groups out in. */
export function FieldStack({ children, grow = false }: { children: ReactNode; grow?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: grow ? "1 1 auto" : undefined, minHeight: 0 }}>
      {children}
    </div>
  );
}

export function TextField({
  icon,
  invalid,
  large = false,
  inputRef,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  icon?: ReactNode;
  invalid?: boolean;
  /** The card's title field, a size up. */
  large?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className={`${styles.field}${large ? ` ${styles.fieldTitle}` : ""}`} data-invalid={invalid ? "true" : undefined}>
      {icon}
      <input type="text" {...input} ref={inputRef} aria-invalid={invalid || undefined} />
    </div>
  );
}

export function TextAreaField({
  icon,
  invalid,
  grow = false,
  textareaRef,
  ...textarea
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  icon?: ReactNode;
  invalid?: boolean;
  /** Takes whatever height the card has left: the description. */
  grow?: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <div
      className={`${styles.field}${grow ? ` ${styles.fieldGrow}` : ""}`}
      data-invalid={invalid ? "true" : undefined}
      style={grow ? undefined : { alignItems: "flex-start" }}
    >
      {icon && <span style={{ display: "flex", marginTop: 3, color: "var(--c-text-3)", flexShrink: 0 }}>{icon}</span>}
      <textarea {...textarea} ref={textareaRef} aria-invalid={invalid || undefined} />
    </div>
  );
}

/** An on/off setting, its label on the left and the switch on the right. */
export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 32 }}>
      <span style={{ fontSize: "var(--ui-type-body-sm)", color: "var(--c-text-2)" }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={styles.switch}
      >
        <span className={styles.switchKnob} />
      </button>
    </div>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** Carried as a dot, so a row of them still reads as one group. */
  color?: string;
}

/**
 * One of a few options, as chips: the shared chip (lib/styles CHOICE_CHIP),
 * so every card draws "selected" the same way.
 */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  allowNone = false,
  multiple,
  phone = false,
}: {
  options: readonly ChoiceOption<T>[];
  value: T | null;
  onChange: (next: T | null) => void;
  ariaLabel: string;
  /** Pressing the chosen chip again clears it. */
  allowNone?: boolean;
  /** For a group where several can be on: which are. `value` is then ignored. */
  multiple?: readonly T[];
  phone?: boolean;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((option) => {
        const active = multiple ? multiple.includes(option.value) : value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className="ui-choice"
            aria-pressed={active}
            onClick={() => onChange(multiple ? option.value : active && allowNone ? null : option.value)}
            style={{
              ...CHOICE_CHIP,
              ...(active ? CHOICE_CHIP_SELECTED : CHOICE_CHIP_UNSELECTED),
              minHeight: phone ? 36 : 30,
            }}
          >
            {option.color && (
              <span
                aria-hidden="true"
                style={{ width: 7, height: 7, borderRadius: "var(--ui-radius-round)", background: contentColor(option.color), flexShrink: 0 }}
              />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface SwatchOption {
  value: string;
  label: string;
}

export function ColorSwatches({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly SwatchOption[];
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const known = options.some((option) => option.value.toLowerCase() === value.toLowerCase());
  /* A colour set somewhere else (an older custom one) still shows as chosen. */
  const shown = known ? options : [...options, { value, label: "Current colour" }];
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "4px 2px" }}>
      {shown.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.swatch}
          title={option.label}
          aria-label={option.label}
          aria-pressed={option.value.toLowerCase() === value.toLowerCase()}
          onClick={() => onChange(option.value)}
          style={{ background: contentColor(option.value) }}
        />
      ))}
    </div>
  );
}

/**
 * A fact on a view card: an icon and a line of text.
 */
export function DetailRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
      <span style={{ display: "flex", color: "var(--c-text-3)", flexShrink: 0, marginTop: 2 }}>{icon}</span>
      <div style={{ fontSize: "var(--ui-type-body-sm)", color: "var(--c-text-2)", lineHeight: 1.5, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

/** The title on a view card, with an optional colour mark before it. */
export function ViewTitle({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {color && (
        <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: "var(--ui-radius-round)", background: contentColor(color), flexShrink: 0 }} />
      )}
      {/* tabIndex -1 and data-autofocus: the card opens with focus here, not
          on its own close button, and draws no ring for it. */}
      <h2
        tabIndex={-1}
        data-autofocus
        style={{ fontSize: "var(--ui-type-title-sm)", fontWeight: 600, color: "var(--c-text-1)", lineHeight: 1.3, outline: "none", minWidth: 0, overflowWrap: "anywhere" }}
      >
        {children}
      </h2>
    </div>
  );
}

/** Long text on a view card: formatted if it came as HTML, as written if not. */
export function RichText({ text, empty }: { text: string | null | undefined; empty?: string }) {
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

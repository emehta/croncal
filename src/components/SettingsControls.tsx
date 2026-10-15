"use client";

import type { ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { SELECTED } from "@/lib/styles";

/** The pieces every section of Settings is built from, so each row looks and behaves the same. */

const TOGGLE_SEGMENT_WIDTH = 56;

export function SectionHeader({ label }: { label: string }) {
  return (
    <p
      style={{
        fontSize: "var(--ui-type-label)",
        fontWeight: 650,
        color: "var(--c-text-4)",
        textTransform: "uppercase",
        letterSpacing: "var(--tracking-label)",
        marginBottom: 6,
        marginTop: 4,
      }}
    >
      {label}
    </p>
  );
}

export function SettingsRow({ icon: RowIcon, label, children }: { icon: Icon; label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <RowIcon size={18} weight="duotone" style={{ color: "var(--c-text-3)", flexShrink: 0 }} />
        <span style={{ fontSize: "var(--ui-type-body)", color: "var(--c-text-2)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Two or three fixed-width segments, so the rows' right edges line up and a
 * tap never resizes them. `value` may match none of them (nothing chosen yet).
 */
export function TogglePill({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ display: "inline-flex", flexShrink: 0, borderRadius: "var(--ui-radius-md)", border: "1px solid var(--c-border)", overflow: "hidden" }}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            type="button"
            key={option.value}
            onClick={() => {
              if (!active) onChange(option.value);
            }}
            aria-pressed={active}
            disabled={disabled}
            style={{
              minWidth: TOGGLE_SEGMENT_WIDTH,
              minHeight: 32,
              padding: "6px 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--ui-type-body-sm)",
              fontWeight: active ? SELECTED.fontWeight : 400,
              fontVariantNumeric: "tabular-nums",
              color: active ? SELECTED.color : "var(--c-text-3)",
              background: active ? SELECTED.background : "transparent",
              // The one selected look, its border drawn inside: the group already has the outer edge.
              boxShadow: active ? "inset 0 0 0 1px var(--c-selected-border)" : "none",
              border: "none",
              cursor: disabled ? "default" : "pointer",
              opacity: disabled && !active ? 0.6 : 1,
              transition: "var(--transition-ui)",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export const Divider = () => <div style={{ height: 1, background: "var(--c-border-sub)", margin: "8px 0" }} />;

/** Small text under a row: what the row needs, in a line. */
export const settingsNote = { color: "var(--c-text-3)", fontSize: "var(--ui-type-label)", lineHeight: 1.5 } as const;

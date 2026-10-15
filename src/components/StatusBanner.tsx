"use client";

import { X } from "@phosphor-icons/react";
import Tooltip from "@/components/Tooltip";

type Tone = "error" | "success" | "info";

const TONE_STYLES: Record<Tone, { accent: string; background: string; border: string }> = {
  error: {
    accent: "var(--c-danger)",
    background: "var(--c-danger-wash)",
    border: "var(--c-danger-line)",
  },
  success: {
    accent: "var(--c-success)",
    background: "color-mix(in srgb, var(--c-surface) 88%, var(--c-success) 12%)",
    border: "color-mix(in srgb, var(--c-border) 72%, var(--c-success) 28%)",
  },
  info: {
    accent: "var(--c-info)",
    background: "color-mix(in srgb, var(--c-surface) 88%, var(--c-info) 12%)",
    border: "color-mix(in srgb, var(--c-border) 72%, var(--c-info) 28%)",
  },
};

interface Props {
  message: string;
  tone?: Tone;
  onDismiss?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function StatusBanner({
  message,
  tone = "error",
  onDismiss,
  className,
  style,
}: Props) {
  const toneStyle = TONE_STYLES[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={className}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 14px",
        borderRadius: "var(--ui-radius-lg)",
        background: toneStyle.background,
        border: `1px solid ${toneStyle.border}`,
        color: toneStyle.accent,
        fontSize: "var(--ui-type-label)",
        lineHeight: 1.5,
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{message}</div>
      {onDismiss && (
        <Tooltip label="Dismiss">
          <button
            type="button"
            onClick={onDismiss}
            className="ui-hover-fill"
            style={{
              /* Drawn 28px, pulled into the banner's padding so a one-line banner
                 stays one line tall; the span inside makes the press area 32. */
              position: "relative",
              width: 28,
              height: 28,
              margin: "-4px -8px -4px 0",
              background: "none",
              border: "none",
              borderRadius: "var(--ui-radius-sm)",
              color: toneStyle.accent,
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            aria-label="Dismiss"
          >
            <span aria-hidden="true" style={{ position: "absolute", inset: -2 }} />
            <X size={14} weight="bold" aria-hidden="true" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

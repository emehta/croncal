"use client";

import styles from "./ToggleRow.module.css";

/** An on/off setting, its label on the left and the switch on the right. */
export default function ToggleRow({
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

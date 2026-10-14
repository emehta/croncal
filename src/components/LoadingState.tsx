import styles from "./LoadingState.module.css";

interface LoadingStateProps {
  label?: string;
  minHeight?: number | string;
}

export default function LoadingState({
  label = "Loading…",
  minHeight = 240,
}: LoadingStateProps) {
  return (
    <div
      className={styles.state}
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{ minHeight }}
    >
      <span className={styles.spinner} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </div>
  );
}

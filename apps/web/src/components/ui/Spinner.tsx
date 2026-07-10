import styles from "./Spinner.module.css";

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span
      className={styles.spinner}
      style={{ width: size, height: size }}
      role="status"
      aria-label="Loading"
    />
  );
}

export function PageSpinner() {
  return (
    <div className={styles.page}>
      <Spinner size={28} />
    </div>
  );
}

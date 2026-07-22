import type { BibEntry } from "@freeleaf/shared";

import styles from "./UnusedBibDialog.module.css";

export function UnusedBibDialog({
  entries,
  onCancel,
  onConfirm,
}: {
  entries: BibEntry[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.card} role="dialog" aria-modal="true" aria-label="Remove unused references">
        <h3 className={styles.title}>Remove unused references</h3>
        <p className={styles.desc}>
          This will remove the following {entries.length} reference{entries.length === 1 ? "" : "s"} — none of
          them are cited anywhere in this project's .tex files. This can't be undone.
        </p>
        <ul className={styles.list}>
          {entries.map((e) => (
            <li key={e.key} className={styles.item}>
              <span className={styles.entryKey}>{e.key}</span>
              {e.fields.title && <span className={styles.entryTitle}>{e.fields.title}</span>}
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.confirmButton} onClick={onConfirm}>
            OK, remove them
          </button>
        </div>
      </div>
    </div>
  );
}

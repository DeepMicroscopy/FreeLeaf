import { useEffect } from "react";

import { Button } from "../ui/Button";
import { PenguinMascot } from "./PenguinMascot";
import styles from "./FixItDialogs.module.css";

export function EscapeAmpersandDialog({
  line,
  onConfirm,
  onCancel,
}: {
  line: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Escape unescaped ampersand">
        <div className={styles.header}>
          <PenguinMascot pose="plan" />
          <div>
            <h3 className={styles.title}>Escape this &amp;?</h3>
            <p className={styles.hint}>Line {line} has a bare & outside a table or math environment.</p>
          </div>
        </div>

        <div className={styles.body}>
          <p className={styles.description}>
            A plain & isn't valid LaTeX outside a tabular/align-like environment — it's reserved for
            column separators. Use \&amp; to show a literal ampersand.
          </p>
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm}>
            Escape it
          </Button>
        </div>
      </div>
    </div>
  );
}

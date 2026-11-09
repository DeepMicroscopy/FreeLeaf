import { useEffect } from "react";

import { Button } from "../ui/Button";
import { PenguinMascot } from "./PenguinMascot";
import styles from "./FixItDialogs.module.css";

export function SetPreviousCopyDialog({
  mainFilePath,
  targetFilePath,
  saving,
  onConfirm,
  onCancel,
}: {
  mainFilePath: string;
  targetFilePath: string;
  saving: boolean;
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
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Set as previous copy">
        <div className={styles.header}>
          <PenguinMascot pose="puzzle" />
          <div>
            <h3 className={styles.title}>Link as a previous copy?</h3>
            <p className={styles.hint}>
              Link <strong>{targetFilePath}</strong> as the previous copy of <strong>{mainFilePath}</strong>
            </p>
          </div>
        </div>

        <div className={styles.body}>
          <p className={styles.description}>
            This links the two documents as revisions of each other: while editing {mainFilePath}, the editor will
            show a permanent diff against {targetFilePath}'s content — insertions underlined in green, removed text
            struck through in red. Useful when revising a paper against reviewer feedback and wanting to see what's
            changed since the version you submitted.
          </p>
          <p className={styles.description}>
            The diff compares against {targetFilePath}'s current content, fetched once when you open{" "}
            {mainFilePath} — use the Refresh button next to the indicator badge if {targetFilePath} changes later
            in your session.
          </p>
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm} loading={saving}>
            Link
          </Button>
        </div>
      </div>
    </div>
  );
}

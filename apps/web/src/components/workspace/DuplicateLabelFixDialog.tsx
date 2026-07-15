import { useEffect, useState } from "react";

import { Button } from "../ui/Button";
import type { LabelOccurrence } from "./refCompletion";
import { PenguinMascot } from "./PenguinMascot";
import styles from "./FixItDialogs.module.css";

export function DuplicateLabelFixDialog({
  label,
  occurrences,
  onRename,
  onDelete,
  onCancel,
}: {
  label: string;
  occurrences: LabelOccurrence[];
  onRename: (occurrenceIndex: number, newKey: string) => void;
  onDelete: (occurrenceIndex: number) => void;
  onCancel: () => void;
}) {
  const [renameValues, setRenameValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(occurrences.map((_, i) => [i, i === 0 ? label : `${label}-${i + 1}`])),
  );

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
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={`Label defined multiple times: ${label}`}>
        <div className={styles.header}>
          <PenguinMascot pose="pencil" />
          <div>
            <h3 className={styles.title}>Label defined multiple times: {label}</h3>
            <p className={styles.hint}>Rename one to make it unique, or delete it.</p>
          </div>
        </div>

        <div className={styles.body}>
          {occurrences.map((occ, i) => (
            <div key={`${occ.from}-${occ.to}`} className={styles.occurrence}>
              <span className={styles.occurrenceMeta}>
                Line {occ.line}
                {occ.description ? ` — ${occ.description}` : ""}
              </span>
              <div className={styles.occurrenceActions}>
                <input
                  className={styles.renameInput}
                  value={renameValues[i] ?? ""}
                  onChange={(e) => setRenameValues((prev) => ({ ...prev, [i]: e.target.value }))}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onRename(i, renameValues[i] ?? "")}
                  disabled={!renameValues[i]?.trim()}
                >
                  Rename
                </Button>
                <Button variant="danger" size="sm" onClick={() => onDelete(i)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

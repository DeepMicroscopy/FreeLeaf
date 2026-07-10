import type { BibEntry } from "@freeleaf/shared";
import { useEffect, useState } from "react";

import styles from "./DuplicateDialog.module.css";

export type DuplicateChoice = "existing" | "add" | "skip";

export function DuplicateDialog({
  existing,
  incoming,
  onResolve,
}: {
  existing: BibEntry;
  incoming: { key: string; fields: Record<string, string> };
  onResolve: (choice: DuplicateChoice) => void;
}) {
  const [selected, setSelected] = useState<0 | 1>(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => (s === 0 ? 1 : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        onResolve(selected === 0 ? "existing" : "add");
      } else if (e.key === "Escape") {
        e.preventDefault();
        onResolve("skip");
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [selected, onResolve]);

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.card} role="dialog" aria-modal="true" aria-label="Possible duplicate reference">
        <h3 className={styles.title}>Possible duplicate reference</h3>
        <p className={styles.desc}>A reference with a matching title and author is already in your library.</p>

        <div className={styles.compare}>
          <div className={styles.box}>
            <div className={styles.boxLabel}>Already in library</div>
            <div className={styles.entryKey}>{existing.key}</div>
            <div className={styles.entryTitle}>{existing.fields.title}</div>
            <div className={styles.entryAuthor}>{existing.fields.author}</div>
          </div>
          <div className={styles.box}>
            <div className={styles.boxLabel}>You're adding</div>
            <div className={styles.entryKey}>{incoming.key}</div>
            <div className={styles.entryTitle}>{incoming.fields.title}</div>
            <div className={styles.entryAuthor}>{incoming.fields.author}</div>
          </div>
        </div>

        <div className={styles.options}>
          <button
            type="button"
            className={[styles.option, selected === 0 ? styles.optionSelected : ""].join(" ")}
            onClick={() => onResolve("existing")}
            onMouseEnter={() => setSelected(0)}
          >
            Use existing reference (<span className={styles.mono}>{existing.key}</span>)
          </button>
          <button
            type="button"
            className={[styles.option, selected === 1 ? styles.optionSelected : ""].join(" ")}
            onClick={() => onResolve("add")}
            onMouseEnter={() => setSelected(1)}
          >
            Add as a new, separate reference (<span className={styles.mono}>{incoming.key}</span>)
          </button>
        </div>
        <p className={styles.hint}>↑↓ to choose, Enter to confirm, Esc to skip this one</p>
      </div>
    </div>
  );
}

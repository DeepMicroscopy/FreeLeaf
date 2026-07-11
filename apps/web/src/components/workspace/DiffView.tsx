import { diffLines } from "diff";
import { useMemo } from "react";

import styles from "./DiffView.module.css";

type Row = { text: string; kind: "same" | "added" | "removed" | "blank" };

function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function buildSideBySide(oldText: string, newText: string): { left: Row[]; right: Row[] } {
  const parts = diffLines(oldText, newText);
  const left: Row[] = [];
  const right: Row[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      for (const text of splitLines(part.value)) {
        left.push({ text, kind: "same" });
        right.push({ text, kind: "same" });
      }
      i += 1;
      continue;
    }
    if (part.removed) {
      const removedLines = splitLines(part.value);
      let addedLines: string[] = [];
      if (parts[i + 1]?.added) {
        addedLines = splitLines(parts[i + 1].value);
        i += 2;
      } else {
        i += 1;
      }
      const max = Math.max(removedLines.length, addedLines.length);
      for (let j = 0; j < max; j++) {
        left.push(j < removedLines.length ? { text: removedLines[j], kind: "removed" } : { text: "", kind: "blank" });
        right.push(j < addedLines.length ? { text: addedLines[j], kind: "added" } : { text: "", kind: "blank" });
      }
      continue;
    }
    // Pure insertion with no preceding removed block.
    for (const text of splitLines(part.value)) {
      left.push({ text: "", kind: "blank" });
      right.push({ text, kind: "added" });
    }
    i += 1;
  }
  return { left, right };
}

export function DiffView({ oldText, newText, oldLabel, newLabel }: {
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
}) {
  const { left, right } = useMemo(() => buildSideBySide(oldText, newText), [oldText, newText]);

  if (oldText === newText) {
    return <div className={styles.unchanged}>No differences from the current file content.</div>;
  }

  return (
    <div className={styles.diff}>
      <div className={styles.column}>
        <div className={styles.columnLabel}>{oldLabel}</div>
        <div className={styles.lines}>
          {left.map((row, i) => (
            <div key={i} className={[styles.line, styles[row.kind]].join(" ")}>
              <span className={styles.lineText}>{row.text || " "}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.column}>
        <div className={styles.columnLabel}>{newLabel}</div>
        <div className={styles.lines}>
          {right.map((row, i) => (
            <div key={i} className={[styles.line, styles[row.kind]].join(" ")}>
              <span className={styles.lineText}>{row.text || " "}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { FileQuestion, Image as ImageIcon, ListTree } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "../ui/EmptyState";
import { useWorkspace } from "../../lib/workspace";
import { parseFiguresAndTables, parseOutline } from "./documentOutline";
import styles from "./DocumentNavPanels.module.css";

function useJumpToLine() {
  const { jumpToLineRef } = useWorkspace();
  return (line: number) => jumpToLineRef.current?.(line);
}

export function OutlinePanel() {
  const { currentFileText } = useWorkspace();
  const jumpToLine = useJumpToLine();
  const entries = useMemo(() => parseOutline(currentFileText), [currentFileText]);

  if (!currentFileText) {
    return (
      <EmptyState
        icon={<FileQuestion size={28} aria-hidden="true" />}
        title="No file open"
        description="Open a .tex file in the editor to see its outline."
      />
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<ListTree size={28} aria-hidden="true" />}
        title="No headings yet"
        description="\section, \subsection, etc. will show up here as you add them."
      />
    );
  }

  return (
    <ul className={styles.list}>
      {entries.map((e, i) => (
        <li key={i}>
          <button
            className={styles.entry}
            style={{ paddingLeft: 12 + e.level * 14 }}
            onClick={() => jumpToLine(e.line)}
            title={`Line ${e.line}`}
          >
            {e.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FiguresTablesPanel() {
  const { currentFileText } = useWorkspace();
  const jumpToLine = useJumpToLine();
  const entries = useMemo(() => parseFiguresAndTables(currentFileText), [currentFileText]);

  if (!currentFileText) {
    return (
      <EmptyState
        icon={<FileQuestion size={28} aria-hidden="true" />}
        title="No file open"
        description="Open a .tex file in the editor to see its figures and tables."
      />
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<ImageIcon size={28} aria-hidden="true" />}
        title="No figures or tables yet"
        description="\begin{figure} and \begin{table} environments will show up here."
      />
    );
  }

  return (
    <ul className={styles.list}>
      {entries.map((e, i) => (
        <li key={i}>
          <button className={styles.entry} onClick={() => jumpToLine(e.line)} title={`Line ${e.line}`}>
            <span className={styles.entryKind}>{e.kind === "figure" ? `Figure ${e.number}` : `Table ${e.number}`}</span>
            <span className={styles.entryText}>{e.caption ?? (e.snippet || "(empty)")}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

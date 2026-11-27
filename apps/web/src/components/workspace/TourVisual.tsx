import { MessageSquare, RefreshCw } from "lucide-react";

import styles from "./TourVisual.module.css";

export type TourVisualKind = "editor" | "pdf" | "collab" | "review" | "diff";

type LineMarker = "insert" | "delete" | "comment" | "cursorA" | "cursorB";

// Arbitrary varying widths so the bars read as "lines of text" rather than a
// uniform grid.
const EDITOR_LINE_WIDTHS = [86, 62, 94, 70, 52, 90, 66, 80];
const PDF_LINE_WIDTHS = [70, 92, 88, 40, 96, 84, 90, 58];

const MARKERS_BY_KIND: Partial<Record<TourVisualKind, Record<number, LineMarker>>> = {
  collab: { 2: "cursorA", 5: "cursorB" },
  review: { 2: "comment", 4: "insert", 5: "delete" },
  diff: { 2: "insert", 6: "delete" },
};

function EditorPane({ markers }: { markers?: Record<number, LineMarker> }) {
  return (
    <div className={styles.lines}>
      {EDITOR_LINE_WIDTHS.map((width, i) => {
        const marker = markers?.[i];
        return (
          <div key={i} className={styles.lineRow}>
            <div
              className={[styles.line, marker === "insert" ? styles.lineInsert : "", marker === "delete" ? styles.lineDelete : ""]
                .filter(Boolean)
                .join(" ")}
              style={{ width: `${width}%` }}
            />
            {marker === "comment" && (
              <span className={styles.commentBadge} aria-hidden="true">
                <MessageSquare size={9} />
              </span>
            )}
            {marker === "cursorA" && <span className={[styles.cursor, styles.cursorA].join(" ")} aria-hidden="true" />}
            {marker === "cursorB" && <span className={[styles.cursor, styles.cursorB].join(" ")} aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}

function PdfPane() {
  return (
    <div className={styles.pdfPane} aria-hidden="true">
      <div className={styles.pdfFigure} />
      {PDF_LINE_WIDTHS.map((width, i) => (
        <div key={i} className={styles.pdfLine} style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

// A small schematic mock of the workspace (editor + PDF preview), not a real
// screenshot — stays accurate as the UI evolves, with only the overlaid
// markers changing per tour step.
export function TourVisual({ kind }: { kind: TourVisualKind }) {
  const showPdfPane = kind === "editor" || kind === "pdf";

  return (
    <div className={styles.frame} aria-hidden="true">
      <div className={styles.chrome}>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </div>
      <div className={[styles.body, !showPdfPane ? styles.bodySingle : ""].join(" ")}>
        <div className={styles.editorPane}>
          <EditorPane markers={MARKERS_BY_KIND[kind]} />
        </div>
        {showPdfPane && <PdfPane />}
        {kind === "pdf" && (
          <span className={styles.syncBadge}>
            <RefreshCw size={11} />
          </span>
        )}
      </div>
    </div>
  );
}

import { gutter, GutterMarker } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { lineHasTabularBegin } from "./tableDesigner";
import styles from "./CodeMirrorEditor.module.css";

class TableIconMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = styles.tableDesignerIcon;
    span.title = "Open in Table Designer";
    span.textContent = "⊞";
    return span;
  }
}

const marker = new TableIconMarker();

/** A gutter icon on any line starting a `tabular`-family environment —
 * clicking it calls `onOpen` with that line's 1-indexed number. Only
 * detects the line itself (cheap per-line regex, recomputed by CodeMirror's
 * own gutter lifecycle); the actual parse into a grid model happens lazily
 * at click time in CodeMirrorEditor, via tableDesigner.ts. */
export function tableDesignerGutter(onOpen: (lineNumber: number) => void): Extension {
  return gutter({
    class: styles.tableDesignerGutter,
    lineMarker(view, line) {
      const lineObj = view.state.doc.lineAt(line.from);
      return lineHasTabularBegin(lineObj.text) ? marker : null;
    },
    lineMarkerChange: (update) => update.docChanged,
    domEventHandlers: {
      mousedown(view, line) {
        const lineObj = view.state.doc.lineAt(line.from);
        if (!lineHasTabularBegin(lineObj.text)) return false;
        onOpen(lineObj.number);
        return true;
      },
    },
  });
}

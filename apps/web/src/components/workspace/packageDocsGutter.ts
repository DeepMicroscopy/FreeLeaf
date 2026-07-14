import { gutter, GutterMarker } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { PACKAGE_LINE_RE } from "./packageCompletion";
import { PACKAGE_DOCS } from "./packageDocs";
import styles from "./CodeMirrorEditor.module.css";

const BOOK_ICON_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`;

class PackageDocIconMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = styles.packageDocsIcon;
    span.title = "View package documentation";
    span.innerHTML = BOOK_ICON_SVG;
    return span;
  }
}

const marker = new PackageDocIconMarker();

/** Given a line's text, finds the package name a click should open docs for.
 * A `\usepackage{a,b,c}` line lists possibly several packages — prefer one we
 * have a real doc page for over the literal first, so a line like
 * `\usepackage{unknownfirst,amsmath}` opens amsmath's doc instead of always
 * falling through to CTAN for whatever happened to be listed first. */
export function firstPackageOnLine(text: string): string | null {
  const match = PACKAGE_LINE_RE.exec(text);
  if (!match) return null;
  const names = match[1]
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  return names.find((n) => n in PACKAGE_DOCS) ?? names[0];
}

/** A gutter icon on any line containing a `\usepackage`/`\RequirePackage` —
 * clicking it calls `onOpen` with the resolved package name. Mirrors
 * tableDesignerGutter.ts's structure: cheap per-line regex check, real
 * lookup/rendering deferred to click time (PackageDocDialog). */
export function packageDocsGutter(onOpen: (packageName: string) => void): Extension {
  return gutter({
    class: styles.packageDocsGutter,
    lineMarker(view, line) {
      const lineObj = view.state.doc.lineAt(line.from);
      return firstPackageOnLine(lineObj.text) ? marker : null;
    },
    lineMarkerChange: (update) => update.docChanged,
    domEventHandlers: {
      mousedown(view, line) {
        const lineObj = view.state.doc.lineAt(line.from);
        const pkg = firstPackageOnLine(lineObj.text);
        if (!pkg) return false;
        onOpen(pkg);
        return true;
      },
    },
  });
}

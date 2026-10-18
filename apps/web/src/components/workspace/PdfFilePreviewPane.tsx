import { apiOrigin } from "@freeleaf/shared";

import { useWorkspace } from "../../lib/workspace";
import type { ProjectFileOut } from "../../lib/workspace";
import { formatFileSize } from "./fileSize";
import styles from "./ImagePreviewPane.module.css";
import { PdfViewer } from "./PdfViewer";

/** Preview for a standalone PDF asset (e.g. a vector figure exported from
 * matplotlib/R/Inkscape and \includegraphics'd directly) selected in the
 * file tree — the PDF counterpart to ImagePreviewPane. Reuses the same
 * PdfViewer as the compile-output preview, but with a per-file
 * pageStorageKey so its remembered scroll page doesn't collide with the
 * compile output's or with another PDF asset's. */
export function PdfFilePreviewPane({ file }: { file: ProjectFileOut }) {
  const { projectId } = useWorkspace();
  const src = `${apiOrigin()}/api/projects/${projectId}/files/${file.id}/content`;

  return (
    <div className={styles.pane}>
      <div className={styles.paneHeader}>{file.path}</div>
      <div className={styles.metaLine}>{formatFileSize(file.size)}</div>
      <div className={styles.pdfBody}>
        <PdfViewer src={src} projectId={projectId} pageStorageKey={`file:${file.id}`} />
      </div>
    </div>
  );
}

import { apiOrigin } from "@freeleaf/shared";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

import { useWorkspace } from "../../lib/workspace";
import type { ProjectFileOut } from "../../lib/workspace";
import { Button } from "../ui/Button";
import { FILE_SIZE_CRITICAL_BYTES, formatFileSize } from "./fileSize";
import { parsePngMetadata } from "./pngMetadata";
import type { PngMetadata } from "./pngMetadata";
import { ResizeImageDialog } from "./ResizeImageDialog";
import { detectMeasurementSystem, formatLength } from "./units";
import styles from "./ImagePreviewPane.module.css";

export function ImagePreviewPane({ file }: { file: ProjectFileOut }) {
  const { projectId, refreshFiles } = useWorkspace();
  const [reloadNonce, setReloadNonce] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [meta, setMeta] = useState<PngMetadata | null>(null);
  const [resizeOpen, setResizeOpen] = useState(false);

  const src = `${apiOrigin()}/api/projects/${projectId}/files/${file.id}/content${reloadNonce ? `?v=${reloadNonce}` : ""}`;

  useEffect(() => {
    let cancelled = false;
    setBlob(null);
    setMeta(null);
    fetch(src, { credentials: "include" })
      .then((res) => res.blob())
      .then(async (b) => {
        if (cancelled) return;
        setBlob(b);
        setMeta(parsePngMetadata(await b.arrayBuffer()));
      })
      .catch(() => {
        /* preview still renders via the plain <img> tag below either way */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, reloadNonce]);

  const isVeryLarge = file.size > FILE_SIZE_CRITICAL_BYTES;

  return (
    <div className={styles.pane}>
      <div className={styles.paneHeader}>{file.path}</div>
      <div className={styles.metaLine}>
        {formatFileSize(file.size)}
        {meta && (
          <>
            {" · "}
            {formatLength(meta.widthPx, meta.dpi, detectMeasurementSystem())} × {formatLength(meta.heightPx, meta.dpi, detectMeasurementSystem())}
            {" · "}
            {meta.dpi} dpi
            {meta.dpiSource === "assumed" && <span className={styles.muted}> (assumed)</span>}
          </>
        )}
      </div>
      {isVeryLarge && (
        <div className={styles.warningBanner}>
          <AlertTriangle size={15} aria-hidden="true" />
          <span>File is very large — this can slow down compiles.</span>
          {meta && blob && (
            <Button size="sm" variant="secondary" onClick={() => setResizeOpen(true)}>
              Reduce file size…
            </Button>
          )}
        </div>
      )}
      <div className={styles.imageBody}>
        <img src={src} alt={file.path} className={styles.image} />
      </div>
      {resizeOpen && meta && blob && (
        <ResizeImageDialog
          projectId={projectId}
          fileId={file.id}
          fileName={file.path}
          sourceBlob={blob}
          sizeBytes={file.size}
          widthPx={meta.widthPx}
          heightPx={meta.heightPx}
          currentDpi={meta.dpi}
          dpiSource={meta.dpiSource}
          onClose={() => setResizeOpen(false)}
          onReplaced={() => {
            setReloadNonce((n) => n + 1);
            refreshFiles();
          }}
        />
      )}
    </div>
  );
}

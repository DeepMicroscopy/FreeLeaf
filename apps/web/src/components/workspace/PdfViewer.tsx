import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

import { Spinner } from "../ui/Spinner";
import styles from "./PdfViewer.module.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export function PdfViewer({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        doc = await pdfjsLib.getDocument({ url: src, withCredentials: true }).promise;
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          const page = await doc.getPage(pageNum);
          if (cancelled) return;

          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = (container.clientWidth - 24) / unscaledViewport.width;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.className = styles.page;
          const context = canvas.getContext("2d");
          if (!context) continue;
          const outputScale = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          container.appendChild(canvas);

          await page.render({
            canvas,
            canvasContext: context,
            viewport,
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          }).promise;
        }
      } catch {
        if (!cancelled) setError("Couldn't render this PDF.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [src]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.scroller} ref={containerRef} />
      {loading && (
        <div className={styles.overlay}>
          <Spinner />
        </div>
      )}
      {error && <div className={styles.overlay}>{error}</div>}
    </div>
  );
}

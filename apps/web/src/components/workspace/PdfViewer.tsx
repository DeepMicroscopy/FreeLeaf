import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import styles from "./PdfViewer.module.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const ZOOM_STEP = 1.2;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4;

export interface SyncTexBox {
  page: number;
  h: number;
  v: number;
  width: number;
  height: number;
}

export interface PdfViewerHandle {
  scrollToPosition: (box: SyncTexBox) => void;
}

export const PdfViewer = forwardRef<
  PdfViewerHandle,
  { src: string; onSourceClick?: (page: number, x: number, y: number) => void }
>(function PdfViewer({ src, onSourceClick }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pagesRef = useRef<PDFPageProxy[]>([]);
  const pageWrapsRef = useRef<HTMLDivElement[]>([]);
  const baseScaleRef = useRef(1);
  const currentScaleRef = useRef(1);
  const renderTokenRef = useRef(0);
  const onSourceClickRef = useRef(onSourceClick);
  onSourceClickRef.current = onSourceClick;

  const renderAllPages = useCallback(async (scale: number) => {
    const container = containerRef.current;
    const doc = docRef.current;
    if (!container || !doc) return;
    const token = ++renderTokenRef.current;

    container.innerHTML = "";
    pageWrapsRef.current = [];
    currentScaleRef.current = scale;

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = pagesRef.current[pageNum - 1];
      if (renderTokenRef.current !== token) return;

      const viewport = page.getViewport({ scale });

      const pageWrap = document.createElement("div");
      pageWrap.className = styles.pageWrap;
      pageWrap.style.width = `${viewport.width}px`;
      pageWrap.style.height = `${viewport.height}px`;

      const canvas = document.createElement("canvas");
      canvas.className = styles.page;
      const context = canvas.getContext("2d");
      if (!context) continue;
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.addEventListener("click", (event) => {
        const handler = onSourceClickRef.current;
        if (!handler) return;
        const rect = canvas.getBoundingClientRect();
        const cssX = event.clientX - rect.left;
        const cssY = event.clientY - rect.top;
        const s = currentScaleRef.current;
        // SyncTeX coordinates are already top-left-origin/y-down (same
        // convention as viewport pixels), unlike native PDF user space
        // (bottom-left/y-up) — so this is a plain unscale, no axis flip.
        handler(pageNum, cssX / s, cssY / s);
      });

      pageWrap.appendChild(canvas);
      container.appendChild(pageWrap);
      pageWrapsRef.current[pageNum - 1] = pageWrap;

      await page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      }).promise;
      if (renderTokenRef.current !== token) return;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadingTask = pdfjsLib.getDocument({ url: src, withCredentials: true });
    setLoading(true);
    setError(null);
    setZoom(1);

    (async () => {
      try {
        const doc = await loadingTask.promise;
        if (cancelled) return;
        docRef.current = doc;

        const pages: PDFPageProxy[] = [];
        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
          pages.push(await doc.getPage(pageNum));
        }
        if (cancelled) return;
        pagesRef.current = pages;

        const container = containerRef.current;
        if (!container || pages.length === 0) return;
        const unscaledViewport = pages[0].getViewport({ scale: 1 });
        baseScaleRef.current = (container.clientWidth - 24) / unscaledViewport.width;

        await renderAllPages(baseScaleRef.current);
      } catch {
        if (!cancelled) setError("Couldn't render this PDF.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      docRef.current = null;
      pagesRef.current = [];
      loadingTask.destroy();
    };
  }, [src, renderAllPages]);

  const zoomChangeCount = useRef(0);
  useEffect(() => {
    zoomChangeCount.current += 1;
    if (zoomChangeCount.current === 1) return; // skip the initial mount; the load effect already rendered at zoom=1
    if (!docRef.current) return;
    void renderAllPages(baseScaleRef.current * zoom);
  }, [zoom, renderAllPages]);

  useImperativeHandle(ref, () => ({
    scrollToPosition: ({ page, h, v, width, height }) => {
      const container = containerRef.current;
      const pageWrap = pageWrapsRef.current[page - 1];
      if (!container || !pageWrap) return;

      // Same top-left-origin/y-down convention as the click handler above:
      // v is the box's baseline, so its top edge is v - height.
      const s = currentScaleRef.current;
      const top = (v - height) * s;
      const left = h * s;
      const boxWidth = width * s;
      const boxHeight = height * s;

      container.scrollTo({
        top: pageWrap.offsetTop + top - container.clientHeight / 3,
        left: 0,
        behavior: "smooth",
      });

      const highlight = document.createElement("div");
      highlight.className = styles.highlight;
      highlight.style.left = `${left - 3}px`;
      highlight.style.top = `${top - 2}px`;
      highlight.style.width = `${Math.max(boxWidth, 4) + 6}px`;
      highlight.style.height = `${Math.max(boxHeight, 4) + 4}px`;
      pageWrap.appendChild(highlight);
      setTimeout(() => highlight.remove(), 1500);
    },
  }));

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / ZOOM_STEP))}
          disabled={loading}
          title="Zoom out"
        >
          <ZoomOut size={14} aria-hidden="true" />
        </Button>
        <span className={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * ZOOM_STEP))}
          disabled={loading}
          title="Zoom in"
        >
          <ZoomIn size={14} aria-hidden="true" />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setZoom(1)} disabled={loading} title="Reset zoom to fit width">
          <Maximize size={14} aria-hidden="true" />
        </Button>
      </div>
      <div className={styles.scroller} ref={containerRef} />
      {loading && (
        <div className={styles.overlay}>
          <Spinner />
        </div>
      )}
      {error && <div className={styles.overlay}>{error}</div>}
    </div>
  );
});

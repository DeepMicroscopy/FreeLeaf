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
  // Drives the pointer-cursor affordance while Ctrl/Cmd is held (see
  // PdfViewer.module.css's .modifierHeld) — otherwise there's no visual hint
  // that holding the modifier and clicking jumps to the source. Reset on
  // window blur too, so alt-tabbing away mid-hold doesn't leave the cursor
  // stuck looking clickable after the key is physically released elsewhere.
  const [modifierHeld, setModifierHeld] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") setModifierHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") setModifierHeld(false);
    };
    const onBlur = () => setModifierHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

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
      // `mousedown`, not `click` — gating this behind Ctrl/Cmd (see below)
      // means holding the modifier matters, and on a `click` listener the
      // browser/OS can reinterpret a held-Ctrl press as a secondary-click
      // gesture (the same convention as "Ctrl+click = right-click" on
      // macOS), which fires `contextmenu` instead and never dispatches a
      // `click` event at all. `mousedown` fires on press regardless of that
      // reinterpretation — the same reason CodeMirror's own forward-search
      // handler (CodeMirrorEditor.tsx) uses `mousedown` rather than `click`.
      canvas.addEventListener("mousedown", (event) => {
        const handler = onSourceClickRef.current;
        if (!handler) return;
        // Gated behind Ctrl/Cmd, symmetric with forward search's own
        // Ctrl/Cmd+click in the editor — otherwise every plain click on the
        // PDF silently jumped the editor, with no indication beforehand
        // that clicking would do anything at all.
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
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

  // Ctrl/Cmd+scroll zoom — matches the OS/browser-native "hold modifier to
  // zoom" convention (and what trackpad pinch-zoom gestures already send:
  // browsers synthesize those as wheel events with ctrlKey set), so a plain
  // scroll still just scrolls the page. A plain `onWheel` JSX prop can't
  // preventDefault (React attaches it as a passive listener), which is
  // required here to stop the browser's own page-zoom from also firing —
  // so this is wired up manually with `{ passive: false }` instead.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)));
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

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
      <div
        className={[styles.scroller, modifierHeld ? styles.modifierHeld : ""].join(" ")}
        ref={containerRef}
        title="Cmd/Ctrl+click a spot in the PDF to jump to that line in the source"
      />
      {loading && (
        <div className={styles.overlay}>
          <Spinner />
        </div>
      )}
      {error && <div className={styles.overlay}>{error}</div>}
    </div>
  );
});

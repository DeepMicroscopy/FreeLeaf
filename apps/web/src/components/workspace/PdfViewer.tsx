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

// Remembers which page the viewer was last scrolled to, per project, so a
// recompile (which replaces the whole PDF, including after an unrelated
// edit elsewhere in the document) or a plain browser reload reopens where
// the user left off instead of snapping back to page 1 every time.
//
// sessionStorage, not localStorage: the project id alone isn't a unique key
// if the same project is open in more than one tab/window, and localStorage
// is shared across all of them — each tab's own scroll position would
// silently clobber the others' in that one shared slot, so reloading could
// land wherever some *other* tab's viewer happened to leave it last (often
// page 1, if a stray tab was sitting at the top). sessionStorage is scoped
// per tab — still survives a reload of that same tab (the actual ask),
// just without the cross-tab interference.
function pdfPageStorageKey(projectId: string): string {
  return `freeleaf.pdfPage.${projectId}`;
}

function readStoredPage(projectId: string): number {
  try {
    const n = parseInt(sessionStorage.getItem(pdfPageStorageKey(projectId)) ?? "1", 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

function writeStoredPage(projectId: string, page: number): void {
  try {
    sessionStorage.setItem(pdfPageStorageKey(projectId), String(page));
  } catch {
    // Private browsing / quota — losing the "remember my page" convenience
    // isn't worth surfacing an error for.
  }
}

/** The page currently at (or just above) the top of the scroll container —
 * the last page wrap whose top edge has been scrolled past. */
function currentPageFromScroll(container: HTMLDivElement, pageWraps: HTMLDivElement[]): number {
  const scrollTop = container.scrollTop;
  let page = 1;
  for (let i = 0; i < pageWraps.length; i++) {
    if (pageWraps[i].offsetTop <= scrollTop + 1) page = i + 1;
    else break;
  }
  return page;
}

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
  {
    src: string;
    projectId: string;
    onSourceClick?: (page: number, x: number, y: number) => void;
    /** Reviewing mode's "comment on the PDF" (CompilePane.tsx) — while on,
     * a plain click anywhere on a page places a comment there instead of
     * (or taking priority over) the Ctrl/Cmd+click source-jump below. */
    commentMode?: boolean;
    onCommentClick?: (page: number, x: number, y: number) => void;
  }
>(function PdfViewer({ src, projectId, onSourceClick, commentMode = false, onCommentClick }, ref) {
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
  // Suppresses the scroll-tracking write (below) while a render is clearing
  // and rebuilding the container — see its own doc comment for why.
  const restoringScrollRef = useRef(false);
  const onSourceClickRef = useRef(onSourceClick);
  onSourceClickRef.current = onSourceClick;
  const commentModeRef = useRef(commentMode);
  commentModeRef.current = commentMode;
  const onCommentClickRef = useRef(onCommentClick);
  onCommentClickRef.current = onCommentClick;

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
        // Comment mode takes priority and needs no modifier held — it's a
        // dedicated mode (toggled in CompilePane's toolbar), not a gesture
        // layered on top of ordinary clicking, so every plain click while
        // it's on is intentional.
        if (commentModeRef.current) {
          const handler = onCommentClickRef.current;
          if (!handler) return;
          event.preventDefault();
          const rect = canvas.getBoundingClientRect();
          const s = currentScaleRef.current;
          handler(pageNum, (event.clientX - rect.left) / s, (event.clientY - rect.top) / s);
          return;
        }
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

        restoringScrollRef.current = true;
        try {
          await renderAllPages(baseScaleRef.current);
          if (cancelled) return;

          // Restore whatever page the viewer was last scrolled to (across a
          // recompile or a plain browser reload) instead of leaving it at the
          // top — clamped down if this version of the document is shorter.
          const restoredPage = Math.min(readStoredPage(projectId), doc.numPages);
          if (restoredPage > 1) {
            const pageWrap = pageWrapsRef.current[restoredPage - 1];
            if (pageWrap) container.scrollTop = pageWrap.offsetTop;
          }
        } finally {
          restoringScrollRef.current = false;
        }
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
  }, [src, projectId, renderAllPages]);

  const zoomChangeCount = useRef(0);
  useEffect(() => {
    zoomChangeCount.current += 1;
    if (zoomChangeCount.current === 1) return; // skip the initial mount; the load effect already rendered at zoom=1
    if (!docRef.current) return;
    const container = containerRef.current;
    // Capture scroll position as a *fraction* of total scrollable height,
    // not "which page" — zooming never changes the page count or content,
    // just the uniform render scale, so the same fraction lands back at the
    // same point in the document once the new (taller/shorter) content is
    // in place. Restoring by page (like the reload/recompile path below,
    // where the page count genuinely can change) would still work but loses
    // position *within* the page the user was actually looking at.
    const maxScrollBefore = container ? container.scrollHeight - container.clientHeight : 0;
    const scrollFraction = container && maxScrollBefore > 0 ? container.scrollTop / maxScrollBefore : 0;
    restoringScrollRef.current = true;
    void renderAllPages(baseScaleRef.current * zoom)
      .then(() => {
        if (!container) return;
        const maxScrollAfter = container.scrollHeight - container.clientHeight;
        if (maxScrollAfter > 0) container.scrollTop = scrollFraction * maxScrollAfter;
      })
      .finally(() => {
        restoringScrollRef.current = false;
      });
  }, [zoom, renderAllPages]);

  // Tracks which page the viewer is scrolled to so the next load (a
  // recompile or a browser reload) can restore it — see readStoredPage
  // above. Debounced so a continuous scroll doesn't hammer localStorage.
  //
  // renderAllPages clears the container (`container.innerHTML = ""`) before
  // rebuilding it at the new source/zoom, which drops scrollTop to 0 and
  // fires a real scroll event — indistinguishable from the user actually
  // scrolling to the top. For a document with enough pages that rendering
  // takes longer than this debounce, that stray event's write lands *during*
  // rendering, clobbering the correct remembered page in sessionStorage
  // before the load effect's own restore step ever gets to read it (a real,
  // reproduced bug: recompiling a long PDF would often snap back to page 1,
  // "often" rather than "always" depending on render time vs. this delay).
  // Checked inside the timeout (not when the event fires) since the write it
  // guards happens later — restoringScrollRef flips back to false as soon as
  // the real restore position is set, so that *good* scroll's own write
  // still lands normally.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (restoringScrollRef.current) return;
        writeStoredPage(projectId, currentPageFromScroll(container, pageWrapsRef.current));
      }, 200);
    };
    container.addEventListener("scroll", onScroll);
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [projectId]);

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
        className={[styles.scroller, modifierHeld ? styles.modifierHeld : "", commentMode ? styles.commentMode : ""].join(" ")}
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

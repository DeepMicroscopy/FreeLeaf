import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import styles from "./SplitPane.module.css";

function readStoredRatio(storageKey: string, fallback: number): number {
  const raw = localStorage.getItem(storageKey);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0.1 && parsed < 0.9 ? parsed : fallback;
}

export function SplitPane({
  left,
  right,
  storageKey,
  defaultRatio = 0.5,
  minPanePx = 260,
}: {
  /** `null` collapses to a single full-width pane (`right` only, no
   * divider) — rendered this way rather than the caller swapping between
   * `<SplitPane left={x} right={y} />` and plain `{y}` at the call site, so
   * a component living in `right` keeps the exact same position in the
   * React tree either way. A caller that conditionally wraps/unwraps its
   * own `right` content in a SplitPane changes the element type at that
   * tree position the instant the condition flips, which React treats as
   * "this subtree is gone" — it unmounts and remounts everything in
   * `right` from scratch, discarding all of its state (a real, confirmed
   * bug: CompilePane's PDF zoom/view-mode/comment-mode all reset the
   * instant EditorTab's Comments pane was toggled open, because that was
   * exactly this swap). */
  left: ReactNode | null;
  right: ReactNode;
  storageKey: string;
  defaultRatio?: number;
  minPanePx?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => readStoredRatio(storageKey, defaultRatio));
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    localStorage.setItem(storageKey, String(ratio));
  }, [ratio, storageKey]);

  const clampRatio = useCallback(
    (raw: number, containerWidth: number) => {
      const minRatio = Math.min(minPanePx / containerWidth, 0.45);
      return Math.min(1 - minRatio, Math.max(minRatio, raw));
    },
    [minPanePx],
  );

  useEffect(() => {
    if (!dragging) return;

    function handleMove(e: PointerEvent) {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const raw = (e.clientX - rect.left) / rect.width;
      setRatio(clampRatio(raw, rect.width));
    }
    function handleUp() {
      setDragging(false);
    }

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, clampRatio]);

  function handleKeyDown(e: ReactKeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "ArrowLeft") setRatio((r) => Math.max(0.1, r - step));
    if (e.key === "ArrowRight") setRatio((r) => Math.min(0.9, r + step));
  }

  // The right pane's wrapper div is always the same fixed child index of
  // .container (whatever left-side content precedes it collapses to a
  // single slot, present or not) — see the `left` prop's own doc comment
  // for why that positional stability is the entire point, not a style
  // preference.
  return (
    <div ref={containerRef} className={styles.container}>
      {left !== null && (
        <>
          <div className={styles.pane} style={{ width: `calc(${ratio * 100}% - 1px)` }}>
            {left}
          </div>
          <div
            className={styles.divider}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize editor and preview panes"
            tabIndex={0}
            onPointerDown={() => setDragging(true)}
            onKeyDown={handleKeyDown}
          >
            <div className={styles.dividerHandle} />
          </div>
        </>
      )}
      <div className={styles.pane} style={{ width: left !== null ? `calc(${(1 - ratio) * 100}% - 1px)` : "100%" }}>
        {right}
      </div>
    </div>
  );
}

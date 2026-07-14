import { api } from "@freeleaf/shared";
import { useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { formatFileSize } from "./fileSize";
import { resizePng } from "./pngResize";
import { detectMeasurementSystem, displayToInches, formatLength, inchesToDisplay } from "./units";
import type { MeasurementSystem } from "./units";
import styles from "./ResizeImageDialog.module.css";

const PREVIEW_DEBOUNCE_MS = 250;
const MIN_TARGET_INCHES = 0.1;

export function ResizeImageDialog({
  projectId,
  fileId,
  fileName,
  sourceBlob,
  sizeBytes,
  widthPx,
  heightPx,
  currentDpi,
  dpiSource,
  onClose,
  onReplaced,
}: {
  projectId: string;
  fileId: string;
  fileName: string;
  sourceBlob: Blob;
  sizeBytes: number;
  widthPx: number;
  heightPx: number;
  currentDpi: number;
  dpiSource: "pHYs" | "assumed";
  onClose: () => void;
  onReplaced: () => void;
}) {
  const [system, setSystem] = useState<MeasurementSystem>(() => detectMeasurementSystem());
  const [targetDpi, setTargetDpi] = useState(Math.min(currentDpi, 300));
  const aspectRatio = heightPx / widthPx;
  const originalWidthInches = widthPx / currentDpi;
  const originalHeightInches = heightPx / currentDpi;
  // Physical (print) size, aspect-locked — kept as a single width-in-inches
  // source of truth; height is always derived from it via the original
  // aspect ratio. Defaults to "unchanged" (only DPI defaults to a
  // reduction) — sizing down is opt-in.
  const [targetWidthInches, setTargetWidthInches] = useState(originalWidthInches);
  const targetHeightInches = targetWidthInches * aspectRatio;
  const targetWidthPx = Math.round(targetWidthInches * targetDpi);
  const targetHeightPx = Math.round(targetHeightInches * targetDpi);

  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (targetWidthPx <= 0 || targetHeightPx <= 0) return;
    let cancelled = false;
    setPreviewPending(true);
    const timer = setTimeout(() => {
      resizePng(sourceBlob, targetWidthPx, targetHeightPx)
        .then(({ blob }) => {
          if (!cancelled) setPreviewBlob(blob);
        })
        .finally(() => {
          if (!cancelled) setPreviewPending(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sourceBlob, targetWidthPx, targetHeightPx]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  function handleWidthInput(displayValue: number) {
    const inches = Math.min(originalWidthInches, Math.max(MIN_TARGET_INCHES, displayToInches(displayValue, system)));
    setTargetWidthInches(inches);
  }

  function handleHeightInput(displayValue: number) {
    const heightInches = Math.min(
      originalHeightInches,
      Math.max(MIN_TARGET_INCHES, displayToInches(displayValue, system)),
    );
    setTargetWidthInches(heightInches / aspectRatio);
  }

  async function handleApply() {
    setSaving(true);
    setError(null);
    try {
      // Re-run at the exact current target size rather than trusting a
      // possibly-still-debouncing previewBlob — cheap, and removes any
      // chance of applying a stale preview.
      const { blob: finalBlob } = await resizePng(sourceBlob, targetWidthPx, targetHeightPx);
      const { error: apiError } = await api.PUT("/api/projects/{project_id}/files/{file_id}/binary-content", {
        params: { path: { project_id: projectId, file_id: fileId } },
        // Cast as any here to satisfy the strict OpenAPI schema type checker
        body: { file: finalBlob as any },
        bodySerializer: (body) => {
          const form = new FormData();
          form.append("file", body.file);
          return form;
        },
      });
      if (apiError) throw new Error((apiError as { detail?: string })?.detail ?? "Could not save the resized image.");
      onReplaced();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the resized image.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.card} role="dialog" aria-modal="true" aria-label="Reduce image file size">
        <h3 className={styles.title}>Reduce file size</h3>
        <p className={styles.desc}>Resamples "{fileName}" to a lower resolution and/or physical size.</p>

        <div className={styles.unitToggle}>
          <button
            type="button"
            className={[styles.unitOption, system === "metric" ? styles.unitOptionActive : ""].join(" ")}
            onClick={() => setSystem("metric")}
          >
            cm
          </button>
          <button
            type="button"
            className={[styles.unitOption, system === "imperial" ? styles.unitOptionActive : ""].join(" ")}
            onClick={() => setSystem("imperial")}
          >
            in
          </button>
        </div>

        <div className={styles.grid}>
          <div className={styles.label}>Current size</div>
          <div className={styles.value}>
            {formatLength(widthPx, currentDpi, system)} × {formatLength(heightPx, currentDpi, system)}
            <span className={styles.muted}> ({widthPx} × {heightPx} px)</span>
          </div>

          <div className={styles.label}>Current DPI</div>
          <div className={styles.value}>
            {currentDpi}
            {dpiSource === "assumed" && <span className={styles.muted}> (assumed — not stored in file)</span>}
          </div>

          <div className={styles.label}>Target size</div>
          <div className={styles.value}>
            <input
              type="number"
              min={MIN_TARGET_INCHES}
              max={inchesToDisplay(originalWidthInches, system)}
              step={0.1}
              value={inchesToDisplay(targetWidthInches, system).toFixed(1)}
              onChange={(e) => handleWidthInput(Number(e.target.value))}
              className={styles.sizeInput}
            />
            <span className={styles.times}>×</span>
            <input
              type="number"
              min={MIN_TARGET_INCHES}
              max={inchesToDisplay(originalHeightInches, system)}
              step={0.1}
              value={inchesToDisplay(targetHeightInches, system).toFixed(1)}
              onChange={(e) => handleHeightInput(Number(e.target.value))}
              className={styles.sizeInput}
            />
            <span className={styles.muted}> {system === "imperial" ? "in" : "cm"}</span>
          </div>

          <div className={styles.label}>Target DPI</div>
          <div className={styles.value}>
            <input
              type="number"
              min={1}
              max={currentDpi}
              value={targetDpi}
              onChange={(e) => setTargetDpi(Math.min(currentDpi, Math.max(1, Number(e.target.value) || 1)))}
              className={styles.dpiInput}
            />
          </div>

          <div className={styles.label}>Current file size</div>
          <div className={styles.value}>{formatFileSize(sizeBytes)}</div>

          <div className={styles.label}>Expected file size</div>
          <div className={styles.value}>
            {previewPending && <span className={styles.muted}>calculating…</span>}
            {!previewPending && previewBlob && (
              <span className={styles.expected}>{formatFileSize(previewBlob.size)}</span>
            )}
          </div>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleApply} loading={saving} disabled={previewPending}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}

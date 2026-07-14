/** Downscales a PNG's pixel dimensions to match a target DPI at its current
 * physical (print) size — the standard "resample to N dpi" workflow. Never
 * upscales: a target DPI above the source's is clamped to a no-op scale.
 * The PNG's own compression level isn't controllable via the Canvas API
 * (`toBlob`'s quality argument only affects JPEG/WebP) — dimensions are the
 * only real lever available here, which is exactly what a DPI-driven resize
 * needs anyway. */
export async function resizePng(
  sourceBlob: Blob,
  sourceDpi: number,
  targetDpi: number,
  widthPx: number,
  heightPx: number,
): Promise<{ blob: Blob; widthPx: number; heightPx: number }> {
  const scale = Math.min(1, targetDpi / sourceDpi);
  const newWidth = Math.max(1, Math.round(widthPx * scale));
  const newHeight = Math.max(1, Math.round(heightPx * scale));

  const bitmap = await createImageBitmap(sourceBlob);
  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to encode the resized image.");
  return { blob, widthPx: newWidth, heightPx: newHeight };
}

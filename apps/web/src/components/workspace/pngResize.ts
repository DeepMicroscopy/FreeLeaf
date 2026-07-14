/** Re-encodes a PNG at the given target pixel dimensions. The caller (see
 * ResizeImageDialog.tsx) works out those target dimensions from whatever
 * combination of DPI and/or physical size the user set — this function just
 * does the actual downscale + re-encode. The PNG's own compression level
 * isn't controllable via the Canvas API (`toBlob`'s quality argument only
 * affects JPEG/WebP) — pixel dimensions are the only real file-size lever
 * available here. */
export async function resizePng(
  sourceBlob: Blob,
  targetWidthPx: number,
  targetHeightPx: number,
): Promise<{ blob: Blob; widthPx: number; heightPx: number }> {
  const newWidth = Math.max(1, Math.round(targetWidthPx));
  const newHeight = Math.max(1, Math.round(targetHeightPx));

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

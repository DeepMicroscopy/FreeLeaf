const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const METERS_PER_INCH = 39.3701;
const ASSUMED_DPI = 96;

export interface PngMetadata {
  widthPx: number;
  heightPx: number;
  dpi: number;
  dpiSource: "pHYs" | "assumed";
}

/** Reads a PNG's pixel dimensions (from its IHDR chunk) and DPI (from its
 * optional pHYs chunk, which most real-world PNGs — especially screenshots —
 * don't have; browsers expose no DPI metadata via any standard API, so this
 * requires reading the raw chunk ourselves). Returns null for non-PNG or
 * too-short input. */
export function parsePngMetadata(bytes: ArrayBuffer): PngMetadata | null {
  if (bytes.byteLength < 8 + 25) return null; // signature + minimal IHDR chunk
  const view = new DataView(bytes);
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (view.getUint8(i) !== PNG_SIGNATURE[i]) return null;
  }

  const ihdrType = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
  if (ihdrType !== "IHDR") return null;
  const widthPx = view.getUint32(16, false);
  const heightPx = view.getUint32(20, false);

  let offset = 8;
  let dpi = ASSUMED_DPI;
  let dpiSource: "pHYs" | "assumed" = "assumed";
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7),
    );
    const dataStart = offset + 8;
    if (type === "pHYs" && dataStart + 9 <= bytes.byteLength) {
      const pixelsPerUnitX = view.getUint32(dataStart, false);
      const unitSpecifier = view.getUint8(dataStart + 8);
      if (unitSpecifier === 1) {
        dpi = Math.round(pixelsPerUnitX / METERS_PER_INCH);
        dpiSource = "pHYs";
      }
      break;
    }
    // pHYs (if present at all) always appears before the first IDAT — no
    // point scanning image data looking for it.
    if (type === "IDAT" || type === "IEND") break;
    offset = dataStart + length + 4; // + 4 for the trailing CRC
  }

  return { widthPx, heightPx, dpi, dpiSource };
}

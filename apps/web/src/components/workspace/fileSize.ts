/** Thresholds shared between the file tree's warning color and the image
 * preview pane's "file is very large" banner (Plan.md §9 extension), so
 * both always agree on what counts as large. */
export const FILE_SIZE_WARN_BYTES = 3 * 1024 * 1024;
export const FILE_SIZE_CRITICAL_BYTES = 5 * 1024 * 1024;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

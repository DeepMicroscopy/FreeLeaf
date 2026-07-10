// Mirrors apps/api/core/urlsafety.py — defense in depth for the same
// open-redirect concern, in case a `next` param is tampered with client-side.
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  if (next.includes("://")) return null;
  return next;
}

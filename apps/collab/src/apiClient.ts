// Talks to apps/api's internal, shared-secret-protected content endpoints
// (projects/collab_api.py) — collab has no DB/session access of its own.

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://api:8000";
const COLLAB_SHARED_SECRET = process.env.COLLAB_SHARED_SECRET ?? "dev-insecure-collab-secret";

export async function fetchFileContent(fileId: string): Promise<string> {
  const res = await fetch(`${API_INTERNAL_URL}/api/internal/collab/files/${fileId}/content`, {
    headers: { "X-Collab-Secret": COLLAB_SHARED_SECRET },
  });
  if (!res.ok) throw new Error(`fetchFileContent(${fileId}) failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { content: string };
  return body.content;
}

export async function persistFileContent(fileId: string, content: string, editorUserId?: string | null): Promise<void> {
  const res = await fetch(`${API_INTERNAL_URL}/api/internal/collab/files/${fileId}/content`, {
    method: "PUT",
    headers: { "X-Collab-Secret": COLLAB_SHARED_SECRET, "content-type": "application/json" },
    body: JSON.stringify({ content, editor_user_id: editorUserId ?? null }),
  });
  if (!res.ok) throw new Error(`persistFileContent(${fileId}) failed: ${res.status}`);
}

// A binary Yjs snapshot, stored separately from the plain-text content above
// — the only thing that carries suggested-edit formatting (Plan.md §9 Phase
// 8 extension), which a room's own plain-text persistence has no way to
// represent. Returns null if none exists yet (a brand new file, or one that
// predates this feature) — the caller falls back to plain-text-only seeding.
export async function fetchYjsSnapshot(fileId: string): Promise<Uint8Array | null> {
  const res = await fetch(`${API_INTERNAL_URL}/api/internal/collab/files/${fileId}/yjs-snapshot`, {
    headers: { "X-Collab-Secret": COLLAB_SHARED_SECRET },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchYjsSnapshot(${fileId}) failed: ${res.status} ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function persistYjsSnapshot(fileId: string, snapshot: Uint8Array): Promise<void> {
  const res = await fetch(`${API_INTERNAL_URL}/api/internal/collab/files/${fileId}/yjs-snapshot`, {
    method: "PUT",
    headers: { "X-Collab-Secret": COLLAB_SHARED_SECRET, "content-type": "application/octet-stream" },
    body: snapshot,
  });
  if (!res.ok) throw new Error(`persistYjsSnapshot(${fileId}) failed: ${res.status}`);
}

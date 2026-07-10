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

export async function persistFileContent(fileId: string, content: string): Promise<void> {
  const res = await fetch(`${API_INTERNAL_URL}/api/internal/collab/files/${fileId}/content`, {
    method: "PUT",
    headers: { "X-Collab-Secret": COLLAB_SHARED_SECRET, "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`persistFileContent(${fileId}) failed: ${res.status}`);
}

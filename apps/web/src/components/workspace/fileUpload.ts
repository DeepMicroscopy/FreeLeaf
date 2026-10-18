import { api } from "@freeleaf/shared";

/** Uploads one file to a project at `path` (folder-relative, empty for
 * root). Shared by FileTree.tsx's tree-upload flow and the missing-file
 * fix-it dialog so both use the exact same multipart request shape. Fails
 * with a 409 if a file already exists at that path — see
 * replaceFileContent below for overwriting one on purpose instead. */
export async function uploadSingleFile(projectId: string, path: string, file: File) {
  return api.POST("/api/projects/{project_id}/files/upload", {
    params: { path: { project_id: projectId }, query: { path } },
    // Cast as any here to satisfy the strict OpenAPI schema type checker
    body: { file: file as any },
    bodySerializer: (body) => {
      const form = new FormData();
      // body.file here will still correctly reference your original native File object
      form.append("file", body.file);
      return form;
    },
  });
}

/** Replaces an *existing* file's content in place (same id/path, just new
 * bytes) — the deliberate-overwrite counterpart to uploadSingleFile above,
 * for when the caller already confirmed with the user that clobbering
 * `fileId`'s current content is what they want. Same endpoint
 * ResizeImageDialog.tsx uses to save a resized image back over the
 * original. */
export async function replaceFileContent(projectId: string, fileId: string, file: File | Blob) {
  return api.PUT("/api/projects/{project_id}/files/{file_id}/binary-content", {
    params: { path: { project_id: projectId, file_id: fileId } },
    // Cast as any here to satisfy the strict OpenAPI schema type checker
    body: { file: file as any },
    bodySerializer: (body) => {
      const form = new FormData();
      form.append("file", body.file);
      return form;
    },
  });
}

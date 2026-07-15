import { api } from "@freeleaf/shared";

/** Uploads one file to a project at `path` (folder-relative, empty for
 * root). Shared by FileTree.tsx's tree-upload flow and the missing-file
 * fix-it dialog so both use the exact same multipart request shape. */
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

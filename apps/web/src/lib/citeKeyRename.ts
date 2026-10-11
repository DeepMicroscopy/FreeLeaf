/** Keeping \cite{}-family usages in sync when a cite key is renamed in the
 * Library (LibraryTab.tsx). Two phases, deliberately separate: a cheap,
 * read-only scan across every .tex file to decide whether to even ask the
 * user, and — only once they've confirmed — the actual rewrite, which
 * reconnects live to each affected file over Yjs (same collab-token/
 * WebSocket path CodeMirrorEditor.tsx and lib/bibliography.tsx's
 * useBibDoc use) so the edit is a normal collaborative change, not a
 * REST overwrite that could clobber a concurrent editor. */

import { api, apiOrigin } from "@freeleaf/shared";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { findCiteKeyOccurrences } from "../components/workspace/citeCompletion";

export interface CiteKeyUsage {
  fileId: string;
  path: string;
  count: number;
}

/** Scans every given (.tex) file's last-persisted content — the same plain
 * REST endpoint HistoryTab.tsx uses for diffing, not a live Yjs connection
 * — for `\cite{}`-family usages of `key`. Cheap enough to run across every
 * file up front; the actual rewrite re-reads live content anyway, so any
 * staleness here only affects whether the user gets asked, never
 * correctness of the rewrite itself. */
export async function findCiteKeyUsageAcrossProject(
  projectId: string,
  texFiles: { id: string; path: string }[],
  key: string,
): Promise<CiteKeyUsage[]> {
  const results = await Promise.all(
    texFiles.map(async (file): Promise<CiteKeyUsage> => {
      const res = await fetch(`${apiOrigin()}/api/projects/${projectId}/files/${file.id}/content`, {
        credentials: "include",
      });
      const text = res.ok ? await res.text() : null;
      const count = text ? findCiteKeyOccurrences(text, key).length : 0;
      return { fileId: file.id, path: file.path, count };
    }),
  );
  return results.filter((r) => r.count > 0);
}

async function renameCiteKeyInFile(
  projectId: string,
  fileId: string,
  oldKey: string,
  newKey: string,
): Promise<number> {
  const { data: token } = await api.GET("/api/projects/{project_id}/files/{file_id}/collab-token", {
    params: { path: { project_id: projectId, file_id: fileId } },
  });
  if (!token) return 0;

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("content");
  const provider = new WebsocketProvider(token.ws_url, fileId, ydoc, { params: { token: token.token } });

  try {
    await new Promise<void>((resolve) => {
      provider.on("sync", (isSynced: boolean) => {
        if (isSynced) resolve();
      });
    });

    // Re-scan live content rather than trusting the earlier REST-based
    // detection — a concurrent edit to this file in the meantime can't
    // then cause a stale or incorrect rewrite.
    const occurrences = findCiteKeyOccurrences(ytext.toString(), oldKey);
    if (occurrences.length === 0) return 0;

    // Apply from the end of the document backward so each edit's own
    // offset stays valid for the ones still to come — an edit never
    // shifts anything to its own left.
    const sorted = [...occurrences].sort((a, b) => b.from - a.from);
    ytext.doc!.transact(() => {
      for (const occ of sorted) {
        ytext.delete(occ.from, occ.to - occ.from);
        ytext.insert(occ.from, newKey);
      }
    });

    // This transport has no per-update ack/flush signal for a one-shot
    // connection like this — give the change a moment to actually reach
    // the server before tearing the socket down.
    await new Promise((resolve) => setTimeout(resolve, 500));

    return occurrences.length;
  } finally {
    provider.destroy();
    ydoc.destroy();
  }
}

/** Rewrites every `\cite{oldKey}`-family usage to `newKey` across the given
 * files — normally exactly the ones `findCiteKeyUsageAcrossProject` found
 * and the user confirmed. One file at a time: typical projects have few
 * enough .tex files that this is fast, and it keeps a failure on one file
 * from being entangled with N concurrent socket connections. */
export async function renameCiteKeyAcrossFiles(
  projectId: string,
  fileIds: string[],
  oldKey: string,
  newKey: string,
): Promise<{ filesChanged: number; occurrencesChanged: number }> {
  let filesChanged = 0;
  let occurrencesChanged = 0;
  for (const fileId of fileIds) {
    const count = await renameCiteKeyInFile(projectId, fileId, oldKey, newKey);
    if (count > 0) {
      filesChanged++;
      occurrencesChanged += count;
    }
  }
  return { filesChanged, occurrencesChanged };
}

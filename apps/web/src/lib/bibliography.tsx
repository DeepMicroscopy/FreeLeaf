import { api, findDuplicateByContent, parseBibtex, serializeEntry } from "@freeleaf/shared";
import type { BibEntry } from "@freeleaf/shared";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface AddResult {
  added: string[];
  conflicts: string[];
}

interface BibDoc {
  entries: BibEntry[];
  loading: boolean;
  addEntries: (parsed: Array<{ type: string; key: string; fields: Record<string, string> }>) => AddResult;
  updateEntry: (key: string, next: { type: string; key: string; fields: Record<string, string> }) => boolean;
  deleteEntry: (key: string) => boolean;
  /** Same paper under a different key — see findDuplicateByContent. Always
   * re-parses live content rather than trusting the `entries` state, which
   * can lag a tick behind the Yjs observer. */
  findNearDuplicate: (candidate: { fields: Record<string, string> }) => BibEntry | null;
  findByKey: (key: string) => BibEntry | null;
}

const NOOP_DOC: BibDoc = {
  entries: [],
  loading: false,
  addEntries: (parsed) => ({ added: [], conflicts: parsed.map((p) => p.key) }),
  updateEntry: () => false,
  deleteEntry: () => false,
  findNearDuplicate: () => null,
  findByKey: () => null,
};

/** Opens a live Yjs connection to one `.bib` file and exposes parse/CRUD
 * over its content (the central bib is a Yjs doc, same collab-token/
 * WebSocket path CodeMirrorEditor uses). Pass `fileId: null` to no-op
 * without opening a connection — lets callers call this hook
 * unconditionally (e.g. only connect to a second, non-central file when
 * the user is actually viewing one). */
export function useBibDoc(projectId: string, fileId: string | null): BibDoc {
  const [entries, setEntries] = useState<BibEntry[]>([]);
  const [loading, setLoading] = useState(Boolean(fileId));
  const ytextRef = useRef<Y.Text | null>(null);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    setLoading(true);
    setEntries([]);
    ytextRef.current = null;

    let provider: WebsocketProvider | null = null;
    let ydoc: Y.Doc | null = null;

    (async () => {
      const { data: token } = await api.GET("/api/projects/{project_id}/files/{file_id}/collab-token", {
        params: { path: { project_id: projectId, file_id: fileId } },
      });
      if (!token || cancelled) return;

      ydoc = new Y.Doc();
      const ytext = ydoc.getText("content");
      ytextRef.current = ytext;
      provider = new WebsocketProvider(token.ws_url, fileId, ydoc, {
        params: { token: token.token },
      });

      const refresh = () => setEntries(parseBibtex(ytext.toString()));
      ytext.observe(refresh);

      provider.on("sync", (isSynced: boolean) => {
        if (!isSynced || cancelled) return;
        refresh();
        setLoading(false);
      });
    })();

    return () => {
      cancelled = true;
      provider?.destroy();
      ydoc?.destroy();
    };
  }, [projectId, fileId]);

  if (!fileId) return NOOP_DOC;

  function addEntries(
    parsed: Array<{ type: string; key: string; fields: Record<string, string> }>,
  ): AddResult {
    const ytext = ytextRef.current;
    if (!ytext) return { added: [], conflicts: parsed.map((p) => p.key) };

    const existingKeys = new Set(parseBibtex(ytext.toString()).map((e) => e.key));
    const added: string[] = [];
    const conflicts: string[] = [];
    const toInsert: string[] = [];

    for (const entry of parsed) {
      if (existingKeys.has(entry.key)) {
        conflicts.push(entry.key);
        continue;
      }
      existingKeys.add(entry.key);
      added.push(entry.key);
      toInsert.push(serializeEntry(entry));
    }

    if (toInsert.length > 0) {
      const prefix = ytext.length > 0 ? "\n" : "";
      ytext.doc!.transact(() => {
        ytext.insert(ytext.length, prefix + toInsert.join("\n"));
      });
    }
    return { added, conflicts };
  }

  function updateEntry(key: string, next: { type: string; key: string; fields: Record<string, string> }): boolean {
    const ytext = ytextRef.current;
    if (!ytext) return false;
    const current = parseBibtex(ytext.toString()).find((e) => e.key === key);
    if (!current) return false;

    ytext.doc!.transact(() => {
      ytext.delete(current.start, current.end - current.start);
      ytext.insert(current.start, serializeEntry(next).trimEnd());
    });
    return true;
  }

  function deleteEntry(key: string): boolean {
    const ytext = ytextRef.current;
    if (!ytext) return false;
    const text = ytext.toString();
    const current = parseBibtex(text).find((e) => e.key === key);
    if (!current) return false;

    let deleteEnd = current.end;
    while (deleteEnd < text.length && text[deleteEnd] === "\n" && deleteEnd < current.end + 2) deleteEnd++;
    ytext.doc!.transact(() => {
      ytext.delete(current.start, deleteEnd - current.start);
    });
    return true;
  }

  function findNearDuplicate(candidate: { fields: Record<string, string> }): BibEntry | null {
    const ytext = ytextRef.current;
    if (!ytext) return null;
    return findDuplicateByContent(parseBibtex(ytext.toString()), candidate);
  }

  function findByKey(key: string): BibEntry | null {
    const ytext = ytextRef.current;
    if (!ytext) return null;
    return parseBibtex(ytext.toString()).find((e) => e.key === key) ?? null;
  }

  return { entries, loading, addEntries, updateEntry, deleteEntry, findNearDuplicate, findByKey };
}

interface BibliographyContextValue extends BibDoc {
  centralFileId: string | null;
}

const BibliographyContext = createContext<BibliographyContextValue | null>(null);

export function BibliographyProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [centralFileId, setCentralFileId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCentralFileId(null);
    api
      .GET("/api/projects/{project_id}/bibliography", { params: { path: { project_id: projectId } } })
      .then(({ data }) => {
        if (!cancelled && data) setCentralFileId(data.file_id);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const doc = useBibDoc(projectId, centralFileId);

  return (
    <BibliographyContext.Provider value={{ ...doc, centralFileId, loading: doc.loading || !centralFileId }}>
      {children}
    </BibliographyContext.Provider>
  );
}

export function useBibliography(): BibliographyContextValue {
  const ctx = useContext(BibliographyContext);
  if (!ctx) throw new Error("useBibliography must be used within BibliographyProvider");
  return ctx;
}

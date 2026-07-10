import { api, parseBibtex, serializeEntry } from "@freeleaf/shared";
import type { BibEntry } from "@freeleaf/shared";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface AddResult {
  added: string[];
  conflicts: string[];
}

interface BibliographyContextValue {
  entries: BibEntry[];
  loading: boolean;
  addEntries: (parsed: Array<{ type: string; key: string; fields: Record<string, string> }>) => AddResult;
  updateEntry: (key: string, next: { type: string; key: string; fields: Record<string, string> }) => boolean;
  deleteEntry: (key: string) => boolean;
}

const BibliographyContext = createContext<BibliographyContextValue | null>(null);

export function BibliographyProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [entries, setEntries] = useState<BibEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const ytextRef = useRef<Y.Text | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEntries([]);
    ytextRef.current = null;

    let provider: WebsocketProvider | null = null;
    let ydoc: Y.Doc | null = null;

    (async () => {
      const { data: bib } = await api.GET("/api/projects/{project_id}/bibliography", {
        params: { path: { project_id: projectId } },
      });
      if (!bib || cancelled) return;

      const { data: token } = await api.GET("/api/projects/{project_id}/files/{file_id}/collab-token", {
        params: { path: { project_id: projectId, file_id: bib.file_id } },
      });
      if (!token || cancelled) return;

      ydoc = new Y.Doc();
      const ytext = ydoc.getText("content");
      ytextRef.current = ytext;
      provider = new WebsocketProvider(token.ws_url, bib.file_id, ydoc, {
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
  }, [projectId]);

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

  return (
    <BibliographyContext.Provider value={{ entries, loading, addEntries, updateEntry, deleteEntry }}>
      {children}
    </BibliographyContext.Provider>
  );
}

export function useBibliography(): BibliographyContextValue {
  const ctx = useContext(BibliographyContext);
  if (!ctx) throw new Error("useBibliography must be used within BibliographyProvider");
  return ctx;
}

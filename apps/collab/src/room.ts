import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

import { fetchFileContent, fetchYjsSnapshot, persistFileContent, persistYjsSnapshot } from "./apiClient.js";

const PERSIST_INTERVAL_MS = 4000;

/** One collaborative `.tex`/`.bib` document. The shared text lives under the
 * "content" key so the frontend's y-codemirror.next binding and this server
 * agree on where it is. */
export class Room {
  readonly ydoc = new Y.Doc();
  readonly awareness = new Awareness(this.ydoc);
  readonly ytext = this.ydoc.getText("content");
  clientCount = 0;
  private dirty = false;
  private persistTimer: ReturnType<typeof setInterval>;
  readonly ready: Promise<void>;
  // Best-effort attribution for "last changed by" — whichever connected
  // user's update this room saw most recently, not a full authorship history.
  private lastEditorUserId: string | null = null;

  noteEditor(userId: string): void {
    this.lastEditorUserId = userId;
  }

  constructor(readonly fileId: string) {
    console.log(`[collab] room created: ${fileId}`);
    this.ready = this.seed();
    this.ydoc.on("update", () => {
      this.dirty = true;
    });
    this.persistTimer = setInterval(() => {
      void this.flush();
    }, PERSIST_INTERVAL_MS);
  }

  private async seed(): Promise<void> {
    const [content, snapshot] = await Promise.all([
      fetchFileContent(this.fileId).catch((err) => {
        console.error(`[collab] failed to seed room ${this.fileId}:`, err);
        return "";
      }),
      fetchYjsSnapshot(this.fileId).catch((err) => {
        console.error(`[collab] failed to fetch yjs snapshot for ${this.fileId}:`, err);
        return null;
      }),
    ]);

    if (this.ytext.length === 0) {
      // A snapshot carries suggested-edit formatting (Plan.md §9 Phase 8
      // extension) that plain text can't represent at all — but it's only
      // safe to trust if nothing touched the file *outside* the collab room
      // since it was taken (a direct non-collab edit, a version restore).
      // Decode it into a scratch doc first and compare its plain text
      // against the current storage content; only apply it if they agree,
      // otherwise silently fall back to the plain-text-only seed exactly as
      // before this feature existed — stale formatting is a lost "pending
      // suggestion" annoyance, but resurrecting stale *text* would be a
      // real correctness bug, so text always wins the tie-break.
      let usedSnapshot = false;
      if (snapshot) {
        const scratch = new Y.Doc();
        try {
          Y.applyUpdate(scratch, snapshot);
          if (scratch.getText("content").toString() === content) {
            Y.applyUpdate(this.ydoc, snapshot);
            usedSnapshot = true;
          } else {
            console.warn(`[collab] yjs snapshot for ${this.fileId} is stale (text mismatch) — discarding it`);
          }
        } finally {
          scratch.destroy();
        }
      }
      if (!usedSnapshot && content) {
        this.ytext.insert(0, content);
      }
    }
    console.log(`[collab] room seeded: ${this.fileId} contentLength=${content.length} fromSnapshot=${Boolean(snapshot)}`);
    // Seeding isn't a real edit — don't burn a persistence round-trip on it.
    this.dirty = false;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const content = this.ytext.toString();
      const snapshot = Y.encodeStateAsUpdate(this.ydoc);
      await Promise.all([
        persistFileContent(this.fileId, content, this.lastEditorUserId),
        persistYjsSnapshot(this.fileId, snapshot),
      ]);
      console.log(`[collab] persisted ${this.fileId}: contentLength=${content.length} snapshotBytes=${snapshot.length}`);
    } catch (err) {
      console.error(`[collab] failed to persist ${this.fileId}:`, err);
      this.dirty = true; // retry on the next tick
    }
  }

  /** Replaces the whole document (used by version-history restore, Plan.md
   * §9 Phase 8) via a proper Yjs delete+insert transaction rather than a raw
   * overwrite — this way it merges correctly and broadcasts to any clients
   * connected to this room right now, the same as a normal edit would. */
  async replaceContent(newContent: string): Promise<void> {
    this.ydoc.transact(() => {
      this.ytext.delete(0, this.ytext.length);
      this.ytext.insert(0, newContent);
    });
    await this.flush();
  }

  async destroy(): Promise<void> {
    console.log(`[collab] room destroyed: ${this.fileId}`);
    clearInterval(this.persistTimer);
    await this.flush();
    this.ydoc.destroy();
  }
}

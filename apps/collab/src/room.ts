import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

import { fetchFileContent, persistFileContent } from "./apiClient.js";

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

  constructor(private readonly fileId: string) {
    this.ready = this.seed();
    this.ydoc.on("update", () => {
      this.dirty = true;
    });
    this.persistTimer = setInterval(() => {
      void this.flush();
    }, PERSIST_INTERVAL_MS);
  }

  private async seed(): Promise<void> {
    const content = await fetchFileContent(this.fileId).catch((err) => {
      console.error(`[collab] failed to seed room ${this.fileId}:`, err);
      return "";
    });
    if (this.ytext.length === 0 && content) {
      this.ytext.insert(0, content);
    }
    // Seeding isn't a real edit — don't burn a persistence round-trip on it.
    this.dirty = false;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await persistFileContent(this.fileId, this.ytext.toString());
    } catch (err) {
      console.error(`[collab] failed to persist ${this.fileId}:`, err);
      this.dirty = true; // retry on the next tick
    }
  }

  async destroy(): Promise<void> {
    clearInterval(this.persistTimer);
    await this.flush();
    this.ydoc.destroy();
  }
}

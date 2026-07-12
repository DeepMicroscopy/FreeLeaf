import { Files, Image as ImageIcon, ListTree } from "lucide-react";
import { useState } from "react";

import { FiguresTablesPanel, OutlinePanel } from "./DocumentNavPanels";
import { FileTree } from "./FileTree";
import styles from "./WorkspaceSidebar.module.css";

type SidebarTab = "files" | "outline" | "figures";

/** Left panel tab strip (Plan.md §9 Phase 11): Files (the existing file
 * tree), Outline, and Figures & Tables — the latter two scan whichever
 * `.tex` file is currently open in the editor (via `useWorkspace`'s
 * `currentFileText`) and are unrelated to which top-level route
 * (Editor/Library/Settings/History) is active, so they're plain empty
 * states outside the Editor tab. */
export function WorkspaceSidebar() {
  const [tab, setTab] = useState<SidebarTab>("files");

  return (
    <div className={styles.root}>
      <div className={styles.content}>
        {tab === "files" && <FileTree />}
        {tab === "outline" && <OutlinePanel />}
        {tab === "figures" && <FiguresTablesPanel />}
      </div>
      <nav className={styles.tabStrip}>
        <button
          className={[styles.tab, tab === "files" ? styles.tabActive : ""].join(" ")}
          onClick={() => setTab("files")}
          title="Files"
        >
          <Files size={15} aria-hidden="true" />
          Files
        </button>
        <button
          className={[styles.tab, tab === "outline" ? styles.tabActive : ""].join(" ")}
          onClick={() => setTab("outline")}
          title="Outline"
        >
          <ListTree size={15} aria-hidden="true" />
          Outline
        </button>
        <button
          className={[styles.tab, tab === "figures" ? styles.tabActive : ""].join(" ")}
          onClick={() => setTab("figures")}
          title="Figures & Tables"
        >
          <ImageIcon size={15} aria-hidden="true" />
          Figures
        </button>
      </nav>
    </div>
  );
}

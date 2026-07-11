import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/Button";
import type { ColumnAlign, TableGridModel } from "./tableDesigner";
import styles from "./TableDesignerDialog.module.css";

function cloneModel(model: TableGridModel): TableGridModel {
  return {
    widthArg: model.widthArg,
    columns: model.columns.map((c) => ({ ...c })),
    verticalBorders: [...model.verticalBorders],
    rows: model.rows.map((r) => [...r]),
    horizontalBorders: [...model.horizontalBorders],
  };
}

export function TableDesignerDialog({
  envName,
  model,
  onSave,
  onCancel,
}: {
  envName: string;
  model: TableGridModel;
  onSave: (model: TableGridModel) => void;
  onCancel: () => void;
}) {
  const [grid, setGrid] = useState<TableGridModel>(() => cloneModel(model));

  const ncols = grid.columns.length;
  const nrows = grid.rows.length;

  function updateCell(r: number, c: number, value: string) {
    setGrid((g) => {
      const next = cloneModel(g);
      next.rows[r][c] = value;
      return next;
    });
  }

  function setAlign(c: number, align: ColumnAlign) {
    setGrid((g) => {
      const next = cloneModel(g);
      next.columns[c].align = align;
      return next;
    });
  }

  function toggleVBorder(idx: number) {
    setGrid((g) => {
      const next = cloneModel(g);
      next.verticalBorders[idx] = !next.verticalBorders[idx];
      return next;
    });
  }

  function toggleHBorder(idx: number) {
    setGrid((g) => {
      const next = cloneModel(g);
      next.horizontalBorders[idx] = !next.horizontalBorders[idx];
      return next;
    });
  }

  function addColumn() {
    setGrid((g) => {
      const next = cloneModel(g);
      next.columns.push({ align: "l" });
      next.verticalBorders.splice(next.verticalBorders.length - 1, 0, false);
      for (const row of next.rows) row.push("");
      return next;
    });
  }

  function removeColumn(c: number) {
    setGrid((g) => {
      if (g.columns.length <= 1) return g;
      const next = cloneModel(g);
      next.columns.splice(c, 1);
      next.verticalBorders.splice(c, 1);
      for (const row of next.rows) row.splice(c, 1);
      return next;
    });
  }

  function addRow() {
    setGrid((g) => {
      const next = cloneModel(g);
      next.rows.push(Array.from({ length: next.columns.length }, () => ""));
      next.horizontalBorders.splice(next.horizontalBorders.length - 1, 0, false);
      return next;
    });
  }

  function removeRow(r: number) {
    setGrid((g) => {
      if (g.rows.length <= 1) return g;
      const next = cloneModel(g);
      next.rows.splice(r, 1);
      next.horizontalBorders.splice(r, 1);
      return next;
    });
  }

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Table Designer">
        <div className={styles.header}>
          <h3 className={styles.title}>Table Designer — {envName}</h3>
          <p className={styles.hint}>Toggle buttons show/hide borders; click a cell to edit its text.</p>
        </div>

        <div className={styles.tableScroll}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th className={styles.cornerCell} />
                {grid.columns.map((col, c) => (
                  <th key={c} className={styles.colHeaderCell}>
                    <div className={styles.colHeaderControls}>
                      <button
                        className={[styles.borderToggle, grid.verticalBorders[c] ? styles.borderOn : ""].join(" ")}
                        onClick={() => toggleVBorder(c)}
                        title="Toggle border to the left of this column"
                      >
                        │
                      </button>
                      <select
                        className={styles.alignSelect}
                        value={col.align}
                        onChange={(e) => setAlign(c, e.target.value as ColumnAlign)}
                      >
                        <option value="l">left</option>
                        <option value="c">center</option>
                        <option value="r">right</option>
                      </select>
                      <button
                        className={styles.removeButton}
                        onClick={() => removeColumn(c)}
                        disabled={ncols <= 1}
                        title="Remove column"
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </div>
                  </th>
                ))}
                <th className={styles.trailingHeaderCell}>
                  <button
                    className={[styles.borderToggle, grid.verticalBorders[ncols] ? styles.borderOn : ""].join(" ")}
                    onClick={() => toggleVBorder(ncols)}
                    title="Toggle border after the last column"
                  >
                    │
                  </button>
                  <Button variant="ghost" size="sm" onClick={addColumn} title="Add column">
                    <Plus size={14} aria-hidden="true" />
                  </Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row, r) => (
                <tr key={r}>
                  <td className={styles.rowControlCell}>
                    <div className={styles.rowControlInner}>
                      <button
                        className={[styles.borderToggle, grid.horizontalBorders[r] ? styles.borderOn : ""].join(" ")}
                        onClick={() => toggleHBorder(r)}
                        title="Toggle border above this row"
                      >
                        ─
                      </button>
                      <button
                        className={styles.removeButton}
                        onClick={() => removeRow(r)}
                        disabled={nrows <= 1}
                        title="Remove row"
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={styles.dataCell}
                      style={{
                        borderLeft: grid.verticalBorders[c] ? "2px solid var(--text-primary)" : undefined,
                        borderRight: c === ncols - 1 && grid.verticalBorders[ncols] ? "2px solid var(--text-primary)" : undefined,
                        borderTop: grid.horizontalBorders[r] ? "2px solid var(--text-primary)" : undefined,
                        borderBottom: r === nrows - 1 && grid.horizontalBorders[nrows] ? "2px solid var(--text-primary)" : undefined,
                      }}
                    >
                      <input
                        className={styles.cellInput}
                        value={cell}
                        onChange={(e) => updateCell(r, c, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className={styles.rowControlCell}>
                  <div className={styles.rowControlInner}>
                    <button
                      className={[styles.borderToggle, grid.horizontalBorders[nrows] ? styles.borderOn : ""].join(" ")}
                      onClick={() => toggleHBorder(nrows)}
                      title="Toggle border below the last row"
                    >
                      ─
                    </button>
                    <Button variant="ghost" size="sm" onClick={addRow} title="Add row">
                      <Plus size={14} aria-hidden="true" />
                    </Button>
                  </div>
                </td>
                <td colSpan={ncols} />
              </tr>
            </tbody>
          </table>
        </div>

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSave(grid)}>Save</Button>
        </div>
      </div>
    </div>
  );
}

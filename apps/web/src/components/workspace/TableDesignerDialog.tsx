import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/Button";
import {
  canRemoveColumn,
  canRemoveRow,
  cloneGridModel,
  mergeDown,
  mergeRight,
  splitCell,
} from "./tableDesigner";
import type { ColumnAlign, TableGridModel } from "./tableDesigner";
import styles from "./TableDesignerDialog.module.css";

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
  const [grid, setGrid] = useState<TableGridModel>(() => cloneGridModel(model));

  const ncols = grid.columns.length;
  const nrows = grid.rows.length;

  function updateCellText(r: number, c: number, value: string) {
    setGrid((g) => {
      const next = cloneGridModel(g);
      const cell = next.rows[r][c];
      if (cell.kind !== "covered") cell.text = value;
      return next;
    });
  }

  function updateMulticolumnAlign(r: number, c: number, align: ColumnAlign) {
    setGrid((g) => {
      const next = cloneGridModel(g);
      const cell = next.rows[r][c];
      if (cell.kind === "multicolumn") cell.align = align;
      return next;
    });
  }

  function toggleMulticolumnBorder(r: number, c: number, side: "left" | "right") {
    setGrid((g) => {
      const next = cloneGridModel(g);
      const cell = next.rows[r][c];
      if (cell.kind === "multicolumn") {
        if (side === "left") cell.leftBorder = !cell.leftBorder;
        else cell.rightBorder = !cell.rightBorder;
      }
      return next;
    });
  }

  function updateMultirowWidth(r: number, c: number, width: string) {
    setGrid((g) => {
      const next = cloneGridModel(g);
      const cell = next.rows[r][c];
      if (cell.kind === "multirow") cell.width = width;
      return next;
    });
  }

  function doMergeRight(r: number, c: number) {
    setGrid((g) => mergeRight(g, r, c) ?? g);
  }

  function doMergeDown(r: number, c: number) {
    setGrid((g) => mergeDown(g, r, c) ?? g);
  }

  function doSplit(r: number, c: number) {
    setGrid((g) => splitCell(g, r, c));
  }

  function setAlign(c: number, align: ColumnAlign) {
    setGrid((g) => {
      const next = cloneGridModel(g);
      next.columns[c].align = align;
      return next;
    });
  }

  function toggleVBorder(idx: number) {
    setGrid((g) => {
      const next = cloneGridModel(g);
      next.verticalBorders[idx] = !next.verticalBorders[idx];
      return next;
    });
  }

  function toggleHBorder(idx: number) {
    setGrid((g) => {
      const next = cloneGridModel(g);
      next.horizontalBorders[idx] = !next.horizontalBorders[idx];
      return next;
    });
  }

  function addColumn() {
    setGrid((g) => {
      const next = cloneGridModel(g);
      next.columns.push({ align: "l" });
      next.verticalBorders.splice(next.verticalBorders.length - 1, 0, false);
      for (const row of next.rows) row.push({ kind: "text", text: "" });
      return next;
    });
  }

  function removeColumn(c: number) {
    setGrid((g) => {
      if (!canRemoveColumn(g, c)) return g;
      const next = cloneGridModel(g);
      next.columns.splice(c, 1);
      next.verticalBorders.splice(c, 1);
      for (const row of next.rows) row.splice(c, 1);
      return next;
    });
  }

  function addRow() {
    setGrid((g) => {
      const next = cloneGridModel(g);
      next.rows.push(Array.from({ length: next.columns.length }, () => ({ kind: "text" as const, text: "" })));
      next.horizontalBorders.splice(next.horizontalBorders.length - 1, 0, false);
      return next;
    });
  }

  function removeRow(r: number) {
    setGrid((g) => {
      if (!canRemoveRow(g, r)) return g;
      const next = cloneGridModel(g);
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
          <p className={styles.hint}>
            Toggle buttons show/hide borders; click a cell to edit its text. Use ⇥/⇓ to merge cells, ✕ to split a
            merged cell back apart.
          </p>
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
                        disabled={!canRemoveColumn(grid, c)}
                        title={canRemoveColumn(grid, c) ? "Remove column" : "Split any merged cells in this column first"}
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
                        disabled={!canRemoveRow(grid, r)}
                        title={canRemoveRow(grid, r) ? "Remove row" : "Split any merged cells in this row first"}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                  {row.map((cell, c) => {
                    if (cell.kind === "covered") return null;
                    const colSpan = cell.kind === "multicolumn" ? cell.colspan : 1;
                    const rowSpan = cell.kind === "multirow" ? cell.rowspan : 1;
                    const isLastCol = c + colSpan === ncols;
                    const borderLeft = cell.kind === "multicolumn" ? cell.leftBorder : grid.verticalBorders[c];
                    const borderRight =
                      cell.kind === "multicolumn" ? cell.rightBorder : isLastCol && grid.verticalBorders[ncols];
                    const canMergeR = cell.kind !== "multirow" && mergeRight(grid, r, c) !== null;
                    const canMergeD = cell.kind !== "multicolumn" && mergeDown(grid, r, c) !== null;
                    return (
                      <td
                        key={c}
                        className={styles.dataCell}
                        colSpan={colSpan}
                        rowSpan={rowSpan}
                        style={{
                          borderLeft: borderLeft ? "2px solid var(--text-primary)" : undefined,
                          borderRight: borderRight ? "2px solid var(--text-primary)" : undefined,
                          borderTop: grid.horizontalBorders[r] ? "2px solid var(--text-primary)" : undefined,
                          borderBottom: r === nrows - 1 && grid.horizontalBorders[nrows] ? "2px solid var(--text-primary)" : undefined,
                        }}
                      >
                        <div className={styles.cellWrap}>
                          <input
                            className={styles.cellInput}
                            value={cell.text}
                            onChange={(e) => updateCellText(r, c, e.target.value)}
                          />
                          {cell.kind === "multicolumn" && (
                            <div className={styles.spanControls}>
                              <button
                                className={[styles.borderToggle, cell.leftBorder ? styles.borderOn : ""].join(" ")}
                                onClick={() => toggleMulticolumnBorder(r, c, "left")}
                                title="Toggle this merged cell's left border"
                              >
                                │
                              </button>
                              <select
                                className={styles.alignSelect}
                                value={cell.align}
                                onChange={(e) => updateMulticolumnAlign(r, c, e.target.value as ColumnAlign)}
                              >
                                <option value="l">left</option>
                                <option value="c">center</option>
                                <option value="r">right</option>
                              </select>
                              <button
                                className={[styles.borderToggle, cell.rightBorder ? styles.borderOn : ""].join(" ")}
                                onClick={() => toggleMulticolumnBorder(r, c, "right")}
                                title="Toggle this merged cell's right border"
                              >
                                │
                              </button>
                              <button className={styles.splitButton} onClick={() => doSplit(r, c)} title="Split merged cell">
                                ✕
                              </button>
                            </div>
                          )}
                          {cell.kind === "multirow" && (
                            <div className={styles.spanControls}>
                              <input
                                className={styles.widthInput}
                                value={cell.width}
                                onChange={(e) => updateMultirowWidth(r, c, e.target.value)}
                                title="\\multirow width argument (e.g. * or 2cm)"
                              />
                              <button className={styles.splitButton} onClick={() => doSplit(r, c)} title="Split merged cell">
                                ✕
                              </button>
                            </div>
                          )}
                          {cell.kind === "text" && (canMergeR || canMergeD) && (
                            <div className={styles.mergeControls}>
                              {canMergeR && (
                                <button
                                  className={styles.mergeButton}
                                  onClick={() => doMergeRight(r, c)}
                                  title="Merge with cell to the right"
                                >
                                  ⇥
                                </button>
                              )}
                              {canMergeD && (
                                <button
                                  className={styles.mergeButton}
                                  onClick={() => doMergeDown(r, c)}
                                  title="Merge with cell below"
                                >
                                  ⇓
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
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

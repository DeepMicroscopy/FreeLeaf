import type { EditingMode } from "../../lib/editingMode";
import { useEditingMode } from "../../lib/editingMode";
import styles from "./ModeSwitcher.module.css";

const MODES: { value: EditingMode; label: string }[] = [
  { value: "writing", label: "Writing" },
  { value: "reviewing", label: "Reviewing" },
  { value: "polishing", label: "Polishing" },
];

export function ModeSwitcher() {
  const { mode, setMode } = useEditingMode();
  return (
    <div className={styles.switcher} role="tablist" aria-label="Editing mode">
      {MODES.map((m) => (
        <button
          key={m.value}
          role="tab"
          aria-selected={mode === m.value}
          className={[styles.option, mode === m.value ? styles.optionActive : ""].join(" ")}
          onClick={() => setMode(m.value)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

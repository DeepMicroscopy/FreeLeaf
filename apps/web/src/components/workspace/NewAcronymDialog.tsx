import { useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { PenguinMascot } from "./PenguinMascot";
import { sanitizeAcronymKey } from "./acronymCompletion";
import styles from "./FixItDialogs.module.css";

export function NewAcronymDialog({
  prefillKey,
  hasBlock,
  existingKeys,
  onConfirm,
  onCancel,
}: {
  prefillKey: string;
  hasBlock: boolean;
  existingKeys: string[];
  onConfirm: (key: string, short: string | null, long: string) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState(prefillKey);
  const [short, setShort] = useState("");
  const [long, setLong] = useState("");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  const trimmedKey = key.trim();
  const trimmedLong = long.trim();
  const keyError = !trimmedKey
    ? null
    : existingKeys.includes(sanitizeAcronymKey(trimmedKey))
      ? "Already defined"
      : null;
  const canSubmit = trimmedKey.length > 0 && trimmedLong.length > 0 && !keyError;

  function submit() {
    if (!canSubmit) return;
    const trimmedShort = short.trim();
    onConfirm(trimmedKey, trimmedShort.length > 0 ? trimmedShort : null, trimmedLong);
  }

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="New acronym">
        <div className={styles.header}>
          <PenguinMascot pose="hammer" />
          <div>
            <h3 className={styles.title}>New acronym</h3>
            {!hasBlock && (
              <p className={styles.hint}>
                No acronym list yet — \usepackage{"{acronym}"} and a \begin{"{acronym}"} block will be added.
              </p>
            )}
          </div>
        </div>

        <div className={styles.body}>
          <div className={styles.section}>
            <label className={styles.sectionLabel} htmlFor="acronym-key">
              Key
            </label>
            <input
              id="acronym-key"
              className={styles.renameInput}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            {keyError && <p className={styles.banner}>{keyError}</p>}
          </div>

          <div className={styles.section}>
            <label className={styles.sectionLabel} htmlFor="acronym-short">
              Short form (optional, defaults to key)
            </label>
            <input
              id="acronym-short"
              className={styles.renameInput}
              value={short}
              onChange={(e) => setShort(e.target.value)}
              placeholder={trimmedKey || "e.g. CPU"}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>

          <div className={styles.section}>
            <label className={styles.sectionLabel} htmlFor="acronym-long">
              Long form
            </label>
            <input
              id="acronym-long"
              className={styles.renameInput}
              value={long}
              onChange={(e) => setLong(e.target.value)}
              placeholder="e.g. Central Processing Unit"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!canSubmit}>
            Add acronym
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from "react";

import { Button } from "../ui/Button";
import { PACKAGE_DOCS } from "./packageDocs";
import { PenguinMascot } from "./PenguinMascot";
import styles from "./FixItDialogs.module.css";

export function AddPackageDialog({
  packageName,
  commandOrEnv,
  onConfirm,
  onCancel,
}: {
  packageName: string;
  commandOrEnv: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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

  const description = PACKAGE_DOCS[packageName]?.description;

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={`Add ${packageName} package`}>
        <div className={styles.header}>
          <PenguinMascot pose="wrench" />
          <div>
            <h3 className={styles.title}>Add \usepackage{`{${packageName}}`}?</h3>
            <p className={styles.hint}>
              {commandOrEnv} isn't defined without it.
            </p>
          </div>
        </div>

        <div className={styles.body}>
          {description && <p className={styles.description}>{description}</p>}
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm}>
            Add package
          </Button>
        </div>
      </div>
    </div>
  );
}

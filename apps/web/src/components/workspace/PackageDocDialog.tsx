import { ExternalLink } from "lucide-react";
import { useEffect } from "react";

import { Button } from "../ui/Button";
import { PACKAGE_DOCS } from "./packageDocs";
import styles from "./PackageDocDialog.module.css";

export function PackageDocDialog({ packageName, onClose }: { packageName: string; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const doc = PACKAGE_DOCS[packageName];

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={`${packageName} documentation`}>
        <div className={styles.header}>
          <h3 className={styles.title}>{packageName}</h3>
        </div>

        {doc ? (
          <div className={styles.body}>
            <p className={styles.description}>{doc.description}</p>
            <pre className={styles.example}>{doc.example}</pre>
            <img className={styles.image} src={doc.image} alt={`Compiled example of the ${packageName} package`} />
          </div>
        ) : (
          <div className={styles.body}>
            <p className={styles.description}>
              No bundled documentation for this package yet. See its page on CTAN for usage and options.
            </p>
            <a
              className={styles.ctanLink}
              href={`https://ctan.org/pkg/${encodeURIComponent(packageName)}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} aria-hidden="true" />
              View {packageName} on CTAN
            </a>
          </div>
        )}

        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

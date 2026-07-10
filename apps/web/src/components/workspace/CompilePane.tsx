import { api, apiOrigin } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { FileText, FileX2, RotateCw } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Spinner } from "../ui/Spinner";
import { PdfViewer } from "./PdfViewer";
import styles from "./CompilePane.module.css";

type CompileRunOut = components["schemas"]["CompileRunOut"];

const AUTO_COMPILE_DEBOUNCE_MS = 800;

export interface CompilePaneHandle {
  scheduleAutoCompile: () => void;
  triggerCompile: () => void;
}

export const CompilePane = forwardRef<CompilePaneHandle, { projectId: string; canWrite: boolean }>(
  function CompilePane({ projectId, canWrite }, ref) {
    const [run, setRun] = useState<CompileRunOut | null>(null);
    const [compiling, setCompiling] = useState(false);
    const [loadingLast, setLoadingLast] = useState(true);
    const [viewMode, setViewMode] = useState<"pdf" | "log">("pdf");
    const [logText, setLogText] = useState<string | null>(null);
    const [logLoading, setLogLoading] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inFlightRef = useRef(false);
    const rerunRequestedRef = useRef(false);

    const compile = useCallback(async () => {
      if (inFlightRef.current) {
        rerunRequestedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      setCompiling(true);
      const { data } = await api.POST("/api/projects/{project_id}/compile", {
        params: { path: { project_id: projectId } },
      });
      if (data) setRun(data);
      inFlightRef.current = false;
      setCompiling(false);
      if (rerunRequestedRef.current) {
        rerunRequestedRef.current = false;
        compile();
      }
    }, [projectId]);

    useImperativeHandle(
      ref,
      () => ({
        scheduleAutoCompile: () => {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(compile, AUTO_COMPILE_DEBOUNCE_MS);
        },
        triggerCompile: () => {
          if (timerRef.current) clearTimeout(timerRef.current);
          compile();
        },
      }),
      [compile],
    );

    useEffect(() => {
      let cancelled = false;
      setLoadingLast(true);
      (async () => {
        const { data } = await api.GET("/api/projects/{project_id}/compile-runs", {
          params: { path: { project_id: projectId } },
        });
        if (!cancelled) {
          setRun(data?.[0] ?? null);
          setLoadingLast(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [projectId]);

    useEffect(() => {
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }, []);

    useEffect(() => {
      if (viewMode !== "log" || !run) return;
      let cancelled = false;
      setLogLoading(true);
      (async () => {
        const res = await fetch(`${apiOrigin()}/api/projects/${projectId}/compile-runs/${run.id}/log`, {
          credentials: "include",
        });
        const text = res.ok ? await res.text() : "Couldn't load the log for this compile run.";
        if (!cancelled) {
          setLogText(text);
          setLogLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [viewMode, run, projectId]);

    if (loadingLast) {
      return (
        <div className={styles.centered}>
          <Spinner />
        </div>
      );
    }

    return (
      <div className={styles.pane}>
        <div className={styles.toolbar}>
          <StatusLabel run={run} compiling={compiling} />
          <div className={styles.toolbarActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setViewMode((m) => (m === "pdf" ? "log" : "pdf"))}
              disabled={!run}
              title={!run ? "Nothing compiled yet." : undefined}
            >
              <FileText size={14} aria-hidden="true" />
              {viewMode === "pdf" ? "View log" : "View PDF"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={compile}
              loading={compiling}
              disabled={!canWrite}
              title={canWrite ? undefined : "You don't have permission to compile this project."}
            >
              <RotateCw size={14} aria-hidden="true" />
              Recompile
            </Button>
          </div>
        </div>
        <div className={styles.body}>
          {!run && !compiling && (
            <EmptyState
              icon={<FileX2 size={32} aria-hidden="true" />}
              title="Nothing compiled yet"
              description="Click Recompile, or save an edit — compiling happens automatically after every save."
            />
          )}
          {run && viewMode === "log" ? (
            logLoading ? (
              <div className={styles.centered}>
                <Spinner />
              </div>
            ) : (
              <pre className={styles.logView}>{logText}</pre>
            )
          ) : (
            <>
              {run?.has_pdf && (
                <PdfViewer src={`${apiOrigin()}/api/projects/${projectId}/compile-runs/${run.id}/pdf`} />
              )}
              {run && !run.has_pdf && !compiling && (
                <EmptyState
                  icon={<FileX2 size={32} aria-hidden="true" />}
                  title={run.status === "timeout" ? "Compile timed out" : "Compile failed"}
                  description="See the errors below for details."
                />
              )}
            </>
          )}
          {run && (run.errors.length > 0 || run.warnings.length > 0) && (
            <DiagnosticsList run={run} />
          )}
        </div>
      </div>
    );
  },
);

function StatusLabel({ run, compiling }: { run: CompileRunOut | null; compiling: boolean }) {
  if (compiling) return <span className={styles.status}>Compiling…</span>;
  if (!run) return <span className={styles.status}>PDF preview</span>;
  if (run.status === "success") {
    return <span className={[styles.status, styles.ok].join(" ")}>Compiled successfully</span>;
  }
  return <span className={[styles.status, styles.bad].join(" ")}>{run.status === "timeout" ? "Timed out" : "Compile failed"}</span>;
}

function DiagnosticsList({ run }: { run: CompileRunOut }) {
  return (
    <div className={styles.diagnostics}>
      {run.errors.map((d, i) => (
        <div key={`e${i}`} className={[styles.diagnostic, styles.error].join(" ")}>
          <span className={styles.location}>{formatLocation(d)}</span>
          <span className={styles.message}>{d.message}</span>
        </div>
      ))}
      {run.warnings.map((d, i) => (
        <div key={`w${i}`} className={[styles.diagnostic, styles.warning].join(" ")}>
          <span className={styles.location}>{formatLocation(d)}</span>
          <span className={styles.message}>{d.message}</span>
        </div>
      ))}
    </div>
  );
}

function formatLocation(d: { file?: string | null; line?: number | null }): string {
  if (d.file && d.line != null) return `${d.file}:${d.line}`;
  if (d.file) return d.file;
  return "";
}

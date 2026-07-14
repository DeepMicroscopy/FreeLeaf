import { api, apiOrigin } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { Download, FileText, FileX2, RotateCw } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { useWorkspace } from "../../lib/workspace";
import { PdfViewer } from "./PdfViewer";
import type { PdfViewerHandle } from "./PdfViewer";
import styles from "./CompilePane.module.css";

type CompileRunOut = components["schemas"]["CompileRunOut"];

const AUTO_COMPILE_DEBOUNCE_MS = 800;

export interface CompilePaneHandle {
  scheduleAutoCompile: () => void;
  triggerCompile: () => void;
  jumpToPdf: (file: string, line: number) => Promise<void>;
}

export const CompilePane = forwardRef<
  CompilePaneHandle,
  {
    projectId: string;
    canWrite: boolean;
    onJumpToSource?: (file: string, line: number) => void;
    onRunChanged?: (run: CompileRunOut | null) => void;
  }
>(function CompilePane({ projectId, canWrite, onJumpToSource, onRunChanged }, ref) {
    const { project } = useWorkspace();
    const [run, setRunState] = useState<CompileRunOut | null>(null);
    const onRunChangedRef = useRef(onRunChanged);
    onRunChangedRef.current = onRunChanged;
    const setRun = useCallback((next: CompileRunOut | null) => {
      setRunState(next);
      onRunChangedRef.current?.(next);
    }, []);
    const [compiling, setCompiling] = useState(false);
    const [loadingLast, setLoadingLast] = useState(true);
    const [viewMode, setViewMode] = useState<"pdf" | "log">("pdf");
    const [logText, setLogText] = useState<string | null>(null);
    const [logLoading, setLogLoading] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inFlightRef = useRef(false);
    const rerunRequestedRef = useRef(false);
    const pdfViewerRef = useRef<PdfViewerHandle>(null);
    const runRef = useRef(run);
    runRef.current = run;
    const onJumpToSourceRef = useRef(onJumpToSource);
    onJumpToSourceRef.current = onJumpToSource;
    const { show } = useToast();
    const [downloading, setDownloading] = useState(false);

    async function handleDownload() {
      const currentRun = runRef.current;
      if (!currentRun) return;
      setDownloading(true);
      try {
        // A plain <a download> only reliably forces a download for
        // same-origin URLs — for a cross-origin api (dev's separate port,
        // or a split-subdomain production deployment), browsers just
        // navigate to/render the PDF instead, ignoring the download hint
        // entirely. Fetching the bytes ourselves and downloading via a
        // blob: URL (always same-origin) works regardless of topology.
        const res = await fetch(
          `${apiOrigin()}/api/projects/${projectId}/compile-runs/${currentRun.id}/pdf`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `${project?.name || "document"}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
      } catch {
        show("Could not download the PDF.", "error");
      } finally {
        setDownloading(false);
      }
    }

    const handleSourceClick = useCallback(
      async (page: number, x: number, y: number) => {
        const currentRun = runRef.current;
        if (!currentRun) return;
        const { data } = await api.GET(
          "/api/projects/{project_id}/compile-runs/{run_id}/synctex/backward",
          { params: { path: { project_id: projectId, run_id: currentRun.id }, query: { page, x, y } } },
        );
        if (data) onJumpToSourceRef.current?.(data.file, data.line);
      },
      [projectId],
    );

    const compile = useCallback(async () => {
      if (inFlightRef.current) {
        rerunRequestedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      setCompiling(true);
      try {
        // A long compile can outlast a reverse proxy's read timeout (a real
        // production case: nginx returns a 504 with an HTML body, which
        // openapi-fetch can't parse as JSON and throws) — without this
        // try/finally, that exception skipped setCompiling(false) entirely
        // and left the UI stuck showing "Compiling…" forever, with no way
        // to recover short of a full page reload.
        const { data } = await api.POST("/api/projects/{project_id}/compile", {
          params: { path: { project_id: projectId } },
        });
        if (data) setRun(data);
        else show("Compile request failed — please try again.", "error");
      } catch {
        show("Lost the connection while compiling — please try again.", "error");
      } finally {
        inFlightRef.current = false;
        setCompiling(false);
      }
      if (rerunRequestedRef.current) {
        rerunRequestedRef.current = false;
        compile();
      }
    }, [projectId, show]);

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
        jumpToPdf: async (file: string, line: number) => {
          const currentRun = runRef.current;
          if (!currentRun) return;
          const { data } = await api.GET(
            "/api/projects/{project_id}/compile-runs/{run_id}/synctex/forward",
            { params: { path: { project_id: projectId, run_id: currentRun.id }, query: { file, line } } },
          );
          if (data) {
            setViewMode("pdf");
            pdfViewerRef.current?.scrollToPosition({
              page: data.page,
              h: data.h,
              v: data.v,
              width: data.width,
              height: data.height,
            });
          }
        },
      }),
      [compile, projectId],
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
            {run?.has_pdf && (
              <button
                type="button"
                className={styles.downloadLink}
                onClick={handleDownload}
                disabled={downloading}
                title="Download the compiled PDF"
              >
                <Download size={14} aria-hidden="true" />
                {downloading ? "Downloading…" : "Download"}
              </button>
            )}
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
                <PdfViewer
                  ref={pdfViewerRef}
                  src={`${apiOrigin()}/api/projects/${projectId}/compile-runs/${run.id}/pdf`}
                  onSourceClick={handleSourceClick}
                />
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

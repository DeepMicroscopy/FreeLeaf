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
import { matchFixes } from "./fixItRules";
import type { FixCandidate } from "./fixItRules";
import styles from "./CompilePane.module.css";

type CompileRunOut = components["schemas"]["CompileRunOut"];

const AUTO_COMPILE_DEBOUNCE_MS = 800;
// Compiling is a two-phase start/poll flow now (Plan.md project-overview
// polish: live compile progress) — the sandbox's own wall-clock cap is 60s;
// this leaves generous headroom above that for the polling loop itself.
const COMPILE_POLL_INTERVAL_MS = 700;
const MAX_COMPILE_POLL_MS = 100_000;

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
    /** Fix-it assistant (fixItRules.ts) — CompilePane only matches
     * candidates from the current run's diagnostics; EditorTab owns the
     * actual doc mutation (it has the CodeMirror ref). */
    onAddPackage?: (pkg: string, commandOrEnv: string) => void;
    onFixMissingFile?: (filename: string, fatal: boolean) => void;
    onFixDuplicateLabel?: (label: string) => void;
    onFixUnescapedAmpersand?: (line: number) => void;
  }
>(function CompilePane(
  {
    projectId,
    canWrite,
    onJumpToSource,
    onRunChanged,
    onAddPackage,
    onFixMissingFile,
    onFixDuplicateLabel,
    onFixUnescapedAmpersand,
  },
  ref,
) {
    const { project } = useWorkspace();
    const [run, setRunState] = useState<CompileRunOut | null>(null);
    const onRunChangedRef = useRef(onRunChanged);
    onRunChangedRef.current = onRunChanged;
    const setRun = useCallback((next: CompileRunOut | null) => {
      setRunState(next);
      onRunChangedRef.current?.(next);
    }, []);
    // Fix-it assistant: whether a suggested fix's dialog opens by itself
    // right after a compile finds one, instead of requiring a click on
    // "Fix" — a personal workflow preference (some collaborators find an
    // auto-popping dialog helpful, others find it intrusive), so it's kept
    // client-side per project rather than a shared ProjectSettings field,
    // same reasoning as the editing-mode selector's own localStorage split.
    const autoOpenFixesKey = `freeleaf.autoOpenFixes.${projectId}`;
    const [autoOpenFixes, setAutoOpenFixesState] = useState(() => {
      const raw = localStorage.getItem(autoOpenFixesKey);
      return raw === null ? true : raw === "true";
    });
    const setAutoOpenFixes = useCallback(
      (value: boolean) => {
        setAutoOpenFixesState(value);
        localStorage.setItem(autoOpenFixesKey, String(value));
      },
      [autoOpenFixesKey],
    );
    const [compiling, setCompiling] = useState(false);
    const [progressSteps, setProgressSteps] = useState<string[]>([]);
    const pollTokenRef = useRef(0);
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
    const autoOpenFixesRef = useRef(autoOpenFixes);
    autoOpenFixesRef.current = autoOpenFixes;
    const fixHandlersRef = useRef<FixHandlers>({
      onAddPackage,
      onFixMissingFile,
      onFixDuplicateLabel,
      onFixUnescapedAmpersand,
    });
    fixHandlersRef.current = { onAddPackage, onFixMissingFile, onFixDuplicateLabel, onFixUnescapedAmpersand };
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

    // Auto-opening a fix dialog makes sense for a compile the user actually
    // asked for (Recompile, Cmd+S) — popping one during the silent,
    // debounced auto-compile-after-every-edit-pause would steal focus from
    // the editor mid-typing, which is exactly the "intrusive" failure mode
    // the auto-open preference exists to let people avoid. So only the
    // explicit path ever auto-opens, regardless of the preference.
    const explicitRerunRequestedRef = useRef(false);

    const compile = useCallback(
      async (explicit: boolean) => {
        if (inFlightRef.current) {
          rerunRequestedRef.current = true;
          if (explicit) explicitRerunRequestedRef.current = true;
          return;
        }
        inFlightRef.current = true;
        setCompiling(true);
        setProgressSteps([]);
        const myToken = ++pollTokenRef.current;
        // Local helper (rather than early `return`s directly in the outer
        // try) so its early exits don't skip the rerun-check code that
        // follows the try/finally below — that logic must run regardless
        // of how polling ended.
        const pollUntilDone = async () => {
          const { data: started } = await api.POST("/api/projects/{project_id}/compile", {
            params: { path: { project_id: projectId } },
          });
          if (!started) {
            show("Compile request failed — please try again.", "error");
            return;
          }

          const deadline = Date.now() + MAX_COMPILE_POLL_MS;
          for (;;) {
            if (pollTokenRef.current !== myToken) return; // superseded by a newer compile, or unmounted
            const { data: progress } = await api.GET("/api/projects/{project_id}/compile/{job_id}/progress", {
              params: { path: { project_id: projectId, job_id: started.job_id } },
            });
            if (!progress) {
              show("Lost the connection while compiling — please try again.", "error");
              return;
            }
            if (pollTokenRef.current !== myToken) return;
            setProgressSteps(progress.steps);

            if (progress.done) {
              if (progress.error) {
                show(`Compile service error: ${progress.error}`, "error");
              } else if (progress.run) {
                setRun(progress.run);
                if (explicit && autoOpenFixesRef.current) {
                  const candidates = matchFixes(progress.run.errors, progress.run.warnings, progress.run.has_pdf);
                  if (candidates.length > 0) dispatchFix(candidates[0], fixHandlersRef.current);
                }
              }
              return;
            }
            if (Date.now() > deadline) {
              show("Compile is taking unusually long — please try again.", "error");
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, COMPILE_POLL_INTERVAL_MS));
          }
        };
        try {
          // A long compile can outlast a reverse proxy's read timeout (a real
          // production case: nginx returns a 504 with an HTML body, which
          // openapi-fetch can't parse as JSON and throws) — without this
          // try/finally, that exception skipped setCompiling(false) entirely
          // and left the UI stuck showing "Compiling…" forever, with no way
          // to recover short of a full page reload.
          await pollUntilDone();
        } catch {
          show("Lost the connection while compiling — please try again.", "error");
        } finally {
          inFlightRef.current = false;
          setCompiling(false);
        }
        if (rerunRequestedRef.current) {
          rerunRequestedRef.current = false;
          const rerunExplicit = explicitRerunRequestedRef.current;
          explicitRerunRequestedRef.current = false;
          compile(rerunExplicit);
        }
      },
      [projectId, show],
    );

    useImperativeHandle(
      ref,
      () => ({
        scheduleAutoCompile: () => {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => compile(false), AUTO_COMPILE_DEBOUNCE_MS);
        },
        triggerCompile: () => {
          if (timerRef.current) clearTimeout(timerRef.current);
          compile(true);
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
        pollTokenRef.current += 1; // stop any in-flight progress polling loop
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
          <StatusLabel run={run} compiling={compiling} progressSteps={progressSteps} />
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
              onClick={() => compile(true)}
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
            <>
              <SuggestedFixesList
                run={run}
                autoOpenFixes={autoOpenFixes}
                onAutoOpenFixesChange={setAutoOpenFixes}
                onAddPackage={onAddPackage}
                onFixMissingFile={onFixMissingFile}
                onFixDuplicateLabel={onFixDuplicateLabel}
                onFixUnescapedAmpersand={onFixUnescapedAmpersand}
              />
              <DiagnosticsList run={run} />
            </>
          )}
        </div>
      </div>
    );
  },
);

function StatusLabel({
  run,
  compiling,
  progressSteps,
}: {
  run: CompileRunOut | null;
  compiling: boolean;
  progressSteps: string[];
}) {
  if (compiling) {
    const currentStep = progressSteps[progressSteps.length - 1];
    return (
      <span className={styles.status}>
        <Spinner size={12} />
        {currentStep ? `Compiling… (${currentStep})` : "Compiling…"}
      </span>
    );
  }
  if (!run) return <span className={styles.status}>PDF preview</span>;
  if (run.status === "success") {
    return <span className={[styles.status, styles.ok].join(" ")}>Compiled successfully</span>;
  }
  return <span className={[styles.status, styles.bad].join(" ")}>{run.status === "timeout" ? "Timed out" : "Compile failed"}</span>;
}

function fixLabel(c: FixCandidate): string {
  switch (c.kind) {
    case "add-package":
      return `${c.commandOrEnv} needs \\usepackage{${c.package}}`;
    case "missing-file":
      return `File not found: ${c.filename}`;
    case "duplicate-label":
      return `Label defined multiple times: ${c.label}`;
    case "unescaped-ampersand":
      return `Line ${c.line}: unescaped &`;
  }
}

interface FixHandlers {
  onAddPackage?: (pkg: string, commandOrEnv: string) => void;
  onFixMissingFile?: (filename: string, fatal: boolean) => void;
  onFixDuplicateLabel?: (label: string) => void;
  onFixUnescapedAmpersand?: (line: number) => void;
}

/** Shared by the manual "Fix" button click and the auto-open-on-compile
 * path (see `compile()`'s success handler) — same dispatch either way, just
 * a different trigger. */
function dispatchFix(c: FixCandidate, handlers: FixHandlers) {
  if (c.kind === "add-package") handlers.onAddPackage?.(c.package, c.commandOrEnv);
  else if (c.kind === "missing-file") handlers.onFixMissingFile?.(c.filename, c.fatal);
  else if (c.kind === "duplicate-label") handlers.onFixDuplicateLabel?.(c.label);
  else handlers.onFixUnescapedAmpersand?.(c.line);
}

function SuggestedFixesList({
  run,
  autoOpenFixes,
  onAutoOpenFixesChange,
  onAddPackage,
  onFixMissingFile,
  onFixDuplicateLabel,
  onFixUnescapedAmpersand,
}: FixHandlers & {
  run: CompileRunOut;
  autoOpenFixes: boolean;
  onAutoOpenFixesChange: (value: boolean) => void;
}) {
  const candidates = matchFixes(run.errors, run.warnings, run.has_pdf);
  if (candidates.length === 0) return null;
  const handlers = { onAddPackage, onFixMissingFile, onFixDuplicateLabel, onFixUnescapedAmpersand };

  return (
    <div className={styles.fixes}>
      <div className={styles.fixesHeader}>
        <span className={styles.fixesHeading}>Suggested fixes</span>
        <label className={styles.autoOpenToggle}>
          <input
            type="checkbox"
            checked={autoOpenFixes}
            onChange={(e) => onAutoOpenFixesChange(e.target.checked)}
          />
          Open automatically after compiling
        </label>
      </div>
      {candidates.map((c, i) => (
        <div key={i} className={styles.fix}>
          <span className={styles.fixLabel}>{fixLabel(c)}</span>
          <Button variant="secondary" size="sm" onClick={() => dispatchFix(c, handlers)}>
            Fix
          </Button>
        </div>
      ))}
    </div>
  );
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

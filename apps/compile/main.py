"""Sandboxed TeX Live compile service (Plan.md §7, Phase 3).

Internal-only HTTP service — never exposed to the internet, only called by
apps/api over the Docker Compose network. Receives a tar of project source
files, runs the actual pdflatex/xelatex job in an ephemeral sandboxed
container (see sandbox.py for every isolation rule), and returns the
result as JSON.
"""

import base64
import json
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from sandbox import ENGINE_COMMANDS, CompileError, run_job
from synctex_query import backward_search, forward_search

MAX_REQUEST_BYTES = 100 * 1024 * 1024  # 100 MB cap on an uploaded project tar

# Live compile progress (project-overview polish): /compile now starts the
# job in a background thread and returns a job_id immediately instead of
# blocking for the whole latexmk run; /compile/<job_id>/status is polled by
# apps/api for step labels and, once done, the final result. A plain
# in-process dict is safe here — ThreadingHTTPServer is one process with
# multiple threads, not multiple worker processes like the api's gunicorn.
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
_JOB_TTL_SECONDS = 300


def _sweep_old_jobs() -> None:
    """Call with _jobs_lock held. Bounds memory without a separate cleanup
    thread — every new /compile call is a natural opportunity to evict
    finished jobs nobody's polled in a while."""
    now = time.monotonic()
    stale = [jid for jid, j in _jobs.items() if j["done"] and now - j["created"] > _JOB_TTL_SECONDS]
    for jid in stale:
        del _jobs[jid]


def _run_and_track(job_id: str, tar_bytes: bytes, compiler: str, main_file: str) -> None:
    def on_step(label: str) -> None:
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is not None:
                job["steps"].append(label)

    try:
        result = run_job(tar_bytes, compiler, main_file, on_step=on_step)
    except CompileError as exc:
        error = str(exc)
        result = None
    except Exception as exc:  # noqa: BLE001 - last-resort boundary for an internal service
        error = f"compile service error: {exc}"
        result = None
    else:
        error = None

    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is not None:
            job["done"] = True
            job["result"] = result
            job["error"] = error


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok"})
            return
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "compile" and parts[2] == "status":
            self._handle_compile_status(parts[1])
            return
        self._json(404, {"detail": "not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/compile":
            self._handle_compile(parsed)
        elif parsed.path == "/synctex/forward":
            self._handle_synctex_forward()
        elif parsed.path == "/synctex/backward":
            self._handle_synctex_backward()
        else:
            self._json(404, {"detail": "not found"})

    def _handle_compile(self, parsed) -> None:
        params = parse_qs(parsed.query)
        compiler = (params.get("compiler") or ["pdflatex"])[0]
        main_file = (params.get("main") or ["main.tex"])[0]

        if compiler not in ENGINE_COMMANDS:
            self._json(400, {"detail": f"unsupported compiler: {compiler}"})
            return

        length = int(self.headers.get("content-length", 0))
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self._json(400, {"detail": "invalid or oversized request body"})
            return
        tar_bytes = self.rfile.read(length)

        job_id = uuid.uuid4().hex
        with _jobs_lock:
            _sweep_old_jobs()
            _jobs[job_id] = {"steps": [], "done": False, "result": None, "error": None, "created": time.monotonic()}
        threading.Thread(target=_run_and_track, args=(job_id, tar_bytes, compiler, main_file), daemon=True).start()
        self._json(200, {"job_id": job_id})

    def _handle_compile_status(self, job_id: str) -> None:
        with _jobs_lock:
            job = _jobs.get(job_id)
            # Copy out what we need under the lock rather than holding it
            # while building/serializing the response.
            snapshot = dict(job) if job is not None else None
        if snapshot is None:
            self._json(404, {"detail": "unknown or expired job_id"})
            return

        payload = {"steps": snapshot["steps"], "done": snapshot["done"], "error": snapshot["error"], "result": None}
        result = snapshot["result"]
        if snapshot["done"] and result is not None:
            payload["result"] = {
                "status": result.status,
                "log": result.log,
                "pdf_base64": base64.b64encode(result.pdf).decode() if result.pdf else None,
                "synctex_base64": base64.b64encode(result.synctex).decode() if result.synctex else None,
                "duration_ms": result.duration_ms,
                "exit_code": result.exit_code,
                "compiler": result.compiler,
            }
        self._json(200, payload)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("content-length", 0))
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("invalid or oversized request body")
        return json.loads(self.rfile.read(length))

    def _handle_synctex_forward(self) -> None:
        try:
            body = self._read_json_body()
            pdf_bytes = base64.b64decode(body["pdf_base64"])
            synctex_bytes = base64.b64decode(body["synctex_base64"])
            file = body["file"]
            line = int(body["line"])
        except (ValueError, KeyError, TypeError) as exc:
            self._json(400, {"detail": f"invalid request: {exc}"})
            return

        result = forward_search(pdf_bytes, synctex_bytes, file, line)
        if result is None:
            self._json(404, {"detail": "no SyncTeX record for that position"})
            return
        self._json(200, result)

    def _handle_synctex_backward(self) -> None:
        try:
            body = self._read_json_body()
            pdf_bytes = base64.b64decode(body["pdf_base64"])
            synctex_bytes = base64.b64decode(body["synctex_base64"])
            page = int(body["page"])
            x = float(body["x"])
            y = float(body["y"])
        except (ValueError, KeyError, TypeError) as exc:
            self._json(400, {"detail": f"invalid request: {exc}"})
            return

        result = backward_search(pdf_bytes, synctex_bytes, page, x, y)
        if result is None:
            self._json(404, {"detail": "no SyncTeX record for that position"})
            return
        self._json(200, result)

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 - stdlib hook signature
        pass


def main():
    port = int(os.environ.get("PORT", "8100"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
